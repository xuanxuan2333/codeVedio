/* ============================================================
   code-animation-studio · 场景库
   每个场景 = 一个 build(scene) → { el, render(t) }
   render(t) 必须是 t 的纯函数：同一时刻永远同样的画面
   ============================================================ */
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, p) => a + (b - a) * p;
const easeOut = x => 1 - Math.pow(1 - x, 3);
const easeInOut = x => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
function seg(t, a, b, ease) {
  if (b <= a) return t >= b ? 1 : 0;
  return (ease || easeOut)(clamp01((t - a) / (b - a)));
}
const h = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

/* ---------------- 01 片名卡 ---------------- */
function buildTitle(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  el.appendChild(h('div', 'kicker', p.kicker || ''));
  const wrap = h('div', 'title-wrap');
  const main = h('div', 'title-main', p.title || '');
  const sub = h('div', 'title-sub', p.sub || '');
  const rule = h('div', 'title-rule');
  const meta = h('div', 'title-meta', p.meta || '');
  wrap.append(main, sub, rule, meta);
  el.appendChild(wrap);
  el.querySelector('.kicker').style.cssText = 'position:absolute;left:118px;top:120px;opacity:0';
  return {
    el,
    render(t) {
      const k = el.querySelector('.kicker');
      k.style.opacity = seg(t, 0.05, 0.6);
      const a = seg(t, 0.1, 1.0);
      main.style.opacity = a;
      main.style.transform = `translateY(${lerp(56, 0, a)}px)`;
      const b = seg(t, 0.5, 1.25);
      sub.style.opacity = b;
      sub.style.transform = `translateY(${lerp(26, 0, b)}px)`;
      rule.style.width = lerp(0, 520, seg(t, 0.75, 1.7, easeInOut)) + 'px';
      meta.style.opacity = seg(t, 1.1, 1.8) * .95;
    },
  };
}

/* ---------------- 02 要点列表 ---------------- */
function buildBullets(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  el.appendChild(h('div', 'bullets-head h2', p.title || ''));
  const list = h('div', 'bullets-list');
  (p.items || []).forEach((txt, i) => {
    const row = h('div', 'bullet');
    row.innerHTML = `<div class="idx">${String(i + 1).padStart(2, '0')}</div><div class="txt">${txt}</div>`;
    list.appendChild(row);
  });
  el.appendChild(list);
  const rows = [...list.children];
  return {
    el,
    render(t) {
      const st = 0.25, gap = Math.min(0.55, Math.max(0.28, (s.dur - 1.2) / Math.max(1, rows.length)));
      rows.forEach((r, i) => {
        const a = seg(t, st + i * gap, st + i * gap + 0.55);
        r.style.opacity = a;
        r.style.transform = `translateX(${lerp(-36, 0, a)}px)`;
      });
    },
  };
}

/* ---------------- 03 大数字 ---------------- */
function buildStat(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  const wrap = h('div', 'stat-wrap');
  const num = h('span', 'stat-num');
  const unit = h('span', 'stat-unit', p.unit || '');
  const line = h('div');
  line.style.cssText = 'display:flex;align-items:baseline';
  line.append(num, unit);
  const label = h('div', 'stat-label', p.label || '');
  const note = h('div', 'stat-note', p.note || '');
  wrap.append(line, label, note);
  el.appendChild(wrap);
  const to = Number(p.value);
  const isNum = Number.isFinite(to);
  const dec = p.decimals != null ? Number(p.decimals) : (String(p.value).split('.')[1] || '').length;
  return {
    el,
    render(t) {
      const a = seg(t, 0.1, 0.7);
      wrap.style.opacity = a;
      wrap.style.transform = `translateY(${lerp(30, 0, a)}px)`;
      const k = seg(t, 0.2, 1.15, easeOut);
      num.textContent = isNum ? lerp(0, to, k).toFixed(dec) : String(p.value);
      label.style.opacity = seg(t, 0.6, 1.2);
      note.style.opacity = seg(t, 0.9, 1.5) * .9;
    },
  };
}

/* ---------------- 04 金句 ---------------- */
function buildQuote(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  const wrap = h('div', 'quote-wrap');
  wrap.innerHTML = `<div class="quote-mark">“</div>
    <div class="quote-text">${p.text || ''}</div>
    <div class="quote-by">${p.by || ''}</div>`;
  el.appendChild(wrap);
  return {
    el,
    render(t) {
      const a = seg(t, 0.1, 1.0);
      wrap.style.opacity = a;
      const txt = wrap.querySelector('.quote-text');
      txt.style.transform = `translateY(${lerp(28, 0, a)}px)`;
      wrap.querySelector('.quote-by').style.opacity = seg(t, 0.8, 1.5);
    },
  };
}

/* ---------------- 05 图片（支持多张轮播） ---------------- */
function buildImage(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  const wrap = h('div', 'img-wrap');
  const list = (p.srcs && p.srcs.length) ? p.srcs : [p.src];
  const layers = list.map(src => {
    const img = h('img');
    img.src = src;
    img.style.opacity = 0;
    img.onerror = () => { img.style.display = 'none'; };
    wrap.appendChild(img);
    return img;
  });
  wrap.appendChild(h('div', 'img-scrim'));
  el.appendChild(wrap);
  let cap = null;
  if (p.caption) { cap = h('div', 'img-caption', p.caption); el.appendChild(cap); }
  // 每张停留约 2.4 秒：镜头多长，就用多少张（最多不超过素材数）
  const per = 2.4;
  const want = Math.max(1, Math.min(layers.length, Math.round(s.dur / per)));
  const pick = [];
  for (let i = 0; i < want; i++) {
    pick.push(want === 1 ? layers[0] : layers[Math.round(i * (layers.length - 1) / (want - 1))]);
  }
  const used = [...new Set(pick)];
  const n = Math.max(1, used.length);
  const slotLen = () => s.dur / n;
  return {
    el,
    render(t) {
      const slot = slotLen();
      layers.forEach(l => { if (!used.includes(l)) l.style.opacity = 0; });
      used.forEach((img, j) => {
        const t0 = j * slot, t1 = (j + 1) * slot;
        if (t < t0 - 0.35 || t > t1 + 0.35) { img.style.opacity = 0; return; }
        const a = Math.min(1, (t - (t0 - 0.35)) / 0.5) * Math.min(1, ((t1 + 0.35) - t) / 0.5);
        img.style.opacity = Math.max(0, a);
        const k = clamp01((t - t0) / Math.max(0.6, slot));
        const z = (Number(p.zoom) || 1) * (1.05 + 0.07 * k);
        img.style.transform = `translate(-50%,-50%) scale(${z})`;
      });
      if (cap) cap.style.opacity = seg(t, 0.5, 1.1);
    },
  };
}

/* ---------------- 06 视频片段 ---------------- */
function buildVideo(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  const wrap = h('div', 'vid-wrap');
  const v = document.createElement('video');
  v.src = p.src; v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.loop = p.loop !== false;
  if (p.zoom) v.style.width = (Number(p.zoom) * 100) + '%';
  wrap.appendChild(v);
  wrap.appendChild(h('div', 'img-scrim'));
  el.appendChild(wrap);
  const base = Number(p.start || 0);
  return {
    el, video: v, base,
    render(t) {
      if (!window.RENDER_MODE) { if (v.paused) v.play().catch(() => {}); return; }
      const target = base + t;
      if (Math.abs(v.currentTime - target) > 0.001) {
        try { v.currentTime = target; } catch (e) { /* ignore */ }
      }
    },
  };
}

/* ---------------- 07 左右对比 ---------------- */
function buildCompare(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  if (p.title) el.appendChild(h('div', 'cmp-head h2', p.title));
  const grid = h('div', 'cmp-grid');
  const mk = (side, color, cls) => {
    const col = h('div', 'cmp-col ' + cls);
    const lab = h('div', 'cmp-label', side.label || '');
    lab.style.color = color;
    col.appendChild(lab);
    (side.items || []).forEach(it => {
      const n = h('div', 'cmp-item', it);
      col.appendChild(n);
    });
    return col;
  };
  grid.append(mk(p.left || {}, '#58a6ff', 'a'), mk(p.right || {}, '#bc8cff', 'b'));
  el.appendChild(grid);
  const items = [...grid.querySelectorAll('.cmp-item')];
  return {
    el,
    render(t) {
      items.forEach((n, i) => {
        const a = seg(t, 0.25 + i * 0.22, 0.25 + i * 0.22 + 0.5);
        n.style.opacity = a;
        n.style.transform = `translateY(${lerp(16, 0, a)}px)`;
      });
    },
  };
}

/* ---------------- 08 流程 ---------------- */
function buildFlow(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  if (p.title) el.appendChild(h('div', 'flow-head h2', p.title));
  const row = h('div', 'flow-row');
  const nodes = [], arrows = [];
  const skip = new Set(p.skip || []);
  (p.steps || []).forEach((st, i) => {
    if (i > 0) { const a = h('div', 'flow-arrow'); row.appendChild(a); arrows.push(a); }
    const n = h('div', 'flow-node' + (skip.has(i) ? ' skip' : ''));
    n.appendChild(h('div', 'flow-box', st));
    row.appendChild(n);
    nodes.push(n);
  });
  el.appendChild(row);
  let note = null;
  if (p.note) { note = h('div', 'flow-note', p.note); el.appendChild(note); }
  const n = nodes.length;
  return {
    el,
    render(t) {
      const span = Math.min(0.55, Math.max(0.3, (s.dur - 1.4) / Math.max(1, n)));
      nodes.forEach((nd, i) => {
        const a = seg(t, 0.25 + i * span, 0.25 + i * span + 0.45);
        nd.style.opacity = a;
        nd.style.transform = `translateY(${lerp(24, 0, a)}px)`;
        if (a > 0.6 && !nd.classList.contains('skip')) nd.classList.add('on');
      });
      arrows.forEach((ar, i) => {
        const a = seg(t, 0.25 + (i + 1) * span - 0.15, 0.25 + (i + 1) * span + 0.15);
        ar.style.opacity = a;
      });
      if (note) note.style.opacity = seg(t, 0.3 + n * span, 0.3 + n * span + 0.6);
    },
  };
}

/* ---------------- 09 柱状图 ---------------- */
function buildBars(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  if (p.title) el.appendChild(h('div', 'bars-head h2', p.title));
  const plot = h('div', 'bars-plot');
  const data = p.data || [];
  const max = Number(p.max) || Math.max(...data.map(d => Number(d.value)), 1);
  const bars = data.map(d => {
    const b = h('div', 'bar');
    const val = h('div', 'bar-val', String(d.value) + (p.unit || ''));
    const fill = h('div', 'bar-fill');
    b.append(val, fill);
    const name = h('div', 'bar-name', d.name || '');
    b.appendChild(name);
    plot.appendChild(b);
    return { b, val, fill };
  });
  el.appendChild(plot);
  return {
    el,
    render(t) {
      bars.forEach((o, i) => {
        const k = seg(t, 0.3 + i * 0.18, 1.5 + i * 0.18, easeInOut);
        o.fill.style.height = (k * (Number(data[i].value) / max) * 100) + '%';
        o.val.style.opacity = seg(t, 0.6 + i * 0.18, 1.1 + i * 0.18);
      });
    },
  };
}

/* ---------------- 10 代码 ---------------- */
function buildCode(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  if (p.title) el.appendChild(h('div', 'code-head h2', p.title));
  const box = h('div', 'code-box');
  box.innerHTML = `<div class="code-bar"><i style="background:#ff5f57"></i>
      <i style="background:#febc2e"></i><i style="background:#28c840"></i>
      <span style="margin-left:14px;font-family:var(--mono);font-size:19px;color:#5b6573">${p.lang || ''}</span>
    </div><div class="code-body"></div>`;
  const body = box.querySelector('.code-body');
  const lines = String(p.code || '').split('\n');
  lines.forEach(l => {
    const d = h('span', 'code-line');
    d.textContent = l || ' ';
    body.appendChild(d);
  });
  el.appendChild(box);
  const nodes = [...body.children];
  const hi = p.highlight && p.highlight.length ? p.highlight : null;
  return {
    el,
    render(t) {
      if (hi) {
        hi.forEach((ln, i) => {
          const a = seg(t, 0.4 + i * 0.5, 0.4 + i * 0.5 + 0.3);
          nodes[ln] && (nodes[ln].style.opacity = 0.28 + 0.72 * a);
          nodes[ln] && (nodes[ln].style.background = a > .5 ? '#58a6ff14' : 'transparent');
        });
      } else {
        const k = seg(t, 0.2, Math.min(2.2, s.dur * 0.7));
        nodes.forEach((n, i) => { n.style.opacity = i / nodes.length < k ? 1 : 0.28; });
      }
    },
  };
}


/* ---------------- 11 人物卡 ---------------- */
function buildPerson(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  const wrap = h('div', 'person-wrap');
  const photo = h('div', 'person-photo');
  if (p.photo) {
    const img = h('img');
    img.src = p.photo;
    img.onerror = () => { img.remove(); photo.appendChild(h('div', 'person-initial', (p.name || '?').slice(0, 1))); };
    photo.appendChild(img);
  } else {
    photo.appendChild(h('div', 'person-initial', (p.name || '?').slice(0, 1)));
  }
  const info = h('div');
  info.style.flex = '1';
  info.innerHTML = `<div class="person-name">${p.name || ''}</div>
    <div class="person-role">${p.role || ''}</div>
    <div class="person-note">${p.note || ''}</div>`;
  wrap.append(photo, info);
  el.appendChild(wrap);
  if (p.credit) {
    const c = h('div', '', p.credit);
    c.style.cssText = 'position:absolute;right:40px;bottom:150px;font-size:15px;color:#3d444d;font-family:var(--mono);transform:rotate(0deg)';
    el.appendChild(c);
  }
  return {
    el,
    render(t) {
      const a = seg(t, 0.1, 0.85);
      photo.style.opacity = a;
      photo.style.transform = `translateY(${lerp(30, 0, a)}px)`;
      const b = seg(t, 0.35, 1.15);
      info.style.opacity = b;
      info.style.transform = `translateX(${lerp(-28, 0, b)}px)`;
    },
  };
}

/* ---------------- 12 品牌卡 ---------------- */
function buildBrand(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  const wrap = h('div', 'brand-wrap');
  if (p.logo) {
    const plate = h('div', 'brand-plate');
    const img = h('img'); img.src = p.logo;
    img.onerror = () => { plate.remove(); };
    plate.appendChild(img);
    wrap.appendChild(plate);
  } else {
    const wm = h('div', 'brand-wordmark', p.name || '');
    wm.style.color = p.color || 'var(--accent)';
    wrap.appendChild(wm);
  }
  if (p.name) wrap.appendChild(h('div', 'brand-name', p.logo ? p.name : ''));
  if (p.note) wrap.appendChild(h('div', 'brand-note', p.note));
  el.appendChild(wrap);
  return {
    el,
    render(t) {
      const a = seg(t, 0.1, 0.9);
      wrap.style.opacity = a;
      wrap.style.transform = `translate(-50%,-50%) scale(${lerp(.96, 1, a)})`;
    },
  };
}


/* ---------------- 13 巨字 ---------------- */
function buildBigword(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  const wrap = h('div', 'bigword-wrap');
  wrap.innerHTML = `<div class="bigword">${p.text || ''}</div>
    ${p.sub ? `<div class="bigword-sub">${p.sub}</div>` : ''}`;
  el.appendChild(wrap);
  return {
    el,
    render(t) {
      const a = seg(t, 0.08, 0.75, easeOut);
      wrap.style.opacity = a;
      wrap.style.transform = `translate(-50%,-50%) scale(${lerp(.9, 1, a)})`;
      const sub = wrap.querySelector('.bigword-sub');
      if (sub) sub.style.opacity = seg(t, 0.6, 1.2);
    },
  };
}

/* ---------------- 14 图片墙 ---------------- */
function buildGrid(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  if (p.title) el.appendChild(h('div', 'grid-head h2', p.title));
  const items = p.items || [];
  const portrait = SB.height > SB.width;
  const wanted = Number(p.cols) || 4;
  const cols = portrait ? Math.min(wanted, 2) : wanted;
  const wrap = h('div', 'grid-wrap');
  wrap.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  wrap.style.top = p.title ? '210px' : '150px';
  const cells = items.map(it => {
    const c = h('div', 'grid-cell');
    const img = h('img'); img.src = it.src;
    c.appendChild(img);
    if (it.label) c.appendChild(h('div', 'lab', it.label));
    wrap.appendChild(c);
    return c;
  });
  el.appendChild(wrap);
  const step = Math.min(0.22, Math.max(0.06, (s.dur - 1.5) / Math.max(1, cells.length)));
  return {
    el,
    render(t) {
      cells.forEach((c, i) => {
        const a = seg(t, 0.12 + i * step, 0.12 + i * step + 0.45, easeOut);
        c.style.opacity = a;
        c.style.transform = `scale(${lerp(.94, 1, a)})`;
      });
    },
  };
}


/* ---------------- 15 动效文字（逐词弹入） ---------------- */
function buildKinetic(s) {
  const el = h('div', 'scene');
  const p = s.params || {};
  const wrap = h('div', 'kinetic');
  const line = h('div', 'kinetic-line');
  const words = p.words || [];
  const nodes = words.map((w, i) => {
    const n = h('span', 'kinetic-word', w);
    if (p.highlight != null && i === Number(p.highlight)) n.classList.add('hl');
    line.appendChild(n);
    return n;
  });
  wrap.appendChild(line);
  if (p.sub) {
    const sub = h('div', 'kinetic-sub', p.sub);
    wrap.appendChild(sub);
  }
  el.appendChild(wrap);
  const step = Math.min(0.26, Math.max(0.12, (s.dur - 1) / Math.max(1, nodes.length)));
  return {
    el,
    render(t) {
      nodes.forEach((n, i) => {
        const a = seg(t, 0.1 + i * step, 0.1 + i * step + 0.4, easeOut);
        n.style.opacity = a;
        n.style.transform = `translateY(${lerp(34, 0, a)}px) scale(${lerp(.92, 1, a)})`;
      });
      const sub = wrap.querySelector('.kinetic-sub');
      if (sub) sub.style.opacity = seg(t, 0.4 + nodes.length * step, 0.9 + nodes.length * step);
    },
  };
}

const BUILDERS = {
  title: buildTitle, bullets: buildBullets, stat: buildStat, quote: buildQuote,
  image: buildImage, video: buildVideo, compare: buildCompare, flow: buildFlow,
  bars: buildBars, code: buildCode,
  person: buildPerson, brand: buildBrand,
  bigword: buildBigword, grid: buildGrid, kinetic: buildKinetic,
};

/* ---------------- 字幕切分 ---------------- */
function captionChunks(text) {
  const clean = String(text || '').replace(/｜/g, '，').replace(/，+/g, '，').replace(/^，/, '');
  const parts = clean.split(/(?<=[。！？!?；;])/).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p.length <= 24) { out.push(p.trim()); continue; }
    let buf = '';
    for (const ch of p) {
      buf += ch;
      if (buf.length >= 20 && /[，,、：:]/.test(ch)) { out.push(buf.trim()); buf = ''; }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.length ? out : [clean];
}

/* ---------------- 引擎 ---------------- */
const SB = window.STORYBOARD;
const built = [];
let sceneEls = [];

function init() {
  const V = SB.height > SB.width;
  document.body.classList.toggle('v', V);
  document.body.classList.toggle('light', SB.theme === 'light');
  for (const el of [document.documentElement, document.body, document.getElementById('stage')]) {
    el.style.width = SB.width + 'px';
    el.style.height = SB.height + 'px';
  }
  const stage = document.getElementById('stage');
  SB.scenes.forEach((s, i) => {
    const b = BUILDERS[s.type];
    if (!b) { console.warn('未知场景类型:', s.type); return; }
    const inst = b(s);
    inst.el.dataset.i = i;
    stage.appendChild(inst.el);
    built.push(inst);
    sceneEls.push(inst.el);
  });
}

window.seek = async function (ms) {
  const t = ms / 1000;
  let cur = -1;
  for (let i = 0; i < SB.scenes.length; i++) {
    const s = SB.scenes[i];
    if (t >= s.start && t < s.start + s.dur) { cur = i; break; }
  }
  sceneEls.forEach((el, i) => {
    const s = SB.scenes[i];
    const inside = t >= s.start - 0.02 && t < s.start + s.dur + 0.02;
    if (!inside) { el.style.visibility = 'hidden'; el.style.opacity = 0; return; }
    el.style.visibility = 'visible';
    const tl = t - s.start;
    const a = Math.min(1, tl / 0.22) * Math.min(1, (s.dur - tl) / 0.16);
    el.style.opacity = Math.max(0, a);
  });

  if (cur >= 0) {
    const s = SB.scenes[cur];
    built[cur].render(t - s.start);
  }

  // 言外之意
  const asideEl = document.getElementById('aside');
  const asideTxt = (cur >= 0 && SB.scenes[cur].params && SB.scenes[cur].params.aside) || '';
  if (asideTxt) {
    if (asideEl.textContent !== asideTxt) asideEl.textContent = asideTxt;
    const s0 = SB.scenes[cur], tl0 = t - s0.start;
    asideEl.style.opacity = Math.min(1, Math.max(0, (tl0 - 0.55) / 0.5)) *
      Math.min(1, Math.max(0, (s0.dur - tl0) / 0.3));
  } else {
    asideEl.style.opacity = 0;
  }

  // 字幕
  const cap = document.getElementById('cap');
  let chunk = null, cStart = 0, cLen = 1;
  if (cur >= 0) {
    const s = SB.scenes[cur];
    const chunks = s._chunks || (s._chunks = captionChunks(s.say));
    const total = chunks.reduce((a, c) => a + c.length, 0) || 1;
    let acc = 0;
    for (const c of chunks) {
      const w = (c.length / total) * s.dur;
      if (t - s.start >= acc && t - s.start < acc + w) { chunk = c; cStart = acc; cLen = w; break; }
      acc += w;
    }
    if (!chunk && chunks.length) { chunk = chunks[chunks.length - 1]; cStart = acc - cLen; }
  }
  if (chunk) {
    if (cap.textContent !== chunk) cap.textContent = chunk;
    const tl = t - (SB.scenes[cur].start + cStart);
    cap.style.opacity = Math.min(1, tl / 0.16) * Math.min(1, (cLen - tl) / 0.14) * 0.97;
  } else {
    cap.style.opacity = 0;
  }

  document.getElementById('prog').style.width = (t / SB.duration * SB.width) + 'px';
};

init();
window.__ready = true;
