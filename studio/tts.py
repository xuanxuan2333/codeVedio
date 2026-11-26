#!/usr/bin/env python3
"""批量神经语音合成：读 job.json，出 wav + 时长 + 句级时间戳。

job.json  = [{"id":"s1","text":"..."}, ...]
result.json = [{"id":"s1","wav":"...","dur":3.21,"anchors":[...]}, ...]

缓存按 (文本+音色+语速) 的 hash，重跑不重复请求。
"""
import asyncio
import hashlib
import urllib.request
import json
import os
import re
import subprocess
import sys
import time

MAX_TRY = 24
PUNCT = re.compile(r"[^\w\u4e00-\u9fff]+")


async def _stream(text, voice, rate, pitch, out_mp3):
    import edge_tts
    anchors = []
    c = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    with open(out_mp3, "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] in ("WordBoundary", "SentenceBoundary"):
                anchors.append({"t": ch["offset"] / 1e7, "d": ch["duration"] / 1e7, "text": ch["text"]})
    return anchors


def edge(text, out_wav, voice, rate, pitch, ffmpeg):
    mp3 = out_wav + ".mp3"
    for i in range(MAX_TRY):
        try:
            if os.path.exists(mp3):
                os.remove(mp3)
            anchors = asyncio.run(asyncio.wait_for(
                _stream(text, voice, rate, pitch, mp3), timeout=25))
            if os.path.exists(mp3) and os.path.getsize(mp3) > 2000:
                subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", mp3,
                                "-ar", "44100", "-ac", "1", out_wav], check=True)
                os.remove(mp3)
                return anchors
        except Exception as e:  # noqa: BLE001
            if i % 6 == 5:
                print(f"  retry {i + 1}/{MAX_TRY} {type(e).__name__}", file=sys.stderr)
        time.sleep(0.12)
    return None


def say(text, out_wav, voice, rate, ffmpeg):
    aiff = out_wav + ".aiff"
    subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", aiff, text], check=True)
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", aiff,
                    "-ar", "44100", "-ac", "1", out_wav], check=True)
    os.remove(aiff)



# ---------------- 语义断点 ----------------
# 稿子里用 ｜ 标一个短停顿（0.22s）、｜｜ 标一个长停顿（0.6s）。
# TTS 不会"理解"语义，但人可以告诉它在哪里停。
BREAK_SHORT, BREAK_LONG = "｜", "｜｜"


def _split_breaks(text):
    """返回 [(片段, 该片段之后的停顿时长)]"""
    out, buf, i = [], "", 0
    while i < len(text):
        if text.startswith(BREAK_LONG, i):
            out.append((buf, 0.35)); buf = ""; i += len(BREAK_LONG)
        elif text.startswith(BREAK_SHORT, i):
            out.append((buf, 0.12)); buf = ""; i += len(BREAK_SHORT)
        else:
            buf += text[i]; i += 1
    if buf:
        out.append((buf, 0.0))
    return [(t.strip(), g) for t, g in out if t.strip()]


def _concat(parts, gaps, out_wav, ffmpeg):
    if len(parts) == 1:
        os.replace(parts[0], out_wav)
        return
    args, chains, n = [], [], 0
    for p, g in zip(parts, gaps):
        args += ["-i", p]
        chains.append(f"[{n}:a]")
        n += 1
        if g > 0:
            args += ["-f", "lavfi", "-t", f"{g:.2f}", "-i", "anullsrc=r=44100:cl=mono"]
            chains.append(f"[{n}:a]")
            n += 1
    fc = "".join(chains) + f"concat=n={len(chains)}:v=0:a=1[o]"
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", *args, "-filter_complex", fc,
                    "-map", "[o]", "-ar", "44100", "-ac", "1", out_wav], check=True)
    for pth in parts:
        if os.path.exists(pth) and pth != out_wav:
            os.remove(pth)


def trim_tail(path, ffmpeg, keep=0.30, threshold=-50, mindur=0.25):
    """只在「最后一段静音」处截断，并保留 keep 秒真实余韵。

    关键：不切语音本身。旧做法是 areverse + silenceremove，会把每个字的尾音
    连根削掉，听起来像被剪刀剪了一下。这里先用 silencedetect 找到静音起点，
    再从这个点往后留 0.3 秒，其余才剪。
    """
    r = subprocess.run([ffmpeg, "-hide_banner", "-i", path, "-af",
                        f"silencedetect=n={threshold}dB:d={mindur}", "-f", "null", "-"],
                       capture_output=True, text=True)
    starts = re.findall(r"silence_start: ([\d.]+)", r.stderr)
    if not starts:
        return
    cut = float(starts[-1]) + keep
    total = dur_of(path, ffmpeg)
    if cut >= total - 0.05:
        return
    tmp = path + ".tmp.wav"
    ok = subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", path,
                         "-t", f"{cut:.3f}", tmp], capture_output=True).returncode == 0
    if ok and os.path.exists(tmp) and os.path.getsize(tmp) > 20000:
        os.replace(tmp, path)
    elif os.path.exists(tmp):
        os.remove(tmp)




# ---------------- MiniMax（付费，中文最像真人） ----------------
def _load_env():
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(p):
        return
    for line in open(p, encoding="utf-8"):
        m = re.match(r"^\s*([A-Z_]+)\s*=\s*(.*)\s*$", line)
        if m and not os.environ.get(m.group(1)):
            os.environ[m.group(1)] = m.group(2).strip().strip('"').strip("'")


def _minimax_voice(cfg, speed):
    vs = {
        "voice_id": cfg.get("voice_id") or os.environ.get("MINIMAX_VOICE_ID", "male-qn-qingse"),
        "speed": round(speed, 3),
        "vol": 1.0,
        "pitch": 0,
    }
    emo = cfg.get("emotion")
    if emo and emo != "auto":
        vs["emotion"] = emo          # 只有显式指定才加；部分音色不支持这个字段
    return vs


def minimax(text, out_wav, cfg, rate_str, ffmpeg):
    """MiniMax t2a_v2。返回 None 表示失败。"""
    _load_env()
    key = os.environ.get("MINIMAX_API_KEY")
    gid = (os.environ.get("MINIMAX_GROUP_ID") or "").strip()
    if not key:
        return None
    try:
        speed = 1.0 + float(str(rate_str).replace("%", "").replace("+", "")) / 100.0
    except ValueError:
        speed = 1.0
    body = {
        "model": os.environ.get("MINIMAX_TTS_MODEL", "speech-02-hd"),
        "text": text,
        "stream": False,
        "voice_setting": _minimax_voice(cfg, speed),
        "audio_setting": {"sample_rate": 44100, "bitrate": 128000, "format": "mp3", "channel": 1},
    }
    req = urllib.request.Request(
        "https://api.minimaxi.com/v1/t2a_v2" + (f"?GroupId={gid}" if gid else ""),
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    j = None
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                j = json.loads(r.read().decode())
        except Exception as e:  # noqa: BLE001
            print(f"  minimax 请求失败: {e}", file=sys.stderr)
            time.sleep(2 + attempt * 2)
            continue
        code = (j.get("base_resp") or {}).get("status_code", 0)
        if code == 1002:                      # rate limit exceeded(RPM)
            time.sleep(3 + attempt * 2)
            continue
        break
    if j is None:
        return None
    if "emotion" in body["voice_setting"] and j.get("base_resp", {}).get("status_code"):
        body["voice_setting"].pop("emotion", None)   # 音色不支持情绪，去掉重试
        req = urllib.request.Request(req.full_url, data=json.dumps(body).encode(),
                                     headers={"Authorization": f"Bearer {key}",
                                              "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                j = json.loads(r.read().decode())
        except Exception:
            pass

    hex_audio = (j.get("data") or {}).get("audio")
    if not hex_audio:
        print(f"  minimax 返回异常: {str(j)[:300]}", file=sys.stderr)
        return None
    mp3 = out_wav + ".mp3"
    with open(mp3, "wb") as f:
        f.write(bytes.fromhex(hex_audio))
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", mp3,
                    "-ar", "44100", "-ac", "1", out_wav], check=True)
    os.remove(mp3)
    return []


def dur_of(path, ffmpeg):
    out = subprocess.run([ffmpeg, "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    if not m:
        return 0.0
    hh, mm, ss = m.groups()
    return int(hh) * 3600 + int(mm) * 60 + float(ss)


def main():
    job_path = sys.argv[sys.argv.index("--job") + 1]
    outdir = sys.argv[sys.argv.index("--outdir") + 1]
    ffmpeg = os.environ.get("FFMPEG") or "ffmpeg"
    cfg = json.load(open(os.path.join(outdir, "..", "meta.json"), encoding="utf-8")) \
        if os.path.exists(os.path.join(outdir, "..", "meta.json")) else {}
    voice = cfg.get("voice", "zh-CN-YunxiNeural")
    rate = cfg.get("rate", "-4%")
    pitch = cfg.get("pitch", "+0Hz")
    say_voice = cfg.get("say_voice", "Tingting")

    os.makedirs(outdir, exist_ok=True)
    jobs = json.load(open(job_path, encoding="utf-8"))
    results = []
    for j in jobs:
        r0 = j.get("rate") or rate
        key = hashlib.sha1(
            f"{cfg.get('engine', 'edge')}|{voice}|{cfg.get('voice_id', '')}|{j['text']}|{r0}".encode()
        ).hexdigest()[:16]
        wav = os.path.join(outdir, key + ".wav")
        ann = wav + ".json"

        want = "minimax" if cfg.get("engine") == "minimax" else "edge"
        cached, anchors = None, None
        if os.path.exists(wav) and os.path.exists(ann):
            try:
                c = json.load(open(ann, encoding="utf-8"))
                if isinstance(c, dict) and c.get("src") == want:
                    cached = c
            except Exception:
                cached = None

        if cached is not None:
            anchors, src = cached.get("anchors", []), "cache"
        else:
            src = want
            segs = _split_breaks(j["text"])
            if len(segs) > 1:
                tmp_wavs, gaps = [], []
                for k, (seg, gap) in enumerate(segs):
                    tp = f"{wav}.part{k}.wav"
                    if want == "minimax":
                        ok = minimax(seg, tp, cfg, r0, ffmpeg) is not None
                    else:
                        ok = edge(seg, tp, voice, r0, pitch, ffmpeg) is not None
                    if not ok:
                        break
                    tmp_wavs.append(tp); gaps.append(gap)
                if len(tmp_wavs) == len(segs):
                    _concat(tmp_wavs, gaps, wav, ffmpeg)
                    anchors = []
                else:
                    anchors = None
            elif want == "minimax":
                anchors = minimax(j["text"], wav, cfg, r0, ffmpeg)
            if anchors is None:
                anchors = edge(j["text"], wav, voice, r0, pitch, ffmpeg)
                src = "edge"
                if anchors is None:
                    print(f"  [{j['id']}] 全部失败，退回系统 say", file=sys.stderr)
                    say(j["text"], wav, say_voice, 190, ffmpeg)
                    anchors, src = [], "say"
            json.dump({"src": src, "anchors": anchors}, open(ann, "w", encoding="utf-8"),
                      ensure_ascii=False)

        if want == "minimax":
            time.sleep(0.8)                   # 主动节流，避免撞 RPM
        trim_tail(wav, ffmpeg)
        d = dur_of(wav, ffmpeg)
        data = json.load(open(ann, encoding="utf-8"))
        anchors_out = data.get("anchors", []) if isinstance(data, dict) else data
        print(f"  [{j['id']}] {src} {d:5.2f}s  {j['text'][:22]}")
        results.append({"id": j["id"], "wav": os.path.abspath(wav), "dur": d,
                        "anchors": anchors_out})

    json.dump(results, open(os.path.splitext(job_path)[0] + ".result.json", "w", encoding="utf-8"),
              ensure_ascii=False)


if __name__ == "__main__":
    main()
