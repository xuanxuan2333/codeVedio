#!/usr/bin/env python3
"""音色 A/B：同一句话，edge 和 MiniMax 各合成一遍，拼成一条音频。

    ../.venv/bin/python ab-voice.py "要试的那句话"
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tts  # noqa: E402

FF = os.environ.get("FFMPEG") or subprocess.check_output(
    [sys.executable, "-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]
).decode().strip()

text = sys.argv[1] if len(sys.argv) > 1 else \
    "达特茅斯会议上，麦卡锡第一次提出人工智能这个词。那时候的乐观，今天看近乎天真。"
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ab")
os.makedirs(out, exist_ok=True)

edge_wav = os.path.join(out, "1-edge.wav")
mm_wav = os.path.join(out, "2-minimax.wav")

print("合成 edge（云希）…")
tts.edge(text, edge_wav, "zh-CN-YunxiNeural", "+8%", "+0Hz", FF)
tts.trim_tail(edge_wav, FF)

print("合成 MiniMax …")
if tts.minimax(text, mm_wav, {}, "+8%", FF) is None:
    print("MiniMax 失败：检查 .env 的 key / 余额", file=sys.stderr)
    sys.exit(1)
tts.trim_tail(mm_wav, FF)

# 中间插 0.6 秒静音再拼起来
sil = os.path.join(out, "sil.wav")
subprocess.run([FF, "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                "anullsrc=r=44100:cl=mono", "-t", "0.6", sil], check=True)
final = os.path.join(out, "ab.wav")
subprocess.run([FF, "-y", "-loglevel", "error", "-i", edge_wav, "-i", sil, "-i", mm_wav,
                "-filter_complex", "[0][1][2]concat=n=3:v=0:a=1[o]", "-map", "[o]",
                "-ar", "44100", "-ac", "1", final], check=True)
print("对比文件：", final)
