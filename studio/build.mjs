#!/usr/bin/env node
/**
 * code-animation-studio · 一键出片
 *
 *   node build.mjs <项目目录>                 完整流程：配音 → 时间轴 → 逐帧渲染 → 混音 → 成片
 *   node build.mjs <项目目录> --timeline      只做配音和 storyboard.js（秒出，用来对轴）
 *   node build.mjs <项目目录> --stills 1.2,5  只截几张关键帧（用来审画面）
 *   node build.mjs <项目目录> --rate +8%    覆盖语速（不改 storyboard.json）
 *   node build.mjs <项目目录> --fps 30
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PY = process.env.PYTHON || path.join(ROOT, '.venv/bin/python');
const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function resolveFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const r = spawnSync(PY, ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']);
  if (r.status === 0) return r.stdout.toString().trim();
  return 'ffmpeg';
}

const args = process.argv.slice(2);
const proj = path.resolve(args[0] || '.');
const flag = (name) => args.includes('--' + name);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

if (!fs.existsSync(path.join(proj, 'storyboard.json'))) {
  console.error(`找不到 ${path.join(proj, 'storyboard.json')}`);
  process.exit(1);
}

const FF = resolveFfmpeg();
const sb = JSON.parse(fs.readFileSync(path.join(proj, 'storyboard.json'), 'utf8'));
const meta = { ...(sb.meta || {}) };
const rateOverride = opt('rate', null);
if (rateOverride) meta.rate = rateOverride;   // --rate +8% 覆盖本项目的语速
const FPS = Number(opt('fps', meta.fps || 30));
const W = meta.width || 1920;
const H = meta.height || 1080;
const HOLD = meta.hold != null ? Number(meta.hold) : 0.22;

// ---------- 1. 配音 ----------
let scenes = sb.scenes.map((s, i) => ({ ...s, id: s.id || `s${i + 1}` }));

if (!flag('stills')) {
  const need = scenes.filter(s => s.say && String(s.say).trim());
  if (need.length) {
    // 每句语速轻微抖动（±3%），打破机械的匀速感
    const JIT = [-3, 0, 2, -2, 3, 0];
    const baseRate = parseFloat(String(meta.rate || '+8%')) || 8;
    const job = need.map((s, i) => ({
      id: s.id, text: s.say,
      rate: `${baseRate + JIT[i % JIT.length] >= 0 ? '+' : ''}${baseRate + JIT[i % JIT.length]}%`,
    }));
    const jobPath = path.join(proj, '_tts.job.json');
    fs.writeFileSync(jobPath, JSON.stringify(job, null, 1));
    fs.mkdirSync(path.join(proj, 'audio'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'meta.json'), JSON.stringify(meta));
    console.log('配音合成…');
    const r = spawnSync(PY, [path.join(HERE, 'tts.py'), '--job', jobPath,
      '--outdir', path.join(proj, 'audio')], { stdio: 'inherit', env: { ...process.env, FFMPEG: FF } });
    if (r.status !== 0) process.exit(r.status || 1);
    const res = JSON.parse(fs.readFileSync(jobPath.replace('.json', '.result.json'), 'utf8'));
    const byId = Object.fromEntries(res.map(x => [x.id, x]));
    scenes = scenes.map(s => ({ ...s, wav: byId[s.id] ? byId[s.id].wav : null, adur: byId[s.id] ? byId[s.id].dur : 0 }));
  }
} else {
  // 截帧模式：沿用上次的时间轴
  const prev = path.join(proj, 'storyboard.js');
  if (fs.existsSync(prev)) {
    const src = fs.readFileSync(prev, 'utf8');
    const obj = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
    scenes = obj.scenes;
  }
}

// ---------- 2. 时间轴 ----------
if (!flag('stills')) {
  let t = 0;
  scenes = scenes.map(s => {
    const dur = s.dur != null ? Number(s.dur) : (s.adur || 0) + (s.hold != null ? Number(s.hold) : HOLD);
    const out = { ...s, start: Math.round(t * 1000) / 1000, dur: Math.round(dur * 1000) / 1000 };
    t += dur;
    return out;
  });
  const total = Math.round((t + 0.1) * 1000) / 1000;
  const payload = { width: W, height: H, fps: FPS, duration: total, scenes,
                    theme: meta.theme || 'dark' };
  fs.writeFileSync(path.join(proj, 'storyboard.js'), 'window.STORYBOARD = ' + JSON.stringify(payload) + ';\n');
  console.log(`时间轴 ${total.toFixed(2)}s / ${scenes.length} 镜 / ${Math.round(total * FPS)} 帧`);
  if (flag('timeline')) process.exit(0);
}

// 场景库/样式每次都要同步，否则 --stills 会用旧版式
for (const f of ['index.html', 'style.css', 'scenes.js']) {
  fs.copyFileSync(path.join(HERE, 'kit', f), path.join(proj, f));
}

const TL = JSON.parse(fs.readFileSync(path.join(proj, 'storyboard.js'), 'utf8')
  .replace('window.STORYBOARD = ', '').replace(/;\s*$/, ''));
const totalMs = TL.duration * 1000;
const frames = Math.round((totalMs / 1000) * FPS);

// ---------- 3. 渲染 ----------
const profile = path.join(proj, '.chrome-profile');
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: profile, protocolTimeout: 60000,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb',
    '--autoplay-policy=no-user-gesture-required', `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => { window.RENDER_MODE = true; });
await page.goto('file://' + path.join(proj, 'index.html'), { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });

const stills = opt('stills', null);
if (stills) {
  const dir = path.join(proj, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of stills.split(',').map(Number)) {
    await page.evaluate(t => window.seek(t), s * 1000);
    await page.screenshot({ path: path.join(dir, `t${String(s).replace('.', '_')}.png`) });
  }
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
  console.log('截图完成 →', dir);
  process.exit(0);
}

const outDir = path.join(proj, 'out');
const workDir = path.join(outDir, '_work');   // 中间产物单独放，避免和成片混在一起
fs.mkdirSync(workDir, { recursive: true });
const raw = path.join(workDir, 'video-only.mp4');
const ff = spawn(FF, ['-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', raw], { stdio: ['pipe', 'inherit', 'inherit'] });
ff.on('error', e => { console.error('ffmpeg 启动失败:', e.message); process.exit(1); });

const write = buf => new Promise((res, rej) => ff.stdin.write(buf, e => (e ? rej(e) : res())));
const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  await page.evaluate(t => window.seek(t), (i * 1000) / FPS);
  await write(await page.screenshot({ type: 'jpeg', quality: 95, captureBeyondViewport: false }));
  if (i % 60 === 0) {
    const el = (Date.now() - t0) / 1000;
    process.stdout.write(`\r帧 ${i}/${frames}  ${(i / el).toFixed(1)} fps  `);
  }
}
ff.stdin.end();
await once(ff, 'close');
await browser.close();
fs.rmSync(profile, { recursive: true, force: true });
console.log(`\n画面完成 ${frames} 帧，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------- 4. 混音 ----------
const withAudio = TL.scenes.filter(s => s.wav);
let audio = null;
if (withAudio.length) {
  const inputs = [];
  TL.scenes.forEach(s => { if (s.wav) inputs.push('-i', s.wav); });
  const filters = [];
  let k = 0;
  TL.scenes.forEach(s => {
    if (!s.wav) return;
    filters.push(`[${k}:a]adelay=delays=${Math.round(s.start * 1000)}:all=1[a${k}]`);
    k++;
  });
  const mix = Array.from({ length: k }, (_, i) => `[a${i}]`).join('');
  const fadeOut = Math.max(0.1, TL.duration - 0.9);
  filters.push(`${mix}amix=inputs=${k}:normalize=0:dropout_transition=0[raw]`);
  filters.push(`[raw]highpass=f=75,deesser=i=0.3,` +
    `acompressor=threshold=-20dB:ratio=2.2:attack=6:release=170,` +
    `loudnorm=I=-16:TP=-1.5:LRA=11,` +
    `afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeOut.toFixed(2)}:d=0.8[out]`);
  audio = path.join(workDir, 'audio.wav');
  const r = spawnSync(FF, ['-y', '-loglevel', 'error', ...inputs,
    '-filter_complex', filters.join(';'), '-map', '[out]',
    '-ar', '44100', '-ac', '2', '-t', String(TL.duration), audio]);
  if (r.status !== 0) { console.error('混音失败'); process.exit(1); }
}

// ---------- 5. 合流 ----------
const slug = meta.slug || path.basename(proj);
const final = path.join(outDir, `${slug}.mp4`);
const muxArgs = audio
  ? ['-y', '-loglevel', 'error', '-i', raw, '-i', audio, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', final]
  : ['-y', '-loglevel', 'error', '-i', raw, '-c:v', 'copy', '-movflags', '+faststart', final];
const m = spawnSync(FF, muxArgs);
if (m.status !== 0) { console.error('合流失败'); process.exit(1); }
spawnSync(FF, ['-y', '-loglevel', 'error', '-ss', '1.2', '-i', final, '-frames:v', '1',
  path.join(outDir, 'poster.png')]);
console.log('成片 →', final);
process.exit(0);   // puppeteer / ffmpeg 的句柄不会自己释放，不主动退出会挂住 && 链
