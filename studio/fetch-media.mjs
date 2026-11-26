#!/usr/bin/env node
/**
 * 取素材：先查 Wikimedia Commons，拿到可用的图就下载，拿不到就返回 ok:false。
 *
 *   node fetch-media.mjs "黄仁勋" projects/xx/assets/person-jensen.png
 *   node fetch-media.mjs "Nvidia" projects/xx/assets/brand-nvidia.png --brand
 *
 * 输出一行 JSON：{ok,title,file,thumb,artist,license}
 * 失败了不要硬造：调用方应退回「文字卡」场景。
 */
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

const args2 = process.argv.slice(2);
const query = args2[0];
const out = args2[1];
const COUNT = Number((args2.find((a, i) => args2[i - 1] === '--count')) || 1);
const isBrand = process.argv.includes('--brand');
if (!query || !out) {
  console.error('用法: node fetch-media.mjs "<查询词>" <输出图片路径> [--brand]');
  process.exit(2);
}

const UA = 'CodeAnimationStudio/1.0 (local educational video; contact: local)';
const API = 'https://commons.wikimedia.org/w/api.php';

async function json(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// 1) 搜索文件
async function search(q) {
  const r = await json(`${API}?action=query&format=json&list=search` +
    `&srsearch=${encodeURIComponent(q)}&srnamespace=6&srlimit=10`);
  return (r.query && r.query.search) || [];
}
let hits = await search(query);
if (!hits.some(h => /\.(jpe?g|png|webp|svg)$/i.test(h.title))) {
  hits = await search(query + (isBrand ? ' logo' : ' photo'));
}
if (!hits.length) { console.log(JSON.stringify({ ok: false, reason: 'no-result' })); process.exit(0); }

// 2) 只保留位图（或能转位图的 SVG），按顺序取前 COUNT 个不重复的
const bitmap = hits.filter(h => /\.(jpe?g|png|webp|svg)$/i.test(h.title));
if (!bitmap.length) { console.log(JSON.stringify({ ok: false, reason: 'no-bitmap' })); process.exit(0); }
const picked = [];
const seen = new Set();
for (const h of bitmap) {
  const norm = h.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
  if (seen.has(norm)) continue;
  seen.add(norm);
  picked.push(h.title);
  if (picked.length >= COUNT) break;
}

// 3) 批量拿缩略图地址和署名（一次请求搞定多张）
const info = await json(`${API}?action=query&format=json&titles=${encodeURIComponent(picked.join('|'))}` +
  `&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1400`);
const pages = Object.values(info.query.pages);
const results = [];

for (let i = 0; i < picked.length; i++) {
  const page = pages.find(p => p.title === picked[i]);
  const ii = page?.imageinfo?.[0];
  if (!ii) continue;
  const url = ii.thumburl || ii.url;
  const meta = ii.extmetadata || {};
  const artist = ((meta.Artist?.value || '').replace(/<[^>]+>/g, '').trim()).slice(0, 80);
  const license = (meta.LicenseShortName?.value || '').trim();
  const ext = (url.match(/\.(jpe?g|png|webp)/i)?.[0] || '.jpg');
  const base = out.replace(/\.[a-z]+$/i, '');
  const file = COUNT > 1 ? `${base}_${i + 1}${ext}` : `${base}${ext}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    results.push({ file: path.resolve(file), artist, license });
    await new Promise(r => setTimeout(r, 900));
  } catch { /* skip */ }
}

console.log(JSON.stringify({ ok: results.length > 0, count: results.length, items: results }));
