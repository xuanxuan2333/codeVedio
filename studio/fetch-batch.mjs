#!/usr/bin/env node
/**
 * 批量取图：读一份清单，逐条去 Wikimedia Commons 找图并下载。
 *
 *   node fetch-batch.mjs list.json <输出目录>
 *
 * list.json: [{"key":"01_war","query":"war painting"}, ...]
 * 文件名 = key + 扩展名，保证拼图顺序可控。
 * 输出 manifest.json：成功的项 + 署名信息；失败项记 reason。
 */
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

const [listPath, outDir] = process.argv.slice(2);
const DELAY = Number(process.env.DELAY || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const items = JSON.parse(fs.readFileSync(listPath, 'utf8'));
const UA = 'CodeAnimationStudio/1.0 (local educational video)';
const API = 'https://commons.wikimedia.org/w/api.php';

async function j(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function search(q) {
  const r = await j(`${API}?action=query&format=json&list=search&srsearch=${encodeURIComponent(q)}&srnamespace=6&srlimit=10`);
  return (r.query && r.query.search) || [];
}

async function one(it) {
  const out = path.join(outDir, it.key);
  for (const q of [it.query, it.query + ' photo', it.query + ' painting']) {
    let hits = [];
    try { hits = await search(q); } catch { continue; }
    const title = hits.find(h => /\.(jpe?g|png|webp|svg)$/i.test(h.title))?.title;
    if (!title) continue;
    try {
      const info = await j(`${API}?action=query&format=json&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1400`);
      const page = Object.values(info.query.pages)[0];
      const ii = page?.imageinfo?.[0];
      if (!ii) continue;
      const res = await fetch(ii.thumburl || ii.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const ext = (ii.thumburl || ii.url).match(/\.(jpe?g|png|webp)/i)?.[0] || '.jpg';
      const file = out + ext;
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      const meta = ii.extmetadata || {};
      return {
        ok: true, key: it.key, file,
        title,
        artist: ((meta.Artist?.value || '').replace(/<[^>]+>/g, '').trim()).slice(0, 60),
        license: (meta.LicenseShortName?.value || '').trim(),
      };
    } catch { /* try next query */ }
  }
  return { ok: false, key: it.key, reason: 'not-found' };
}

fs.mkdirSync(outDir, { recursive: true });
const out = [];
for (const it of items) {
  const existing = items.length && fs.existsSync(outDir) &&
    fs.readdirSync(outDir).find(f => f.startsWith(it.key + '.'));
  if (existing) { out.push({ ok: true, key: it.key, file: path.join(outDir, existing), cached: true }); console.log(`· ${it.key} (已有)`); continue; }
  const r = await one(it);
  if (!r.ok && DELAY) { await sleep(DELAY * 2); Object.assign(r, await one(it)); }
  out.push(r);
  console.log(r.ok ? `✓ ${it.key}` : `✗ ${it.key} (${r.reason})`);
  if (DELAY) await sleep(DELAY);
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(out, null, 1));
const ok = out.filter(x => x.ok).length;
console.log(`\n${ok}/${out.length} 张`);
