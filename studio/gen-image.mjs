#!/usr/bin/env node
/**
 * AI 文生图：网上搜不到合适素材时，生成「夸张一点」的插画。
 *
 *   node gen-image.mjs "prompt" out.png --w 1080 --h 1920 [--style cartoon]
 *
 * 优先 MiniMax（和配音用同一个 key）；失败再退回 Pollinations（免费但常限流）。
 * 环境变量：MINIMAX_API_KEY / MINIMAX_GROUP_ID（可写在 studio/.env）
 */
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

// 读 .env（不覆盖已有环境变量）
const envFile = path.join(path.dirname(new URL(import.meta.url).pathname), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const args = process.argv.slice(2);
const prompt = args[0];
const out = args[1];
const opt = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
if (!prompt || !out) {
  console.error('用法: node gen-image.mjs "<英文 prompt>" <输出图> [--w 1080] [--h 1920] [--style cartoon]');
  process.exit(2);
}

const W = Number(opt('w', 1080));
const H = Number(opt('h', 1920));
const STYLES = { light: `minimal editorial illustration on off-white paper background, black ink silhouettes, a single blue accent color, flat vector shapes, generous negative space, subtle grain, high-key, no text, no watermark`, cartoon: `exaggerated editorial cartoon illustration, bold flat shapes, high contrast, thick outlines, no text, no watermark`, poster: `bold poster illustration, geometric shapes, strong color blocks, no text, no watermark`, photo: `photorealistic, natural lighting, no text` };
const style = STYLES[opt('style', 'cartoon')] || STYLES.cartoon;
const full = `${prompt}. ${style}`;

const ratio = (() => {
  const r = W / H;
  const table = [[1, '1:1'], [16 / 9, '16:9'], [4 / 3, '4:3'], [3 / 2, '3:2'],
    [2 / 3, '2:3'], [3 / 4, '3:4'], [9 / 16, '9:16']];
  return table.sort((a, b) => Math.abs(a[0] - r) - Math.abs(b[0] - r))[0][1];
})();

async function miniMax() {
  const key = process.env.MINIMAX_API_KEY;
  const gid = (process.env.MINIMAX_GROUP_ID || '').trim();
  if (!key) return null;
  const url = 'https://api.minimaxi.com/v1/image_generation' + (gid ? `?GroupId=${gid}` : '');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'image-01', prompt: full, aspect_ratio: ratio,
      response_format: 'base64', n: 1, prompt_optimizer: true,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const j = await r.json();
  const b64 = j?.data?.image_base64?.[0];
  if (!b64) throw new Error('minimax: ' + JSON.stringify(j).slice(0, 160));
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  return { provider: 'minimax' };
}

async function pollinations() {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}` +
    `?width=${W}&height=${H}&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error('pollinations HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 4000) throw new Error('pollinations too-small');
  fs.writeFileSync(out, buf);
  return { provider: 'pollinations' };
}

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const tries = [miniMax, pollinations];
for (const fn of tries) {
  try {
    const r = await fn();
    if (!r) continue;
    console.log(JSON.stringify({ ok: true, ...r, file: path.resolve(out), prompt: full }));
    process.exit(0);
  } catch (e) {
    console.error(`  ${fn.name} 失败: ${e.message}`);
  }
}
console.log(JSON.stringify({ ok: false, reason: 'all-providers-failed' }));
process.exit(1);
