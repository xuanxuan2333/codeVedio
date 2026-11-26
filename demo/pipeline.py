#!/usr/bin/env python3
"""台词 → 配音 → 时间轴 → 逐帧渲染 → 混音 → 出片。整条流水线就这五步。"""
import json
import os
import subprocess
import sys
import wave

import tts

ROOT = os.path.dirname(os.path.abspath(__file__))
FF = os.environ.get("FFMPEG") or subprocess.check_output(
    [sys.executable, "-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]
).decode().strip()

LEAD_IN = 0.35   # 每场开头留白
TAIL = 0.55      # 场末留白
MIN_GAP = 0.22   # 两句之间最少留白


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)


def wav_duration(path):
    with wave.open(path, "rb") as w:
        return w.getnframes() / w.getframerate()


def main():
    cfg = json.load(open(os.path.join(ROOT, "content.json"), encoding="utf-8"))
    adir = os.path.join(ROOT, "audio")
    os.makedirs(adir, exist_ok=True)
    tcfg = cfg.get("tts", {"engine": "edge", "voice": "zh-CN-YunxiNeural"})

    scenes = []
    t = 0.0
    for si, sc in enumerate(cfg["scenes"]):
        texts = [b["say"] for b in sc["beats"]]
        wav = os.path.join(adir, f"s{si + 1}.wav")
        wj = os.path.join(adir, f"s{si + 1}.words.json")

        words = None
        if os.path.exists(wav) and os.path.exists(wj):
            words = json.load(open(wj, encoding="utf-8"))
            src = "cache"
        if words is None or not os.path.exists(wav):
            print(f"  合成 [{sc['id']}] …", flush=True)
            words = tts.synth_scene("".join(texts), wav, tcfg, FF)
            src = "edge-tts"
            if words is None:
                print("  → 退回系统 say", file=sys.stderr)
                tts.say_scene("".join(texts), wav, tcfg, FF)
                words = []
                src = "say"
            json.dump(words, open(wj, "w", encoding="utf-8"), ensure_ascii=False)

        # 去掉 TTS 尾巴上的静音，避免每场多出半秒死气
        trimmed = os.path.join(adir, f"s{si + 1}.trim.wav")
        run([FF, "-y", "-loglevel", "error", "-i", wav, "-af",
             "areverse,silenceremove=start_periods=1:start_duration=0.10:start_threshold=-45dB,areverse",
             trimmed])
        if os.path.exists(trimmed) and wav_duration(trimmed) > 0.5:
            wav = trimmed
        dur = wav_duration(wav)
        t += LEAD_IN
        s_start = t
        rel = tts.align_beats(texts, words, dur)

        beats = []
        for i, b in enumerate(sc["beats"]):
            st = s_start + rel[i]
            en = s_start + rel[i + 1] - MIN_GAP if i + 1 < len(rel) else s_start + dur
            beats.append({"start": st, "end": max(st + 0.2, en), "cap": b["cap"]})
        scenes.append({"id": sc["id"], "start": s_start, "end": s_start + dur + TAIL,
                       "beats": beats, "wav": wav, "dur": dur})
        t = s_start + dur + TAIL
        print(f"  [{sc['id']}] {src}  {dur:5.2f}s  → {beats[0]['start']:.2f}–{beats[-1]['end']:.2f}")

    duration = t + 0.2
    frames = int(duration * cfg["fps"])
    duration = frames / cfg["fps"]

    ms = lambda x: round(x * 1000, 1)
    tl = {
        "width": cfg["width"], "height": cfg["height"], "fps": cfg["fps"], "duration": ms(duration),
        "scenes": [{"id": s["id"], "start": ms(s["start"]), "end": ms(s["end"]),
                    "beats": [{"start": ms(b["start"]), "end": ms(b["end"]), "cap": b["cap"]}
                              for b in s["beats"]]} for s in scenes],
    }
    with open(os.path.join(ROOT, "timeline.json"), "w", encoding="utf-8") as f:
        json.dump(tl, f, ensure_ascii=False, indent=1)
    with open(os.path.join(ROOT, "timeline.js"), "w", encoding="utf-8") as f:
        f.write("window.TIMELINE = " + json.dumps(tl, ensure_ascii=False) + ";\n")

    print(f"时间轴: {duration:.2f}s, {sum(len(s['beats']) for s in scenes)} 句, "
          f"{len(scenes)} 场, {frames} 帧")
    if "--timeline-only" in sys.argv:
        return

    # ---- 1. 渲染画面 ----
    env = dict(os.environ, FFMPEG=FF)
    subprocess.run(["node", "render.mjs", "video_raw.mp4"], cwd=ROOT, check=True, env=env)

    # ---- 2. 按时间轴铺配音 ----
    inputs, filters = [], []
    for i, s in enumerate(scenes):
        inputs += ["-i", s["wav"]]
        filters.append(f"[{i}:a]adelay=delays={int(round(s['start'] * 1000))}:all=1[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(scenes)))
    filters.append(f"{mix}amix=inputs={len(scenes)}:normalize=0:dropout_transition=0[raw]")
    # 简单母带：去低频、压一点动态、统一响度、首尾淡入淡出
    master = (f"highpass=f=75,deesser=i=0.3,"
              f"acompressor=threshold=-20dB:ratio=2.2:attack=6:release=170,"
              f"loudnorm=I=-16:TP=-1.5:LRA=11,"
              f"afade=t=in:st=0:d=0.35,afade=t=out:st={max(0.0, duration - 0.9):.2f}:d=0.9")
    filters.append(f"[raw]{master}[out]")
    audio = os.path.join(ROOT, "audio_mix.wav")
    run([FF, "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(filters),
         "-map", "[out]", "-ar", "44100", "-ac", "2", "-t", f"{duration:.3f}", audio])

    # ---- 3. 合流 ----
    final = os.path.join(ROOT, "..", "css-transform-explainer.mp4")
    run([FF, "-y", "-loglevel", "error", "-i", os.path.join(ROOT, "video_raw.mp4"), "-i", audio,
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart", final])

    # ---- 4. 封面帧 ----
    run([FF, "-y", "-loglevel", "error", "-ss", "1.2", "-i", final, "-frames:v", "1",
         os.path.join(ROOT, "..", "poster.png")])
    print("输出:", os.path.abspath(final))


if __name__ == "__main__":
    main()
