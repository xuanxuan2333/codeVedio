#!/usr/bin/env python3
"""多音色 A/B：每个音色先自报编号，再念同一段话，最后拼成一条音频。"""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tts  # noqa: E402

FF = os.environ.get("FFMPEG") or subprocess.check_output(
    [sys.executable, "-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]
).decode().strip()

LINE = "达特茅斯会议上，麦卡锡第一次提出人工智能这个词。那时候的乐观，今天看近乎天真。"

VOICES = [
    ("male-qn-qingse", "一号，青涩青年", "青涩青年"),
    ("male-qn-daxuesheng", "二号，青年大学生", "青年大学生"),
    ("Chinese (Mandarin)_Unrestrained_Young_Man", "三号，不羁青年", "不羁青年"),
    ("Chinese (Mandarin)_Radio_Host", "四号，电台男主播", "电台男主播"),
    ("male-qn-jingying", "五号，精英青年", "精英青年"),
]

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ab")
os.makedirs(out, exist_ok=True)
parts = []
for vid, intro, label in VOICES:
    f = os.path.join(out, f"v_{len(parts)}.wav")
    text = f"{intro}。{LINE}"
    print(f"合成 {label} …")
    if tts.minimax(text, f, {"voice_id": vid}, "0%", FF) is None:
        print(f"  {label} 失败", file=sys.stderr); continue
    tts.trim_tail(f, FF)
    parts.append(f)

sil = os.path.join(out, "_sil.wav")
subprocess.run([FF, "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                "anullsrc=r=44100:cl=mono", "-t", "0.7", sil], check=True)
inputs, chains = [], []
for i, p in enumerate(parts):
    inputs += ["-i", p]
    chains.append(f"[{i}:a]")
inputs += ["-i", sil]
sil_idx = len(parts)
for i in range(len(parts)):
    if i: chains.append(f"[{sil_idx}:a]")
    chains.append(f"[{i}:a]")
# 简单拼接：每段之间插静音
seq = ""
for i in range(len(parts)):
    if i: seq += f"[{sil_idx}:a]"
    seq += f"[{i}:a]"
final = os.path.join(out, "voices-ab.wav")
subprocess.run([FF, "-y", "-loglevel", "error", *inputs,
                "-filter_complex", f"{seq}concat=n={len(parts)*2-1}:v=0:a=1[o]",
                "-map", "[o]", "-ar", "44100", "-ac", "1", final], check=True)
subprocess.run([FF, "-y", "-loglevel", "error", "-i", final, "-c:a", "libmp3lame",
                "-b:a", "192k", os.path.join(out, "voices-ab.mp3")], check=True)
print("对比文件：", os.path.join(out, "voices-ab.mp3"))
