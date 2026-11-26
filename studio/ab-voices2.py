#!/usr/bin/env python3
"""十个男声 A/B：每个自报编号，念同一句。"""
import os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tts

FF = os.environ.get("FFMPEG") or subprocess.check_output(
    [sys.executable, "-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]
).decode().strip()

LINE = "达特茅斯会议上，麦卡锡第一次提出人工智能这个词。"
VOICES = [
    ("male-qn-qingse", "一号，青涩青年"),
    ("male-qn-daxuesheng", "二号，青年大学生"),
    ("male-qn-jingying", "三号，精英青年"),
    ("male-qn-badao", "四号，霸道青年"),
    ("Chinese (Mandarin)_Unrestrained_Young_Man", "五号，不羁青年"),
    ("Chinese (Mandarin)_Gentle_Youth", "六号，温润青年"),
    ("Chinese (Mandarin)_Sincere_Adult", "七号，真诚青年"),
    ("Chinese (Mandarin)_Southern_Young_Man", "八号，南方小哥"),
    ("Chinese (Mandarin)_Radio_Host", "九号，电台男主播"),
    ("Chinese (Mandarin)_Gentleman", "十号，温润男声"),
]

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ab")
os.makedirs(out, exist_ok=True)
parts = []
for vid, intro in VOICES:
    f = os.path.join(out, f"w_{len(parts)}.wav")
    print(f"合成 {intro} …")
    if tts.minimax(f"{intro}。{LINE}", f, {"voice_id": vid}, "0%", FF) is None:
        print(f"  失败: {vid}", file=sys.stderr); continue
    tts.trim_tail(f, FF)
    parts.append(f)
    time.sleep(0.8)

sil = os.path.join(out, "_s2.wav")
subprocess.run([FF, "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                "anullsrc=r=44100:cl=mono", "-t", "0.6", sil], check=True)
inputs, seq = [], ""
for i, p in enumerate(parts):
    inputs += ["-i", p]
inputs += ["-i", sil]
for i in range(len(parts)):
    if i: seq += f"[{len(parts)}:a]"
    seq += f"[{i}:a]"
final = os.path.join(out, "voices-all.wav")
subprocess.run([FF, "-y", "-loglevel", "error", *inputs,
                "-filter_complex", f"{seq}concat=n={len(parts)*2-1}:v=0:a=1[o]",
                "-map", "[o]", "-ar", "44100", "-ac", "1", final], check=True)
subprocess.run([FF, "-y", "-loglevel", "error", "-i", final, "-c:a", "libmp3lame",
                "-b:a", "192k", os.path.join(out, "voices-all.mp3")], check=True)
print("→", os.path.join(out, "voices-all.mp3"))
