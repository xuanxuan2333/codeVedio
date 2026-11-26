#!/usr/bin/env node
/**
 * 合并并行产出的分镜分片。
 *
 *   node merge.mjs projects/xx            # 读 chunks/*.json，写 storyboard.json
 *
 * 约定：
 *   chunks/00-meta.json   可选，覆盖 meta
 *   chunks/1*.json        分片，每个 { "scenes": [...] }
 * 分片按文件名排序拼接，顺序即播放顺序。
 */
import fs from 'node:fs';
import path from 'node:path';

const proj = path.resolve(process.argv[2] || '.');
const dir = path.join(proj, 'chunks');
if (!fs.existsSync(dir)) { console.error('没有 chunks/ 目录'); process.exit(1); }

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
let meta = null;
const scenes = [];
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (d.meta) meta = d.meta;
  if (Array.isArray(d.scenes)) scenes.push(...d.scenes);
  console.log(`  ${f}  +${d.scenes ? d.scenes.length : 0} 镜`);
}
if (!scenes.length) { console.error('没有镜头'); process.exit(1); }

const prev = fs.existsSync(path.join(proj, 'storyboard.json'))
  ? JSON.parse(fs.readFileSync(path.join(proj, 'storyboard.json'), 'utf8')) : {};
const out = { meta: meta || prev.meta || {}, scenes };
fs.writeFileSync(path.join(proj, 'storyboard.json'), JSON.stringify(out, null, 2));
console.log(`合并完成：${scenes.length} 镜 → storyboard.json`);
