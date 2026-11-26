// 逐帧 seek + 截图 → 管道送入 ffmpeg 编码
// 用法: node render.mjs <输出mp4> [fps]
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const outFile = path.resolve(process.argv[2] || 'video_raw.mp4');
const TL = JSON.parse(fs.readFileSync('timeline.json', 'utf8'));
const fps = Number(process.argv[3] || TL.fps);
const LIMIT = Number(process.env.FRAMES || 0);
const frames = LIMIT || Math.round((TL.duration / 1000) * fps);
const W = TL.width, H = TL.height;
const profile = path.resolve(`./.chrome-profile-${process.pid}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: profile,
  protocolTimeout: 60000,
  args: [
    '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--force-color-profile=srgb', '--no-first-run',
    '--no-default-browser-check', '--disable-crash-reporter',
    `--window-size=${W},${H}`,
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto('file://' + path.resolve('index.html'), { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });

const ff = spawn(FFMPEG, [
  '-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  outFile,
], { stdio: ['pipe', 'inherit', 'inherit'] });

ff.on('error', e => { console.error('\nffmpeg 启动失败:', e.message); process.exit(1); });
ff.stdin.on('error', e => { console.error('\n管道错误:', e.message); process.exit(1); });

const write = buf => new Promise((res, rej) => {
  ff.stdin.write(buf, err => (err ? rej(err) : res()));
});

const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  await page.evaluate(t => window.seek(t), (i * 1000) / fps);
  const buf = await page.screenshot({ type: 'jpeg', quality: 95, captureBeyondViewport: false });
  await write(buf);
  if (i % 30 === 0 || i === frames - 1) {
    const el = (Date.now() - t0) / 1000;
    process.stdout.write(`帧 ${i + 1}/${frames}  ${((i + 1) / el).toFixed(1)} fps\n`);
  }
}
ff.stdin.end();
await once(ff, 'close');
await browser.close();
fs.rmSync(profile, { recursive: true, force: true });

console.log(`完成: ${outFile}  ${frames} 帧 @${fps}fps  用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
