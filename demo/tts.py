#!/usr/bin/env python3
"""神经语音合成 + 句/词级时间戳对齐。

要点：
1. 用 edge-tts（微软 neural 音色），比系统 say 自然一个数量级；
2. **整场一次合成**，而不是一句一句念——句间停顿和语调走向才连贯；
3. 服务端会回 SentenceBoundary / WordBoundary 时间戳，用它反推每句起点，
   所以分镜依然精确，不用靠猜；
4. 该接口偶发 connection reset（实测约 1/3 成功率），带快速重试。
"""
import asyncio
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
                anchors.append({"t": ch["offset"] / 1e7, "d": ch["duration"] / 1e7,
                                "text": ch["text"]})
    return anchors


def synth_scene(text, out_wav, cfg, ffmpeg="ffmpeg"):
    """整场合成一次。成功返回锚点列表（可能为空），彻底失败返回 None。"""
    mp3 = out_wav + ".mp3"
    for i in range(MAX_TRY):
        try:
            if os.path.exists(mp3):
                os.remove(mp3)
            anchors = asyncio.run(asyncio.wait_for(
                _stream(text, cfg["voice"], cfg.get("rate", "-4%"),
                        cfg.get("pitch", "+0Hz"), mp3), timeout=25))
            if os.path.exists(mp3) and os.path.getsize(mp3) > 2000:
                subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", mp3,
                                "-ar", "44100", "-ac", "1", out_wav], check=True)
                os.remove(mp3)
                return anchors
        except Exception as e:  # noqa: BLE001
            if i % 6 == 5:
                print(f"  edge-tts 重试中… ({i + 1}/{MAX_TRY}, {type(e).__name__})", file=sys.stderr)
        time.sleep(0.12)
    return None


def say_scene(text, out_wav, cfg, ffmpeg="ffmpeg"):
    aiff = out_wav + ".aiff"
    subprocess.run(["say", "-v", cfg.get("say_voice", "Tingting"),
                    "-r", str(cfg.get("say_rate", 190)), "-o", aiff, text], check=True)
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", aiff,
                    "-ar", "44100", "-ac", "1", out_wav], check=True)
    os.remove(aiff)


def align_beats(beat_texts, anchors, audio_dur):
    """把「每句文本」映射到「该句在音频里的起点（秒）」。"""
    clean = lambda s: PUNCT.sub("", s or "")

    if not anchors:
        total = sum(len(clean(t)) for t in beat_texts) or 1
        out, acc = [], 0.0
        for t in beat_texts:
            out.append(audio_dur * acc / total)
            acc += len(clean(t))
        return out

    norm, spans = "", []
    for a in anchors:
        s = clean(a["text"])
        if not s:
            continue
        st = len(norm)
        norm += s
        spans.append((st, st + len(s), a["t"], a["t"] + max(a["d"], 0.01)))

    def at(idx):
        idx = max(0, min(idx, len(norm) - 1))
        for st, en, t0, t1 in spans:
            if idx < en:
                return t0 + (idx - st) / max(1, en - st) * (t1 - t0)
        return spans[-1][3] if spans else 0.0

    starts, cursor = [], 0
    for t in beat_texts:
        key = clean(t)[:6]
        pos = norm.find(key, cursor) if key else -1
        if pos < 0:
            pos = cursor
        else:
            cursor = pos
        starts.append(at(pos))
    return starts
