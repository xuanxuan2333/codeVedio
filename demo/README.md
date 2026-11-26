# codeVedio demo：用代码渲染一支 58 秒科普片

一条命令出片：

```bash
cd ..
.venv/bin/python demo/pipeline.py
```

产物：`../css-transform-explainer.mp4`（1080p30，含中文配音与字幕）

## 只改文案

编辑 `content.json` 里的 `beats`（每句 `say` 是配音、`cap` 是字幕），重跑上面那条命令即可。
时间轴会按配音实际时长自动重算。

## 目录

| 文件 | 作用 |
|---|---|
| `content.json` | 唯一需要"创作"的文件：分场、台词、字幕 |
| `index.html` | 5 个场景的动画；核心是 `window.seek(t)` —— 动画是时间的纯函数 |
| `render.mjs` | 无头 Chrome 逐帧 `seek(t)` → 截图 → 管道灌给 ffmpeg |
| `pipeline.py` | TTS → 时间轴 → 调 render.mjs → 混音（含母带）→ 合流 |
| `tts.py` | 整场一次合成 + 句级时间戳反推每句起点 |
| `preview.mjs` | 只渲几张关键帧，用来快速检查版式：`node preview.mjs 3 16 36` |
| `timeline.json` | 自动生成，别手改 |

## 依赖

- Node + `puppeteer-core`（用系统 Chrome，不额外下载 Chromium）
- Python + `imageio-ffmpeg`（自带 ffmpeg 二进制，不用 brew 装）
- `edge-tts`（微软神经语音 `zh-CN-YunxiNeural`）；接口偶发 connection reset，`tts.py` 里带 24 次快速重试，彻底失败才退回系统 `say`

## 换成别的知识点

1. 改 `content.json`（这一步可以让大模型写）
2. 在 `index.html` 里挑/改场景函数：`renderTitle / renderLayout / renderRotate / renderMatrix / renderOutro`
3. 想加新镜头，就加一个 `renderXxx(t)` + 一段静态 DOM，然后在 `window.seek` 里按 `S.xxx.start` 判断调用

## 踩过的坑

- 动画**不要**用 `requestAnimationFrame` / CSS animation 时钟，必须 `seek(t)`，否则两次渲染结果不一致
- 截图用 JPEG(q95) 走管道：PNG 默认 327ms/帧，JPEG 只要 50ms/帧
- 写完管道 `stdin.write` 要用回调等 flush，不要用 `drain` 事件（有竞态，会卡死）
- 字幕要"续航"到下一句开口，否则句间 0.3 秒空隙会闪一下
- 配音**先出音频再排时间轴**；一句一句合成会变成「念清单」，要整场一次合成
