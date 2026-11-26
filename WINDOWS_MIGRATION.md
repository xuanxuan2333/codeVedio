# Windows 迁移指南 · codeVedio

> 目标：把这套「口播稿 → 配音 → 时间轴 → 逐帧渲染 → mp4」的流水线，从 macOS 迁到 Windows 10/11 上跑通。
>
> 结论：**代码主体是跨平台的，但有 4 处 macOS 硬编码会直接挡住 Windows**；另有 6 处属于「能跑但会踩坑」。本文按优先级列清楚，每条都给出症状、原因和建议改法。
>
> 说明：本文是**基于现有代码逐行检查**写的，写文档时没有 Windows 实机，所以第 9 节给了一份验收清单；第一次在 Windows 上跑，请按清单逐项打勾。

---

## 0. 先看结论（TL;DR）

| 优先级 | 问题 | 位置 | Windows 上的表现 | 处理 |
|---|---|---|---|---|
| **P0** | Python 解释器写死 `.venv/bin/python` | `studio/build.mjs:20` | `spawn ENOENT`，配音直接起不来 | 按平台拼 `.venv\Scripts\python.exe`，或设 `PYTHON` 环境变量 |
| **P0** | Chrome 路径写死 `/Applications/...` | `studio/build.mjs:21-22` | `Failed to launch the browser process` | 按平台探测 Chrome/Edge，或设 `CHROME_PATH` |
| **P0** | `file://` 直接拼 Windows 路径 | `studio/build.mjs:126` | `Cannot navigate to invalid URL` 或白屏 | 改用 `pathToFileURL()` |
| **P0** | TTS 全失败时退回 macOS `say` | `studio/tts.py:56-61, 290-292` | `FileNotFoundError: say`，整个任务中断 | Windows 上禁用该兜底，明确报错 |
| P1 | `new URL(import.meta.url).pathname` | `studio/gen-image.mjs:17` | 得到 `/C:/...`，读不到 `.env`，静默退回免费图源 | 改用 `fileURLToPath()` |
| P1 | 删 Chrome profile 不重试 | `studio/build.mjs:138,166` | `EPERM` / `EBUSY`，渲染完退出时报错 | `rmSync` 加 `maxRetries` |
| P1 | 字体族以 macOS 字体优先 | `studio/kit/style.css:15-16` | 回退到微软雅黑/Consolas，字宽变化，可能溢出 | 预检 `--stills`；长期建议自带字体 |
| P2 | Python stdout 走系统代码页 | `studio/tts.py` | 生僻字/emoji 可能 `UnicodeEncodeError` | `PYTHONIOENCODING=utf-8` |
| P2 | `spawn` 没加 `windowsHide` | `studio/build.mjs:147` | 每帧弹黑框（一般不会，但可能） | 加 `windowsHide: true` |
| P2 | 老管线脚本同样写死 Chrome | `demo/render.mjs:9-11`、`demo/preview.mjs:3`、`compare/render-sample.mjs:8` | 老 demo / 横评跑不了 | 只作参考，或同样改探测 |

**最省事的临时方案**：不改代码，先设三个环境变量——

```powershell
$env:PYTHON      = "C:\path\to\codeVedio\.venv\Scripts\python.exe"
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$env:PYTHONIOENCODING = "utf-8"
```

这样能绕过 P0 的前两项；`file://` 和 `say` 两项仍建议改代码（见第 5 节）。

---

## 1. 这个项目在 macOS 上实际依赖什么

先看清现状，迁移时才知道哪些要重装、哪些只是路径问题。

| 依赖 | 当前实测值 | 是否跨平台 | 备注 |
|---|---|---|---|
| Node.js | v21.7.3 | ✅ | **但 `puppeteer-core@25.18.1` 声明 `engines.node >= 22.12.0`**；Windows 请直接装 Node 22 LTS 或 24 LTS |
| npm | 10.5.0 | ✅ | 用 `npm ci` 按 lockfile 装 |
| Python | 3.12.4 | ✅ | 虚拟环境在**仓库根目录** `.venv/`，不是 `studio/.venv/` |
| edge-tts | 7.3.1 | ✅ | 免费配音，需要联网 |
| imageio-ffmpeg | 0.8.1 | ✅ | 自带 ffmpeg 二进制；macOS 上解析到 `ffmpeg-macos-aarch64-v9.0` |
| ffmpeg | 不在 PATH | ✅ | 代码优先用 `imageio_ffmpeg.get_ffmpeg_exe()`，所以系统没装也能跑 |
| Google Chrome | `/Applications/Google Chrome.app` | ✅ | 用系统 Chrome，不下载 Chromium；Windows 上 Chrome/Edge 都可以 |
| 中文字体 | PingFang SC / Hiragino | ⚠️ | Windows 回退到 Microsoft YaHei，版式会有细微差异 |

工具链关系：

```
build.mjs
  ├─ spawn PYTHON studio/tts.py        → edge-tts / MiniMax → audio/*.wav
  ├─ 写 storyboard.js（时间轴）
  ├─ puppeteer-core + 系统 Chrome       → 逐帧截图 → ffmpeg(image2pipe) → raw.mp4
  └─ ffmpeg                             → 混音 + loudnorm → 合流 → out/*.mp4
```

几个容易忽略的事实：

- `build.mjs` 里的 `ROOT` 是**仓库根目录**（`studio/` 的上一级），所以 `.venv` 必须建在根目录。
- 配音缓存按 `(文本 + 音色 + 语速)` 的 hash 存在 `projects/<名字>/audio/`，换机器后缓存失效是正常的，会重新请求 TTS。
- `storyboard.js`、`meta.json`、`_tts.job*.json`、`out/`、`audio/` 都是生成物，不要提交（本仓库的 `.gitignore` 已经处理）。
- 项目目录里的 `index.html` / `style.css` / `scenes.js` 是每次构建从 `studio/kit/` 复制的，改样式请改 `kit/`，不要改项目里的副本。

---

## 2. Windows 目标环境

推荐基线（2026 年）：

| 项 | 推荐 | 最低 |
|---|---|---|
| 系统 | Windows 11 x64（或 Windows 10 22H2） | Windows 10 x64 |
| Node.js | **24 LTS** | **22.12+**（受 puppeteer-core 限制） |
| Python | 3.12 x64 | 3.10+ |
| 浏览器 | Google Chrome 稳定版 | Edge（Chromium 内核）也可以 |
| 终端 | PowerShell 7（`pwsh`） | Windows PowerShell 5.1 |
| Git | 2.40+ | 2.30+ |
| 磁盘 | 预留 5GB | 2GB（不含成片） |

> ⚠️ 不要用 Node 18/20。`puppeteer-core@25` 的 `engines` 要求 `>=22.12.0`，Node 20 装的时候可能只是警告，但运行时可能直接报错。
>
> ⚠️ 不要用 32 位 Python。`imageio-ffmpeg` 的 Windows wheel 和 Chrome 都按 x64 准备。

---

## 3. 一次性安装（PowerShell）

### 3.1 装依赖

```powershell
# 按需安装；已装可跳过
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
winget install --id Google.Chrome -e
winget install --id Git.Git -e

# 关掉当前窗口重开，确认版本
node -v        # 应为 v22.12+ 或 v24.x
npm -v
py -3.12 -V    # 应为 Python 3.12.x
```

### 3.2 拉代码、建虚拟环境

```powershell
git clone git@github.com:<你的账号>/<仓库名>.git
cd <仓库名>

# 关键：venv 建在仓库根目录，和 build.mjs 的 ROOT 对齐
py -3.12 -m venv .venv

# 升级 pip 并装 Python 依赖
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install edge-tts imageio-ffmpeg
```

> 项目当前没有 `requirements.txt`。如果希望锁定版本，可以新建一个：
>
> ```text
> edge-tts==7.3.1
> imageio-ffmpeg==0.8.1
> ```
>
> 然后 `pip install -r requirements.txt`。

### 3.3 装 Node 依赖

```powershell
cd studio
npm ci
cd ..
```

`puppeteer-core` 只是协议客户端，**不会**下载 Chromium；必须用系统 Chrome/Edge。

### 3.4 配置密钥（可选）

只有用 MiniMax 配音/生图时才需要：

```powershell
Copy-Item studio\.env.example studio\.env
notepad studio\.env
```

填 `MINIMAX_GROUP_ID` 和 `MINIMAX_API_KEY`。默认 `edge-tts` 免费，不填也能跑。

> `.env` 已在 `.gitignore` 里，不会被提交。不要把 key 写进 `storyboard.json` 或命令行历史。

### 3.5 自检

```powershell
# ffmpeg 能不能解析到
.\.venv\Scripts\python.exe -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"

# edge-tts 能不能导入
.\.venv\Scripts\python.exe -c "import edge_tts; print(edge_tts.__version__)"

# Python 语法
.\.venv\Scripts\python.exe -m py_compile studio\tts.py

# Node 语法
node --check studio\build.mjs

# Chrome 是否存在（路径按实际安装位置）
Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

---

## 4. 第一次跑通（先不改代码）

先设环境变量，绕开两个 P0：

```powershell
$env:PYTHON           = (Resolve-Path .\.venv\Scripts\python.exe).Path
$env:CHROME_PATH      = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$env:PYTHONIOENCODING = "utf-8"

chcp 65001   # 让控制台按 UTF-8 显示中文
cd studio
```

然后按「先对轴、再审画面、最后全片」的顺序：

```powershell
# 1) 只做配音 + 时间轴，秒出，先看每镜时长
node build.mjs projects/demo --timeline

# 2) 截 5 个关键帧，检查字体、换行、有没有溢出
node build.mjs projects/demo --stills 0,5,12,24,40

# 3) 全片渲染
node build.mjs projects/demo
```

产物：

| 路径 | 内容 |
|---|---|
| `projects/demo/storyboard.js` | 生成的时间轴 |
| `projects/demo/stills/*.png` | 审片截图 |
| `projects/demo/out/why-animation.mp4` | 成片 |
| `projects/demo/out/poster.png` | 封面帧 |

**如果第 2 步就报 `Cannot navigate to invalid URL` 或打开白屏**，说明 `file://` 拼接在 Windows 上不成立，直接看 5.1。

> `--stills` 依赖上一次生成的 `storyboard.js`。全新克隆的仓库如果没有这个文件，先跑 `--timeline`（会请求 TTS），或者先跑一次完整构建。这是现有行为，不是 Windows 独有的问题。

---

## 5. 需要改的代码点

> 下面给的是**建议改法**，本次没有改你的代码。每条都可以单独落地，互不依赖。

### 5.1 P0：`file://` 拼接在 Windows 上不可靠

**位置**：`studio/build.mjs:126`

```js
await page.goto('file://' + path.join(proj, 'index.html'), { waitUntil: 'load' });
```

**症状**：Windows 上拼出来是 `file://C:\Users\...\index.html`。Chrome 有时能自动纠正，有时直接判定非法 URL，表现为 `Cannot navigate to invalid URL` 或白屏后 `waitForFunction` 超时。路径里有空格、中文、`#`、`?` 时更容易出问题。

**建议改法**：

```js
import { pathToFileURL } from 'node:url';

await page.goto(pathToFileURL(path.join(proj, 'index.html')).href, { waitUntil: 'load' });
```

`pathToFileURL()` 会生成 `file:///C:/Users/.../index.html`，空格和中文会被正确转义，两个平台都稳。

> 同理，如果以后在 `scenes.js` 里动态加载本地文件，也不要用字符串拼 `file://`。

---

### 5.2 P0：Python 解释器路径

**位置**：`studio/build.mjs:20`

```js
const PY = process.env.PYTHON || path.join(ROOT, '.venv/bin/python');
```

**症状**：Windows 上得到 `...\.venv\bin\python`（没有 `.exe`，目录也不对），`spawnSync` 报 `ENOENT`。更隐蔽的是 `resolveFfmpeg()` 会因此静默失败，然后退回 `'ffmpeg'`，最后报「ffmpeg 启动失败」，让你以为是 ffmpeg 的问题。

**建议改法**：

```js
function resolvePython() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const candidates = process.platform === 'win32'
    ? [path.join(ROOT, '.venv', 'Scripts', 'python.exe'), 'python', 'py']
    : [path.join(ROOT, '.venv', 'bin', 'python'), 'python3', 'python'];
  return candidates.find(p => p === 'python' || p === 'py' || p === 'python3' || fs.existsSync(p)) || candidates[0];
}

const PY = resolvePython();
```

注意 `py` 需要额外参数（`py -3`），上面的写法只是兜底；要更严谨就单独处理：

```js
// 如果 candidates 落到 'py'，后续 spawn 时要加 '-3'
```

**零代码临时方案**：设 `PYTHON` 环境变量（见第 4 节）。

---

### 5.3 P0：Chrome 可执行文件路径

**位置**：`studio/build.mjs:21-22`

```js
const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
```

**症状**：Windows 上路径不存在，`puppeteer.launch` 报 `Failed to launch the browser process` / `ENOENT`。

**建议改法**：按平台探测，并允许 Edge 兜底：

```js
function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pf   = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    win32: [
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  };
  const found = (candidates[process.platform] || []).find(p => fs.existsSync(p));
  if (!found) {
    console.error('找不到 Chrome/Edge，请设置 CHROME_PATH 环境变量');
    process.exit(1);
  }
  return found;
}
```

> Edge 是 Chromium 内核，Puppeteer 能驱动；但**不要用不带 H.264 的 Chromium**，否则 `video` 镜头会黑屏（见第 7 节）。

**零代码临时方案**：设 `CHROME_PATH`。

---

### 5.4 P0：`say` 兜底是 macOS 专属

**位置**：`studio/tts.py:56-61` 和 `studio/tts.py:290-292`

```python
def say(text, out_wav, voice, rate, ffmpeg):
    aiff = out_wav + ".aiff"
    subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", aiff, text], check=True)
    ...
```

```python
if anchors is None:
    print(f"  [{j['id']}] 全部失败，退回系统 say", file=sys.stderr)
    say(j["text"], wav, say_voice, 190, ffmpeg)
```

**症状**：只有 edge-tts 和 MiniMax 都失败时才会走到这里，但一旦走到，`FileNotFoundError` 会中断整个 `tts.py`，前面已经合成的句子也拿不到结果。

**建议改法**：非 macOS 不要假装有兜底，明确失败并保留已完成的缓存：

```python
def say(text, out_wav, voice, rate, ffmpeg):
    if sys.platform != "darwin":
        raise RuntimeError("系统 say 兜底仅支持 macOS；请检查网络或改用 MiniMax")
    ...
```

```python
if anchors is None:
    if sys.platform == "darwin":
        print(f"  [{j['id']}] 全部失败，退回系统 say", file=sys.stderr)
        say(j["text"], wav, say_voice, 190, ffmpeg)
        anchors, src = [], "say"
    else:
        raise RuntimeError(
            f"[{j['id']}] edge-tts 与 MiniMax 均失败，Windows 上没有 say 兜底。"
            "请检查网络/代理，或在 meta.json 里切到 MiniMax。"
        )
```

如果确实需要离线配音，可选方案：

- 装 PowerShell 的 SAPI 语音（`System.Speech`），但中文音色质量差，且要在 Windows 设置里额外安装；
- 用 `pyttsx3`（SAPI5）作为可选依赖，不要默认启用；
- 最简单：保证 edge-tts 可用，或配置 MiniMax。

---

### 5.5 P1：`gen-image.mjs` 的 `.env` 路径

**位置**：`studio/gen-image.mjs:17`

```js
const envFile = path.join(path.dirname(new URL(import.meta.url).pathname), '.env');
```

**症状**：Windows 上 `new URL(import.meta.url).pathname` 返回 `/C:/Users/.../gen-image.mjs`，前面多一个斜杠；`path.join` 之后变成 `\C:\Users\...\.env` 这种非法路径。结果是 `.env` 读不到，MiniMax 生图静默失败，退回 Pollinations。

**建议改法**：

```js
import { fileURLToPath } from 'node:url';

const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
```

> 其他 `fetch-media.mjs`、`fetch-batch.mjs` 没有这个写法，不受影响。

---

### 5.6 P1：Chrome profile 清理可能失败

**位置**：`studio/build.mjs:138` 和 `studio/build.mjs:166`

```js
fs.rmSync(profile, { recursive: true, force: true });
```

**症状**：Windows 上 Chrome 退出后可能还有 crashpad / 子进程短暂占用文件，`rmSync` 抛 `EPERM` 或 `EBUSY`。`force: true` 只忽略「不存在」，不忽略「被占用」。

**建议改法**：

```js
const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 };
fs.rmSync(profile, rmOpts);
```

更稳的做法：把 profile 放到系统临时目录，而不是项目目录：

```js
const profile = path.join(os.tmpdir(), 'code-animation-chrome-' + process.pid);
```

这样即使删不掉，也不会污染仓库，也不会被 OneDrive 同步/杀软扫描拖慢。

---

### 5.7 P1：字体回退导致版式变化

**位置**：`studio/kit/style.css:15-16`

```css
--sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
--mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;
```

Windows 上没有 PingFang / Hiragino / SF Mono / Menlo，会回退到：

- 中文：Microsoft YaHei（微软雅黑）
- 等宽：Consolas（或 `ui-monospace` 映射到的 Cascadia Mono）

**影响**：

- 字宽不同 → 同一句标题可能从 1 行变 2 行，或从 2 行变 1 行；
- 字重不同 → `font-weight:900` 在雅黑上可能被合成，观感偏粗；
- `-webkit-font-smoothing: antialiased` 在 Windows 上无效，边缘更「实」；
- 行高、标点挤压、中英混排间距都会略有差异。

**短期**：每次改版式后跑 `--stills`，重点看 `title`、`quote`、`bigword`、`code` 这几种文字多的镜头。

**长期（推荐）**：把字体打包进仓库，彻底消除平台差异：

```css
@font-face{
  font-family:"StudioSans";
  src:url("fonts/NotoSansSC-Regular.woff2") format("woff2");
  font-weight:400;font-display:block;
}
@font-face{
  font-family:"StudioSans";
  src:url("fonts/NotoSansSC-Bold.woff2") format("woff2");
  font-weight:700;font-display:block;
}
:root{
  --sans:"StudioSans","PingFang SC","Microsoft YaHei",sans-serif;
  --mono:"StudioMono","SF Mono",Consolas,monospace;
}
```

字体建议选 SIL OFL 授权（Noto Sans SC、Source Han Sans、JetBrains Mono），可以合法随仓库分发。注意 woff2 要放在 `studio/kit/fonts/`，并且 `build.mjs` 复制 `kit` 时要把 `fonts/` 一起复制（现在只复制 `index.html`、`style.css`、`scenes.js` 三个文件）。

---

### 5.8 P2：Python 输出编码

**位置**：`studio/tts.py` 的 `print`；由 `build.mjs` 用管道接走 stdout。

**症状**：Windows 中文系统的管道编码可能是 GBK（cp936）。当前 60 句文案实测都能用 GBK 编码，所以暂时不会炸；但以后文案里出现 emoji、`✓`、`→` 之外的符号，就可能 `UnicodeEncodeError`。

**建议改法**：在 `tts.py` 入口统一 UTF-8：

```python
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
```

同时 `build.mjs` 调 Python 时带上：

```js
env: { ...process.env, FFMPEG: FF, PYTHONIOENCODING: 'utf-8' }
```

**零代码临时方案**：`$env:PYTHONIOENCODING = "utf-8"`。

---

### 5.9 P2：`spawn` 隐藏窗口

**位置**：`studio/build.mjs:147`

```js
const ff = spawn(FF, [...], { stdio: ['pipe', 'inherit', 'inherit'] });
```

**建议**：加 `windowsHide: true`。正常情况下 `stdio: inherit` 不会弹新窗口，但在某些启动方式（计划任务、IDE 终端）下可能出现一闪而过的黑框。

```js
{ stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true }
```

---

### 5.10 P2：老管线 / 横评脚本

这些脚本不在主流程里，但同样是 macOS 硬编码：

| 文件 | 行 | 现状 |
|---|---|---|
| `demo/render.mjs` | 9-11 | `CHROME = '/Applications/Google Chrome.app/...'` |
| `demo/preview.mjs` | 3 | 同上 |
| `demo/tts.py` | 60 | `say -v Tingting` |
| `compare/render-sample.mjs` | 8 | 同上 |

`demo/` 是「第一支片」的老管线，README 已注明只作参考；`compare/` 是 8 个工具的横评。Windows 上如果只是用 `studio/`，可以不动它们；要跑就把 Chrome 路径改成环境变量：

```js
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
```

---

### 5.11 P2：文档里的 macOS 路径和 bash 语法

这些不影响运行，但会误导 Windows 上的使用者/agent：

| 文件 | 行 | 内容 | Windows 写法 |
|---|---|---|---|
| `README.md` | 42 | `cd studio && node build.mjs ...` | PowerShell 5.1 不支持 `&&`，用 `cd studio; node build.mjs ...` |
| `README.md` | 574 | `for p in projects/series-01/*/; do ...; done` | `Get-ChildItem projects\series-01 -Directory \| ForEach-Object { node build.mjs $_.FullName }` |
| `demo/README.md` | 7 | `.venv/bin/python demo/pipeline.py` | `.\.venv\Scripts\python.exe demo\pipeline.py` |
| `studio/skill/.../SKILL.md` | 33 | 绝对路径 `~/Documents/AI/vedio/codeVedio/studio/build.mjs` | 改成相对路径查找，或说明 Windows 下用 `studio\build.mjs` |
| `studio/skill/.../SKILL.md` | 35 | 「Node 20+」 | 实际要求 **Node 22.12+** |
| `studio/skill/.../references/05-出片与排错.md` | 158 | `../.venv/bin/python ab-voices.py` | `..\.venv\Scripts\python.exe ab-voices.py` |

---

## 6. 路径、编码、换行、长路径

Windows 的坑大多集中在这四件事上，和业务代码无关，但足够让流水线跑不起来。

### 6.1 路径

| 建议 | 原因 |
|---|---|
| 仓库放在**纯英文、无空格**的短路径下，如 `D:\code\codeVedio` | 避免 `file://`、ffmpeg、Chrome 命令行被空格/中文干扰；也避免长路径 |
| 不要放在 OneDrive / 坚果云 / 同步盘里 | 逐帧渲染会产生大量临时文件，同步会拖慢甚至锁文件 |
| 不要放在 `C:\Program Files` 下 | 需要管理员权限，Chrome profile 写入会失败 |
| 用 `path.join` / `pathToFileURL`，不要手拼 `/` 或 `file://` | 跨平台 |

### 6.2 编码

- 所有 `.md`、`.json`、`.py`、`.mjs` 都按 UTF-8 保存（无 BOM）。Windows 记事本默认可能是 ANSI/UTF-8 with BOM；BOM 会让 `JSON.parse` 报错。
- 控制台先 `chcp 65001`，否则中文日志可能乱码（不影响成片，只影响排查）。
- 推荐 PowerShell 7（`pwsh`），对 UTF-8 和 `&&` 的支持都比 5.1 好。
- `.env` 文件也用 UTF-8；`tts.py` 用 `encoding="utf-8"` 读取，没问题。

### 6.3 换行

- 仓库已加 `.gitattributes`：默认 `eol=lf`，`.bat/.cmd/.ps1` 为 CRLF。
- Windows 上 `core.autocrlf` 建议保持默认 `true`；有 `.gitattributes` 时以它为准。
- Node 和 Python 都能读 LF；不要把 `.mjs` 的 shebang 弄成 CRLF（如果以后要在 Git Bash/WSL 里直接执行）。

### 6.4 长路径（MAX_PATH 260）

Node、Chrome、Python 都可能被 260 字符限制卡住，典型报错 `ENAMETOOLONG`、`The system cannot find the path specified`。

```powershell
# 1) Git 支持长路径（管理员 PowerShell）
git config --system core.longpaths true

# 2) 系统开启长路径（管理员 PowerShell，需重启）
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1 -PropertyType DWord -Force
```

即便如此，还是建议把仓库放在 `D:\code\...` 这种短路径下，别放在 `C:\Users\<很长的用户名>\Documents\...` 深层目录。

### 6.5 杀毒软件 / Defender

逐帧渲染会频繁创建/删除 `.chrome-profile` 和截图管道。Windows Defender 实时扫描可能让渲染速度掉一半，甚至偶发 `EPERM`。可以把仓库目录和 `%TEMP%` 加入排除项（设置 → 隐私和安全性 → Windows 安全中心 → 病毒和威胁防护 → 排除项）。

---

## 7. 音视频链路

### 7.1 ffmpeg

代码优先用 `imageio-ffmpeg` 自带的二进制：

```python
import imageio_ffmpeg
print(imageio_ffmpeg.get_ffmpeg_exe())
```

Windows 上会得到类似：

```text
C:\...\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-vX.exe
```

这个静态构建通常包含本项目需要的：

- 编码器：`libx264`、`aac`
- 滤镜：`adelay`、`amix`、`loudnorm`、`deesser`、`silencedetect`、`afade`

装完可以自检：

```powershell
$ff = & .\.venv\Scripts\python.exe -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"
& $ff -hide_banner -encoders | Select-String "libx264"
& $ff -hide_banner -filters  | Select-String "loudnorm|deesser|adelay"
```

如果不用 imageio-ffmpeg，也可以装系统 ffmpeg（`winget install Gyan.FFmpeg`），然后设 `$env:FFMPEG="C:\...\ffmpeg.exe"`。要确认是**full build**，否则可能缺 `libx264`。

### 7.2 浏览器编解码

`video` 镜头依赖 Chrome 的 H.264 解码：

- Google Chrome：自带 H.264/AAC，✅
- Microsoft Edge：自带，✅
- 开源 Chromium / 部分精简版：可能没有专有编解码器，`video` 镜头会黑屏或只有第一帧 ❌

本项目 `video` 只解码画面，声音全部来自 TTS，所以只需要 H.264，不需要 AAC 解码。

### 7.3 性能

- 渲染是「逐帧 seek + 截图 + JPEG 管道」，CPU 单线程瓶颈在 Chrome 截图；Windows 上通常比同代 Mac 慢一些，但 1080p30 的 1 分钟片子一般在几分钟量级。
- `--disable-gpu` 是现有参数，走软件渲染，稳定但慢。如果 Windows 上想提速，可以试着去掉它，但要先确认画面没有色差/闪烁。
- 不要开 `--headless=old`；Puppeteer 25 已用新 headless 模式。
- 成片编码 `-preset medium -crf 18`，如果只做预览可以临时改成 `-preset veryfast -crf 23`（需要改代码）。
- 一镜一场的音频混音用了 `amix` + 多个 `-i`，场景特别多（>50）时命令行会变长，但 28 镜的 politics 都没问题。

### 7.4 渲染一致性

同一份代码在 macOS 和 Windows 上渲染，**不要期望逐像素一致**：

- 字体回退不同（PingFang → 雅黑）；
- 字体栅格化/抗锯齿不同；
- `-webkit-font-smoothing` 只在 macOS 生效；
- Chrome 版本不同，CSS 布局可能有细微差异。

建议：

- 一个系列片**固定在一台机器/一个系统**上出片；
- 跨系统只对比「版式有没有溢出」，不要对比帧 hash；
- 用 `--stills` 抽查 5 个文字最多的镜头。

---

## 8. 常见报错 → 处理

| 报错 / 现象 | 最可能的原因 | 处理 |
|---|---|---|
| `spawn ... ENOENT`（Python） | `PY` 还是 `.venv/bin/python` | 设 `PYTHON`，或按 5.2 改代码 |
| `spawn ... ENOENT`（ffmpeg） | Python 路径错 → `imageio_ffmpeg` 没解析到 → 退回 PATH 里的 `ffmpeg`，而系统没装 | 先修 Python 路径；或设 `FFMPEG` |
| `Failed to launch the browser process` / `ENOENT`（Chrome） | `CHROME_PATH` 不对 | 设 `CHROME_PATH`，或按 5.3 改代码 |
| `Cannot navigate to invalid URL` / 白屏 / `waitForFunction` 超时 | `file://` + Windows 路径 | 按 5.1 改用 `pathToFileURL` |
| `EPERM` / `EBUSY`，指向 `.chrome-profile` | Chrome 子进程还占着文件 | 按 5.6 加重试；或把 profile 放到 `%TEMP%` |
| `FileNotFoundError: [WinError 2] 系统找不到指定的文件`，提到 `say` | TTS 全失败，走到 macOS 兜底 | 按 5.4 禁用；检查网络/代理，或切 MiniMax |
| `UnicodeEncodeError: 'gbk' codec can't encode ...` | Python stdout 走 GBK | 设 `PYTHONIOENCODING=utf-8`，或按 5.8 改 |
| 控制台中文乱码 | 代码页不是 65001 | `chcp 65001`；用 PowerShell 7 |
| `npm ci` 报 `EBADENGINE` / puppeteer 运行时报语法错 | Node < 22.12 | 升级到 Node 22 LTS / 24 LTS |
| `libx264 not found` | ffmpeg 不是 full build | 换 imageio-ffmpeg，或装 Gyan.FFmpeg full |
| `video` 镜头黑屏 | 用了无 H.264 的 Chromium | 换 Chrome/Edge |
| 成片有画面没声音 / 音画不同步 | TTS 某句失败但没报错；或 `amix` 输入对不上 | 看 `_tts.job.result.json`，确认每镜都有 `wav` 且 `dur > 0` |
| `edge-tts` 连接重置 | 网络/代理/并发限制 | 已内置 24 次重试；检查代理、换网络，或切 MiniMax |
| 字体变宽导致文字溢出 | 雅黑 vs PingFang 字宽差异 | `--stills` 检查；按 5.7 打包字体 |
| `ENAMETOOLONG` / 路径找不到 | 超过 260 字符 | 按 6.4 开长路径，缩短仓库路径 |
| 渲染特别慢 / 偶发文件锁 | Defender 实时扫描 | 加排除项；profile 放 `%TEMP%` |
| `storyboard.js` 不存在 | 全新克隆后直接 `--stills` | 先 `--timeline` 或完整构建 |

---

## 9. 迁移检查清单（在 Windows 上逐项打勾）

### 环境

- [ ] `node -v` ≥ 22.12（推荐 24 LTS）
- [ ] `npm -v` 正常
- [ ] `py -3.12 -V` 正常
- [ ] `.venv\Scripts\python.exe` 存在
- [ ] `edge-tts`、`imageio-ffmpeg` 已装进 `.venv`
- [ ] `imageio_ffmpeg.get_ffmpeg_exe()` 返回真实存在的 `.exe`
- [ ] `ffmpeg -encoders` 有 `libx264`
- [ ] Chrome 或 Edge 路径存在
- [ ] `studio\node_modules` 已通过 `npm ci` 安装

### 跑通

- [ ] `node build.mjs projects/demo --timeline` 成功，输出每镜时长
- [ ] `storyboard.js` 里的中文正常，没有 `\uXXXX` 乱码
- [ ] `--stills 0,5,12,24,40` 生成 5 张图
- [ ] 截图里没有「豆腐块」缺字
- [ ] 标题/金句没有溢出画面
- [ ] 全片渲染无报错
- [ ] 成片能播放，音画同步
- [ ] `poster.png` 正常
- [ ] `video` 镜头能播放（如果项目里有）
- [ ] `--rate "+8%"` 能覆盖语速
- [ ] 二次构建命中 TTS 缓存（不会重复请求）

### 仓库

- [ ] `git status` 里没有 `.env`、`.venv`、`node_modules`、`audio/`、`out/`
- [ ] 构建后 `git status` 仍然干净（生成物都被忽略）
- [ ] `.env` 没有被提交；如果曾经提交过，立刻轮换 key
- [ ] 大文件没有超过 GitHub 100MB 限制

### 视觉

- [ ] 同一镜在 macOS 和 Windows 上各截一帧，确认只是字体差异，没有布局错位
- [ ] 深色主题下文字对比度正常（Windows 的 gamma 和 mac 不同）
- [ ] `code` 镜头的等宽字体对齐正常（Consolas vs SF Mono）

---

## 10. 可选：GitHub Actions 的 Windows 冒烟测试

如果希望每次 push 都验证 Windows 至少「能装、能解析、能启动」，可以加一个最小 workflow。注意：**不要**在 CI 里跑完整 TTS + 全片渲染，网络不稳定且太慢。

`.github/workflows/windows-smoke.yml`：

```yaml
name: windows-smoke

on:
  push:
  pull_request:

jobs:
  smoke:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install Python deps
        run: |
          python -m pip install --upgrade pip
          python -m pip install edge-tts imageio-ffmpeg

      - name: Install Node deps
        working-directory: studio
        run: npm ci

      - name: Syntax check
        run: |
          node --check studio/build.mjs
          python -m py_compile studio/tts.py

      - name: Resolve ffmpeg & Chrome
        shell: pwsh
        run: |
          python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
          Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

> `windows-latest` 预装 Chrome，但路径可能随镜像更新变化；如果要做真实截图，建议显式设置 `CHROME_PATH` 并加 `Test-Path` 断言。
>
> 想跑 `--stills` 的话，需要先有 `storyboard.js`（依赖 TTS）或者提交一个 fixture；这属于后续 CI 设计，不建议现在做。

---

## 11. 这次上传 GitHub 的约定

### 11.1 仓库里放什么

| 内容 | 是否提交 | 说明 |
|---|---|---|
| `studio/` 源码、`kit/`、`skill/` | ✅ | 核心 |
| `studio/projects/demo/`（脚本、storyboard、小图、成片） | ✅ | 样片 A，README 直接引用 |
| `studio/projects/ai-history/`（脚本、storyboard、小图） | ✅ | 样片 B，可对照 `input.raw.md` / `script.md` / `script.diff.md` |
| `demo/` 老管线源码 + `timeline.js/json` | ✅ | 仅作参考，**不含** `audio/` 和 `video_raw.mp4` |
| `compare/` 源码 + 小样本 | ✅ | 横评材料，**不含** `node_modules/` |
| `README.md`、`代码动画调研.md`、`代码动画对比.html` | ✅ | 文档 |
| `css-transform-explainer.mp4`、`poster.png` | ✅ | README 里的第一支片，约 3.5MB |
| `studio/projects/*/out/*.mp4`（除 demo） | ❌ | 生成物，文件大 |
| `studio/projects/*/audio/` | ❌ | TTS 缓存，可重建 |
| `studio/projects/politics/` | ❌ | 约 19MB 素材 + 53MB 成片，素材版权需逐张核对 |
| `.venv/`、`.conda-manim/`、`node_modules/` | ❌ | 依赖 |
| `.env` | ❌ | **含真实 MiniMax key，绝不能提交** |
| `studio/ab/`、`voice-*.mp3` | ❌ | 音色试听产物 |
| `.chrome-profile/`、`stills/`、`_tts.job*` | ❌ | 运行时产物 |

仓库预计 10–15MB（主要是两个样片视频和图片）。

### 11.2 推送命令

你建好空仓库后，把地址给我，我来执行；如果你想自己推：

```powershell
cd <仓库目录>
git init -b main
git add .
git commit -m "chore: initial import of code-animation-studio"

# 换成你的仓库地址（SSH 或 HTTPS 都行）
git remote add origin git@github.com:xuanxuan2333/<仓库名>.git
git push -u origin main
```

如果仓库里已经有 README（GitHub 建仓库时勾了），先 `git pull --rebase origin main` 再推；最省事是建**空仓库**（不要勾 README / .gitignore / license）。

### 11.3 密钥与素材

- `studio/.env` 里有真实 key，`.gitignore` 已排除。**如果这个 key 曾经出现在公开的 commit、issue、截图里，去 MiniMax 控制台轮换一次**，并检查 GitHub 的 secret scanning 提示。
- `studio/.env.example` 只保留占位符，可以提交。
- `ai-history/assets/jensen.jpg` 来自 Wikimedia Commons，`storyboard.json` 里有 `credit` 字段；保留署名。
- 如果以后要传 `politics` 的 19MB 图片，先确认每张图的作者/协议，并在 `assets/manifest.json` 或 `storyboard.json` 里补 `credit`。
- 单个文件 >50MB 时 GitHub 会警告，>100MB 直接拒绝；视频建议用 Git LFS（`.gitattributes` 加 `*.mp4 filter=lfs diff=lfs merge=lfs -text`），或者只放外链。

### 11.4 建议的仓库信息

| 项 | 建议 |
|---|---|
| 仓库名 | `code-animation-studio` 或 `codeVedio` |
| 描述 | 把口播稿编译成科普/教学动画的流水线：storyboard → TTS → 逐帧渲染 → mp4 |
| Topics | `video`, `animation`, `puppeteer`, `ffmpeg`, `edge-tts`, `nodejs`, `python`, `chinese` |
| License | 目前没有 LICENSE；如果要公开给别人用，建议加 MIT（代码）并保留素材的原始协议说明 |

---

## 12. 建议的落地顺序

| 阶段 | 做什么 | 预计 |
|---|---|---|
| 1 | 装 Node 22+/Python 3.12/Chrome，建 `.venv`，`npm ci` | 20 分钟 |
| 2 | 设 `PYTHON`、`CHROME_PATH`、`PYTHONIOENCODING`，跑 `--timeline` | 10 分钟 |
| 3 | 如果 `file://` 报错，改 5.1（`pathToFileURL`） | 5 分钟 |
| 4 | 跑 `--stills`，检查字体和版式；必要时调 `style.css` 字号 | 30 分钟 |
| 5 | 跑全片，检查音画同步、`video` 镜头 | 20 分钟 |
| 6 | 改 5.2 / 5.3 / 5.4，去掉对临时环境变量的依赖 | 30 分钟 |
| 7 | 改 5.6 / 5.8，提升稳定性 | 20 分钟 |
| 8 | （可选）打包字体、加 CI、加 `requirements.txt` | 1–2 小时 |

**P0 全部处理完，Windows 上就能稳定出片；P1/P2 是体验和长期维护问题。**

---

## 附录 A：环境变量速查

| 变量 | 作用 | 示例 |
|---|---|---|
| `PYTHON` | 指定 Python 解释器 | `C:\repo\.venv\Scripts\python.exe` |
| `CHROME_PATH` | 指定 Chrome/Edge | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| `FFMPEG` | 指定 ffmpeg | `C:\ffmpeg\bin\ffmpeg.exe` |
| `PYTHONIOENCODING` | Python 输出编码 | `utf-8` |
| `MINIMAX_API_KEY` | MiniMax 密钥 | 从 `studio/.env` 读 |
| `MINIMAX_GROUP_ID` | MiniMax Group ID | 从 `studio/.env` 读 |
| `MINIMAX_TTS_MODEL` | 配音模型 | `speech-02-hd` |
| `MINIMAX_VOICE_ID` | 默认音色 | `male-qn-qingse` |

优先级：**环境变量 > `studio/.env` > 代码默认值**（`_load_env` 不会覆盖已存在的环境变量）。

---

## 附录 B：路径对照

| 用途 | macOS | Windows |
|---|---|---|
| Python | `.venv/bin/python` | `.venv\Scripts\python.exe` |
| 激活 venv | `source .venv/bin/activate` | `.\.venv\Scripts\Activate.ps1` |
| Chrome | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Edge | `/Applications/Microsoft Edge.app/...` | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| 临时目录 | `/tmp` / `$TMPDIR` | `%TEMP%` |
| 删除目录 | `rm -rf` | `Remove-Item -Recurse -Force` |
| 列目录 | `ls` | `Get-ChildItem` |
| 批处理循环 | `for p in ...; do ...; done` | `Get-ChildItem ... \| ForEach-Object { ... }` |

---

## 附录 C：本文没有验证的部分

以下结论来自代码阅读和 macOS 实测，**没有在 Windows 实机跑过**。第一次迁移时请重点验证：

1. `file://` + `pathToFileURL` 后，Chrome 是否能正常加载本地 `index.html` 和 `assets/*.mp4`。
2. `imageio-ffmpeg` 的 Windows 二进制是否包含 `libx264` / `loudnorm` / `deesser`（预计包含，但请按 7.1 自检）。
3. Windows 上 `--disable-gpu` 的截图是否和 macOS 有明显色差。
4. 微软雅黑下的 `title` / `quote` / `bigword` 是否溢出（这是最可能出问题的地方）。
5. Chrome profile 删除是否真的会 `EPERM`（不同 Windows 版本/杀软行为不同）。
6. `edge-tts` 在公司网络/代理下是否能连通。
7. 多镜混音时 Windows 命令行长度是否触顶（28 镜的 politics 在 macOS 没问题，Windows 上限约 32767 字符，预计够用）。

---

*最后更新：2026-11 · 对应仓库状态：未提交 Windows 适配代码，仅提供迁移方案。*
