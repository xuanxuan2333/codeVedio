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
            out.append((buf, 0.22)); buf = ""; i += len(BREAK_LONG)
        elif text.startswith(BREAK_SHORT, i):
            out.append((buf, 0.08)); buf = ""; i += len(BREAK_SHORT)
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


def trim_tail(path, ffmpeg, keep=0.25, threshold=-50, mindur=0.22):
    """只在「一直延续到文件结尾的那段静音」上裁剪。

    判断依据：silencedetect 的 silence_start / silence_end 是成对出现的；
    如果 start 比 end 多一个，说明最后一段静音没结束——也就是它一直延伸到
    EOF，这才是真正的"句尾静音"。否则结尾还有声音，一律不剪。
    """
    r = subprocess.run([ffmpeg, "-hide_banner", "-i", path, "-af",
                        f"silencedetect=n={threshold}dB:d={mindur}", "-f", "null", "-"],
                       capture_output=True, text=True)
    starts = re.findall(r"silence_start: ([\d.]+)", r.stderr)
    ends = re.findall(r"silence_end: ([\d.]+)", r.stderr)
    if len(starts) <= len(ends):
        return                      # 结尾没有"未闭合"的静音，说明最后还在说话
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
