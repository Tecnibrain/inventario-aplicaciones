/* ============================================================================
   6. AGREGACION
   ========================================================================== */
function inc(map, k, v) { map.set(k, (map.get(k) || 0) + (v == null ? 1 : v)); }
function addTo(map, k, v) { let s = map.get(k); if (!s) map.set(k, s = new Set()); s.add(v); }
const sortDesc = m => Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
const sizeDesc = m => Array.from(m.entries()).map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1]);

function aggregate(rows) {
  const A = {
    n: rows.length,
    devSet: new Set(), vendorDev: new Map(), appDev: new Map(), appVers: new Map(),
    appMeta: new Map(), verOsDev: new Map(), osDev: new Map(), geoDev: new Map(),
    appVerDev: new Map(), clienteDev: new Map(), areaDev: new Map(), clienteDev: new Map(), areaDev: new Map(), clienteDev: new Map(), areaDev: new Map(), clienteDev: new Map(), areaDev: new Map(), clienteDev: new Map(), areaDev: new Map(),
    dayDev: new Map(), bucketDev: new Map(), devApps: new Map(), devLast: new Map(),
    cpeYes: 0, cpeNo: 0, vendorRows: new Map(), userSet: new Set()
  };
  for (const r of rows) {
    A.devSet.add(r.device);
    addTo(A.vendorDev, r.vendor, r.device);
    inc(A.vendorRows, r.vendor);
    addTo(A.appDev, r.appKey, r.device);
    addTo(A.appVers, r.appKey, r.ver);
    if (!A.appMeta.has(r.appKey)) A.appMeta.set(r.appKey, { vendor: r.vendor, app: r.app });
    addTo(A.devApps, r.device, r.appKey);
    addTo(A.osDev, r.osver, r.device);
    if (r.geo) addTo(A.geoDev, r.geo, r.device);
    if (r.cliente) addTo(A.clienteDev, r.cliente, r.device);
    if (r.area) addTo(A.areaDev, r.area, r.device);
    if (r.cliente) addTo(A.clienteDev, r.cliente, r.device);
    if (r.area) addTo(A.areaDev, r.area, r.device);
    if (r.cliente) addTo(A.clienteDev, r.cliente, r.device);
    if (r.area) addTo(A.areaDev, r.area, r.device);
    if (r.cliente) addTo(A.clienteDev, r.cliente, r.device);
    if (r.area) addTo(A.areaDev, r.area, r.device);
    if (r.cliente) addTo(A.clienteDev, r.cliente, r.device);
    if (r.area) addTo(A.areaDev, r.area, r.device);
    if (r.day) addTo(A.dayDev, r.day, r.device);
    addTo(A.bucketDev, r.bucket, r.device);
    if (r.user) A.userSet.add(r.user);
    r.cpe ? A.cpeYes++ : A.cpeNo++;
    if (r.ts) { const p = A.devLast.get(r.device); if (!p || r.ts > p) A.devLast.set(r.device, r.ts); }
    // cobertura app x versionSO
    let mm = A.verOsDev.get(r.appKey); if (!mm) A.verOsDev.set(r.appKey, mm = new Map());
    addTo(mm, r.osver, r.device);
    // reparto de versiones dentro de cada app
    let vv = A.appVerDev.get(r.appKey); if (!vv) A.appVerDev.set(r.appKey, vv = new Map());
    addTo(vv, r.ver, r.device);
  }
  A.nDev = A.devSet.size;
  A.nApp = A.appDev.size;
  A.nVendor = A.vendorDev.size;
  A.topVendors = sizeDesc(A.vendorDev);
  A.topApps = sizeDesc(A.appDev);
  A.osList = sizeDesc(A.osDev);
  A.geoList = sizeDesc(A.geoDev);
  A.frag = Array.from(A.appVers.entries())
    .map(([k, s]) => [k, s.size, (A.appDev.get(k) || new Set()).size])
    .filter(x => x[1] > 1).sort((a, b) => b[1] - a[1] || b[2] - a[2]);
  A.avgApps = A.nDev ? Array.from(A.devApps.values()).reduce((s, x) => s + x.size, 0) / A.nDev : 0;
  A.days = Array.from(A.dayDev.entries()).map(([k, s]) => [k, s.size]).sort((a, b) => a[0] < b[0] ? -1 : 1);
  A.buckets = BUCKETS.map(b => [b[2], (A.bucketDev.get(b[2]) || new Set()).size]);

  /* --- control de versiones: quien esta por detras de la version de referencia --- */
  A.debt = []; A.devLag = new Map(); A.debtTotal = 0; A.upToDate = 0; A.pairs = 0; A.unknownVer = 0;
  A.appVerDev.forEach((vm, k) => {
    const all = A.appDev.get(k) || new Set();
    A.pairs += all.size;
    const latest = M.latestVer ? M.latestVer.get(k) : undefined;
    if (latest === undefined) { A.unknownVer += all.size; return; }   // sin version comparable
    const cur = vm.get(latest) || new Set();
    A.upToDate += cur.size;
    const behind = [];
    all.forEach(d => { if (!cur.has(d)) behind.push(d); });
    if (behind.length) {
      A.debt.push({ key: k, behind: behind.length, total: all.size, latest, nver: vm.size });
      A.debtTotal += behind.length;
      for (const d of behind) inc(A.devLag, d);
    }
  });
  A.debt.sort((a, b) => b.behind - a.behind || b.total - a.total);
  A.lagList = sortDesc(A.devLag);
  return A;
}

/* ============================================================================
   7. MOTOR DE GRAFICOS  ·  SVG a mano, sin librerias
   ========================================================================== */
const SER = ['var(--s1)','var(--s2)','var(--s3)','var(--s4)','var(--s5)','var(--s6)','var(--s7)','var(--s8)'];
const RAMP = ['#004A56','#00626C','#007A82','#009399','#00ACB1','#00C6C9','#00E0E2','#00F8F9'];
let TIPS = [];
function tipRef(html) { TIPS.push(html); return TIPS.length - 1; }
/** Tinta legible sobre un paso concreto de la rampa (los 3 primeros son oscuros). */
const rampInk = i => i <= 2 ? 'rgba(255,255,255,.92)' : '#04211F';
/** Indice de rampa. 'sqrt' para magnitudes muy sesgadas (recuentos de versiones),
 *  'lin' para porcentajes ya acotados a 0-100. `lo` evita que un valor positivo
 *  caiga en el paso que se confunde con la superficie. */
function rampIdx(v, max, kind, lo) {
  lo = lo || 0;
  const N = RAMP.length - 1;
  if (!max || v <= 0) return lo;
  const t = Math.min(1, kind === 'lin' ? v / max : Math.sqrt(v / max));
  return Math.min(N, Math.max(lo, Math.round(lo + t * (N - lo))));
}
/** Leyenda de rampa con un punto medio real (la escala sqrt no es lineal). */
function rampScale(label, max, kind, unit) {
  const mid = kind === 'lin' ? max / 2 : max / 4;
  return `<div class="scale"><span>${esc(label)}</span>` +
    `<div class="scale-ramp">${RAMP.map(c => `<i style="background:${c}"></i>`).join('')}</div>` +
    `<span>${fmt(1)} · ${fmt(mid)} · ${fmt(max)}${unit ? ' ' + unit : ''}</span></div>`;
}
/** Rectangulo con extremo redondeado solo en el lado del dato. */
function barPath(x, y, w, h, r, dir) {
  r = Math.max(0, Math.min(r, w, h / 2));
  if (w <= 0.6) return `M${x} ${y}h${Math.max(w, .6)}v${h}h${-Math.max(w, .6)}Z`;
  if (dir === 'h') return `M${x} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - r)}Z`;
  return `M${x} ${y + r}a${r} ${r} 0 0 1 ${r} ${-r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - r}h${-w}Z`;
}
const selCls = (dim, v) => S.f[dim] ? (S.f[dim].has(v) ? ' ' : ' dim') : '';
const mkAttr = (dim, v, tip) =>
  `class="mk${selCls(dim, v)}" data-dim="${dim}" data-val="${esc(v)}" data-tip="${tip}" tabindex="0" role="button"`;

/* ---- 7.1 barras horizontales (una serie -> un color; magnitud) ---- */
function barH(data, o) {
  o = o || {};
  if (!data.length) return '<div class="empty">Sin datos para esta selección</div>';
  const n = data.length, rowH = o.rowH || 24, padT = 4, padB = 6;
  const W = o.W || 430, LW = o.labelW || 152, RW = o.RW || 42, x0 = LW + 8, plotW = W - LW - RW - 8;
  const H = padT + n * rowH + padB;
  const max = Math.max(...data.map(d => d[1])) || 1;
  const bh = Math.min(13, rowH - 10);
  let s = '';
  for (let g = 1; g <= 3; g++) {
    const x = x0 + plotW * g / 3;
    s += `<line class="gridline" x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${H - padB}"/>`;
  }
  data.forEach((d, i) => {
    const [label, v, fdim, fval, sub] = d;
    const y = padT + i * rowH + (rowH - bh) / 2;
    const w = Math.max(1, plotW * v / max);
    const t = tipRef(`<div class="t-h">${esc(o.tipTitle ? o.tipTitle(d) : label)}</div>` +
      `<div class="t-r"><span>${esc(o.unit || 'Equipos')}</span><b>${fmt(v)}</b></div>` +
      (sub ? `<div class="t-r"><span>${esc(sub[0])}</span><b>${esc(sub[1])}</b></div>` : '') +
      `<div class="t-f">Pulsa para filtrar</div>`);
    s += `<g ${mkAttr(fdim, fval, t)}>` +
      `<rect x="0" y="${padT + i * rowH}" width="${W}" height="${rowH}" fill="transparent"/>` +
      `<text class="axis-t" x="${LW}" y="${y + bh / 2 + 3.5}" text-anchor="end">${esc(truncate(label, o.trunc || 24))}</text>` +
      `<path d="${barPath(x0, y, w, bh, 4, 'h')}" fill="${o.color ? o.color(d, i) : 'var(--bar)'}"/>` +
      `<text class="vlab" x="${(x0 + w + 6).toFixed(1)}" y="${y + bh / 2 + 3.5}">${fmt(v)}</text></g>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Gráfico de barras')}">${s}</svg>`;
}

/* ---- 7.2 barras verticales (categorias ordenadas) ---- */
function barV(data, o) {
  o = o || {};
  if (!data.length) return '<div class="empty">Sin datos para esta selección</div>';
  const W = 430, H = 205, padL = 36, padR = 8, padT = 14, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(...data.map(d => d[1])) || 1;
  const step = plotW / data.length, bw = Math.min(40, step - 7);
  let s = '';
  for (let g = 0; g <= 3; g++) {
    const y = padT + plotH - plotH * g / 3;
    s += `<line class="gridline" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"/>` +
      `<text class="axis" x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${fmt(max * g / 3)}</text>`;
  }
  data.forEach((d, i) => {
    const [label, v, fdim, fval] = d;
    const h = Math.max(v > 0 ? 2 : 0, plotH * v / max);
    const x = padL + i * step + (step - bw) / 2, y = padT + plotH - h;
    const t = tipRef(`<div class="t-h">${esc(o.tipTitle ? o.tipTitle(d) : label)}</div>` +
      `<div class="t-r"><span>${esc(o.unit || 'Equipos')}</span><b>${fmt(v)}</b></div>` +
      `<div class="t-f">Pulsa para filtrar</div>`);
    s += `<g ${mkAttr(fdim, fval, t)}>` +
      `<rect x="${(padL + i * step).toFixed(1)}" y="${padT}" width="${step.toFixed(1)}" height="${plotH}" fill="transparent"/>` +
      (v > 0 ? `<path d="${barPath(x, y, bw, h, 4, 'v')}" fill="var(--bar)"/>` : '') +
      `<text class="axis" x="${(x + bw / 2).toFixed(1)}" y="${H - padB + 15}" text-anchor="middle">${esc(label)}</text>` +
      (v > 0 ? `<text class="vlab" x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${fmt(v)}</text>` : '') +
      `</g>`;
  });
  s += `<text class="axis" x="${padL + plotW / 2}" y="${H - 3}" text-anchor="middle" fill="var(--ink-4)">${esc(o.xTitle || '')}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Gráfico de barras')}">${s}</svg>`;
}

/* ---- 7.3 dona (parte-todo, <=6 sectores, con etiquetas directas) ---- */
function donut(data, o) {
  o = o || {};
  if (!data.length) return { svg: '<div class="empty">Sin datos</div>', legend: '' };
  const total = data.reduce((s, d) => s + d[1], 0) || 1;
  const CO = o.colors || SER;
  const W = 300, H = 226, cx = 150, cy = 106, R = 88, r = 56, gap = 0.022;
  let a0 = -Math.PI / 2, s = '';
  const arc = (a1, a2) => {
    const large = (a2 - a1) > Math.PI ? 1 : 0;
    const p = (ang, rad) => [(cx + rad * Math.cos(ang)).toFixed(2), (cy + rad * Math.sin(ang)).toFixed(2)];
    const [x1, y1] = p(a1, R), [x2, y2] = p(a2, R), [x3, y3] = p(a2, r), [x4, y4] = p(a1, r);
    return `M${x1} ${y1}A${R} ${R} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${r} ${r} 0 ${large} 0 ${x4} ${y4}Z`;
  };
  data.forEach((d, i) => {
    const [label, v, fdim, fval] = d;
    const span = 2 * Math.PI * v / total;
    const a1 = a0 + gap / 2, a2 = a0 + span - gap / 2;
    const share = 100 * v / total;
    const t = tipRef(`<div class="t-h">${esc(label)}</div>` +
      `<div class="t-r"><span>${esc(o.unit || 'Equipos')}</span><b>${fmt(v)}</b></div>` +
      `<div class="t-r"><span>Del total</span><b>${fmt1(share)} %</b></div><div class="t-f">Pulsa para filtrar</div>`);
    if (a2 > a1) {
      s += `<path d="${arc(a1, a2)}" fill="${CO[i % CO.length]}" ${mkAttr(fdim, fval, t)}/>`;
      if (share >= 7) {
        const mid = (a1 + a2) / 2, lr = (R + r) / 2;
        s += `<text x="${(cx + lr * Math.cos(mid)).toFixed(1)}" y="${(cy + lr * Math.sin(mid) + 4).toFixed(1)}" ` +
          `text-anchor="middle" font-size="11.5" font-weight="700" fill="rgba(0,0,0,.78)" pointer-events="none">${Math.round(share)}%</text>`;
      }
    }
    a0 += span;
  });
  s += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="26" font-weight="900" ` +
    `fill="var(--ink)" font-family="var(--font-d)">${fmt(o.centerV != null ? o.centerV : total)}</text>` +
    `<text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="10" fill="var(--ink-4)" ` +
    `letter-spacing=".08em">${esc((o.centerL || 'TOTAL').toUpperCase())}</text>`;
  const legend = '<div class="legend">' + data.map((d, i) =>
    `<span data-dim="${d[2]}" data-val="${esc(d[3])}" class="lg${selCls(d[2], d[3])}">` +
    `<i style="background:${CO[i % CO.length]}"></i>${esc(d[0])} <b>${fmt(d[1])}</b></span>`).join('') + '</div>';
  return { svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Gráfico de anillo')}">${s}</svg>`, legend };
}

/* ---- 7.4 area + linea temporal (serie unica, crosshair) ---- */
function timeline(data, o) {
  o = o || {};
  if (data.length < 2) return '<div class="empty">Se necesitan al menos dos fechas distintas</div>';
  const W = 430, H = 185, padL = 34, padR = 10, padT = 14, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(...data.map(d => d[1])) || 1;
  const X = i => padL + (data.length === 1 ? plotW / 2 : plotW * i / (data.length - 1));
  const Y = v => padT + plotH - plotH * v / max;
  let s = '';
  for (let g = 0; g <= 3; g++) {
    const y = padT + plotH - plotH * g / 3;
    s += `<line class="gridline" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"/>` +
      `<text class="axis" x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${fmt(max * g / 3)}</text>`;
  }
  const pts = data.map((d, i) => `${X(i).toFixed(1)},${Y(d[1]).toFixed(1)}`).join('L');
  s += `<path d="M${padL},${(padT + plotH).toFixed(1)}L${pts}L${X(data.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)}Z" ` +
    `fill="var(--s1)" opacity=".16"/>`;
  s += `<path d="M${pts}" fill="none" stroke="var(--bar)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const every = Math.max(1, Math.ceil(data.length / 7));
  data.forEach((d, i) => {
    const x = X(i), y = Y(d[1]);
    const t = tipRef(`<div class="t-h">${esc(d[2])}</div><div class="t-r"><span>${esc(o.unit || 'Equipos')}</span><b>${fmt(d[1])}</b></div><div class="t-f">Pulsa para filtrar</div>`);
    s += `<g ${mkAttr('day', d[0], t)}>` +
      `<rect x="${(x - plotW / data.length / 2).toFixed(1)}" y="${padT}" width="${(plotW / data.length).toFixed(1)}" height="${plotH}" fill="transparent"/>` +
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="var(--bar)" stroke="var(--surface-1)" stroke-width="2"/></g>`;
    if (i % every === 0 || i === data.length - 1)
      s += `<text class="axis" x="${x.toFixed(1)}" y="${H - padB + 16}" text-anchor="middle">${esc(d[2])}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Serie temporal')}">${s}</svg>`;
}

/* ---- 7.5 treemap "squarified" de dos niveles ---- */
function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((s, i) => s + i.v, 0);
  if (!total || w <= 0 || h <= 0) return out;
  let list = items.slice(), cx = x, cy = y, cw = w, ch = h;
  let scale = (cw * ch) / total;
  const worst = (row, len) => {
    const sum = row.reduce((s, r) => s + r.v, 0) * scale;
    const mx = Math.max(...row.map(r => r.v)) * scale, mn = Math.min(...row.map(r => r.v)) * scale;
    return Math.max((len * len * mx) / (sum * sum), (sum * sum) / (len * len * mn));
  };
  while (list.length) {
    const vertical = cw >= ch, len = vertical ? ch : cw;
    let row = [list[0]], i = 1;
    while (i < list.length && worst(row.concat(list[i]), len) <= worst(row, len)) { row.push(list[i]); i++; }
    const sum = row.reduce((s, r) => s + r.v, 0) * scale;
    const thick = len ? sum / len : 0;
    let off = 0;
    for (const it of row) {
      const frac = sum ? (it.v * scale) / sum : 0, side = len * frac;
      out.push(vertical ? { d: it, x: cx, y: cy + off, w: thick, h: side }
                        : { d: it, x: cx + off, y: cy, w: side, h: thick });
      off += side;
    }
    if (vertical) { cx += thick; cw -= thick; } else { cy += thick; ch -= thick; }
    list = list.slice(row.length);
    if (cw <= .5 || ch <= .5) break;
  }
  return out;
}

function treemap(groups, o) {
  o = o || {};
  if (!groups.length) return { svg: '<div class="empty">Sin datos para esta selección</div>', scale: '' };
  const W = 700, H = 430, pad = 2, head = 15;
  const maxColor = o.maxColor || 1;
  const outer = squarify(groups.map(g => ({ v: g.v, g })), 0, 0, W, H);
  let s = '';
  for (const cell of outer) {
    const g = cell.d.g;
    const ix = cell.x + pad, iy = cell.y + pad + (cell.h > 46 ? head : 0);
    const iw = Math.max(0, cell.w - pad * 2), ih = Math.max(0, cell.h - pad * 2 - (cell.h > 46 ? head : 0));
    s += `<rect x="${cell.x.toFixed(1)}" y="${cell.y.toFixed(1)}" width="${cell.w.toFixed(1)}" height="${cell.h.toFixed(1)}" fill="var(--surface-2)" rx="4"/>`;
    if (cell.h > 46 && cell.w > 62)
      s += `<text class="tm-grp" x="${(cell.x + 6).toFixed(1)}" y="${(cell.y + 12).toFixed(1)}">${esc(truncate(pretty(g.name), Math.floor(cell.w / 6.2)))}</text>`;
    for (const c of squarify(g.items.map(it => ({ v: it.v, it })), ix, iy, iw, ih)) {
      const it = c.d.it, ci = rampIdx(it.color, maxColor, 'sqrt', 1);
      const t = tipRef(`<div class="t-h">${esc(pretty(it.label))}</div>` +
        `<div class="t-r"><span>Fabricante</span><b>${esc(pretty(g.name))}</b></div>` +
        `<div class="t-r"><span>Equipos</span><b>${fmt(it.v)}</b></div>` +
        `<div class="t-r"><span>${esc(o.colorLabel || 'Versiones distintas')}</span><b>${fmt(it.color)}</b></div>` +
        `<div class="t-f">Pulsa para filtrar</div>`);
      const w = Math.max(0, c.w - 1.6), h = Math.max(0, c.h - 1.6);
      s += `<g ${mkAttr('appKey', it.key, t)}>` +
        `<rect x="${(c.x + .8).toFixed(1)}" y="${(c.y + .8).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ` +
        `fill="${RAMP[ci]}" rx="2.5"/>`;
      if (w > 54 && h > 20) {
        const lt = ci <= 2 ? ' lt' : '';
        s += `<text class="tm-lab${lt}" x="${(c.x + 5).toFixed(1)}" y="${(c.y + 13).toFixed(1)}">${esc(truncate(pretty(it.label), Math.floor(w / 5.6)))}</text>`;
        if (h > 33) s += `<text class="tm-val${lt}" x="${(c.x + 5).toFixed(1)}" y="${(c.y + 25).toFixed(1)}">${fmt(it.v)}</text>`;
      }
      s += `</g>`;
    }
  }
  const scale = rampScale((o.colorLabel || 'Versiones') + ':', maxColor, 'sqrt', '');
  return { svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Mapa de portafolio')}">${s}</svg>`, scale };
}

/* ---- 7.5b reparto de versiones (rampa ORDINAL: lo mas reciente, lo mas brillante) ---- */
const ORD = ['#00F8F9', '#00E0E2', '#00C6C9', '#00ACB1', '#009399', '#007A82', '#00626C'];
const ordInk = i => i <= 3 ? '#04211F' : 'rgba(255,255,255,.94)';

/** items: [{key,label,total,ok,segs:[{lab,v,rank,latest}]}] */
function versionBars(items, o) {
  o = o || {};
  if (!items.length) return '<div class="empty">Nada que comparar: cada aplicación tiene una sola versión</div>';
  const W = 560, rowH = 38, padT = 2, padB = 4, RW = 74, plotW = W - RW;
  const H = padT + items.length * rowH + padB;
  let s = '';
  items.forEach((it, i) => {
    const y = padT + i * rowH, bh = 15, by = y + 17;
    const share = pct(it.ok, it.total);
    s += `<text class="axis-t" x="0" y="${y + 11}" font-weight="600">${esc(truncate(it.label, 44))}</text>` +
      `<text class="axis" x="${W}" y="${y + 11}" text-anchor="end">` +
      `<tspan fill="${share >= 90 ? '#5FD46A' : share >= 60 ? 'var(--warn)' : '#E86C6C'}" font-weight="700">${fmt(it.ok)}</tspan>` +
      `<tspan fill="var(--ink-4)">/${fmt(it.total)} al día</tspan></text>`;
    let x = 0;
    const tot = it.segs.reduce((a, g) => a + g.v, 0) || 1;
    // suelo de 5px: una version con 2 equipos seguiria siendo invisible e inalcanzable,
    // y suele ser justo la mas reciente, que es lo que hay que poder ver
    const MINW = 5, gap = 2;
    const free = plotW - it.segs.length * gap;
    const small = it.segs.filter(g => free * g.v / tot < MINW).length;
    const scale = (free - small * MINW) / (tot - it.segs.filter(g => free * g.v / tot < MINW)
      .reduce((a, g) => a + g.v, 0) || 1);
    it.segs.forEach(g => {
      const w = free * g.v / tot < MINW ? MINW : Math.max(MINW, g.v * scale);
      const ci = Math.min(ORD.length - 1, g.rank);
      const t = tipRef(`<div class="t-h">${esc(g.lab)}${g.latest ? ' · última' : ''}</div>` +
        `<div class="t-r"><span>${esc(it.label)}</span><b></b></div>` +
        `<div class="t-r"><span>Equipos</span><b>${fmt(g.v)}</b></div>` +
        `<div class="t-r"><span>De la app</span><b>${fmt1(pct(g.v, it.total))} %</b></div>` +
        `<div class="t-f">Pulsa para filtrar</div>`);
      s += `<g ${mkAttr(o.dim || 'appKey', o.dim === 'ver' ? g.lab : it.key, t)}>` +
        `<rect x="${x.toFixed(1)}" y="${by}" width="${w.toFixed(1)}" height="${bh}" rx="3" fill="${ORD[ci]}"/>`;
      if (w > 52) s += `<text x="${(x + 5).toFixed(1)}" y="${by + 11}" font-size="9.5" font-weight="700" ` +
        `fill="${ordInk(ci)}" pointer-events="none">${esc(truncate(g.lab, Math.floor(w / 5.2)))}</text>`;
      if (g.latest) s += `<path d="M${(x + w / 2 - 3.2).toFixed(1)} ${by - 3.4}h6.4l-3.2 3.4Z" fill="var(--brand)"/>` +
        `<rect x="${x.toFixed(1)}" y="${by}" width="${w.toFixed(1)}" height="${bh}" rx="3" fill="none" ` +
        `stroke="var(--brand)" stroke-width="1.4"/>`;
      s += `</g>`;
      x += w + gap;
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Reparto de versiones')}">${s}</svg>`;
}

/* ---- 7.6 mapa de calor (magnitud, rampa de una tonalidad) ---- */
function heatmap(rowsIn, colsIn, get, o) {
  o = o || {};
  if (!rowsIn.length || !colsIn.length) return { svg: '<div class="empty">Sin datos suficientes</div>', scale: '' };
  const LW = 214, CW = Math.min(84, Math.max(46, (620 - LW) / colsIn.length)), RH = 25, TH = 30;
  const W = LW + CW * colsIn.length + 6, H = TH + rowsIn.length * RH + 6;
  let s = '';
  colsIn.forEach((c, j) => {
    s += `<text class="hm-lab" x="${(LW + j * CW + CW / 2).toFixed(1)}" y="${TH - 11}" text-anchor="middle" ` +
      `font-weight="600" fill="var(--ink-2)">${esc(truncate(c.label, Math.floor(CW / 6)))}</text>` +
      `<text class="hm-lab" x="${(LW + j * CW + CW / 2).toFixed(1)}" y="${TH - 1}" text-anchor="middle" ` +
      `font-size="9.5">${fmt(c.n)} eq.</text>`;
  });
  rowsIn.forEach((r, i) => {
    const y = TH + i * RH;
    s += `<text class="axis-t" x="${LW - 9}" y="${y + RH / 2 + 4}" text-anchor="end">${esc(truncate(pretty(r.label), 30))}</text>`;
    colsIn.forEach((c, j) => {
      const cell = get(r, c);
      const ci = cell.v > 0 ? rampIdx(cell.v, o.max || 100, 'lin', 1) : -1;
      const x = LW + j * CW;
      const t = tipRef(`<div class="t-h">${esc(pretty(r.label))}</div>` +
        `<div class="t-r"><span>${esc(c.label)}</span><b>${fmt1(cell.v)} %</b></div>` +
        `<div class="t-r"><span>Equipos con la app</span><b>${fmt(cell.a)} de ${fmt(cell.b)}</b></div>` +
        `<div class="t-f">Pulsa para filtrar</div>`);
      s += `<g ${mkAttr('appKey', r.key, t)}>` +
        `<rect x="${(x + 1).toFixed(1)}" y="${(y + 1).toFixed(1)}" width="${(CW - 2).toFixed(1)}" height="${RH - 2}" ` +
        `rx="3" fill="${ci < 0 ? 'var(--surface-2)' : RAMP[ci]}"/>` +
        (cell.b ? `<text class="hm-val" x="${(x + CW / 2).toFixed(1)}" y="${(y + RH / 2 + 3.5).toFixed(1)}" ` +
          `text-anchor="middle" fill="${ci < 0 ? 'var(--ink-4)' : rampInk(ci)}">${Math.round(cell.v)}</text>` : '') +
        `</g>`;
    });
  });
  const scale = `<div class="scale"><span>0 %</span><div class="scale-ramp">` +
    RAMP.map(c => `<i style="background:${c}"></i>`).join('') + `</div><span>100 % de cobertura</span></div>`;
  return { svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Mapa de calor')}">${s}</svg>`, scale };
}

/* ---- 7.7 mapa geografico de burbujas ---- */
function geoMap(points, o) {
  o = o || {};
  if (!points.length) return { svg: '', legend: '' };
  // Lienzo equirectangular: x = lon+180 (0..360), y = 85-lat (0..170)
  const xs = points.map(p => p.lon + 180), ys = points.map(p => 85 - p.lat);
  let x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
  let y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  const px = Math.max(9, (x1 - x0) * .35), py = Math.max(7, (y1 - y0) * .35);
  x0 -= px; x1 += px; y0 -= py; y1 += py;
  let vw = x1 - x0, vh = y1 - y0;
  const AR = 1.8;                                  // encuadre panoramico estable
  if (vw / vh < AR) { const n = vh * AR; x0 -= (n - vw) / 2; vw = n; }
  else { const n = vw / AR; y0 -= (n - vh) / 2; vh = n; }
  vw = Math.min(vw, 360); vh = Math.min(vh, 170);
  x0 = Math.max(0, Math.min(x0, 360 - vw));
  y0 = Math.max(0, Math.min(y0, 170 - vh));

  const max = Math.max.apply(null, points.map(p => p.v)) || 1;
  const rMax = Math.max(2.5, Math.min(13, vw / 14));
  let s = `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${vw.toFixed(1)}" height="${vh.toFixed(1)}" fill="#0C1113"/>`;
  for (let g = -180; g <= 180; g += 30) s += `<line class="geo-grat" x1="${g + 180}" y1="0" x2="${g + 180}" y2="170"/>`;
  for (let g = -60; g <= 60; g += 30) s += `<line class="geo-grat" x1="0" y1="${85 - g}" x2="360" y2="${85 - g}"/>`;
  s += `<path class="geo-land" d="${WORLD_PATH}"/>`;
  // mayores primero: las burbujas pequenas quedan encima y siguen siendo alcanzables
  points.slice().sort((a, b) => b.v - a.v).forEach(p => {
    const cx = p.lon + 180, cy = 85 - p.lat, r = Math.max(rMax * Math.sqrt(p.v / max), 1.4);
    const t = tipRef(`<div class="t-h">${esc(p.label)}</div>` +
      `<div class="t-r"><span>Equipos</span><b>${fmt(p.v)}</b></div>` +
      `<div class="t-r"><span>Registros</span><b>${fmt(p.rows)}</b></div><div class="t-f">Pulsa para filtrar</div>`);
    s += `<g ${mkAttr('geo', p.key, t)}>` +
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="var(--bar)" fill-opacity=".42" ` +
      `stroke="var(--surface-1)" stroke-width="2" vector-effect="non-scaling-stroke"/>` +
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="none" ` +
      `stroke="var(--q8)" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${Math.max(r * .22, .6).toFixed(2)}" fill="var(--q8)"/></g>`;
  });
  const legend = '<div class="legend">' + points.slice().sort((a, b) => b.v - a.v).slice(0, 10).map(p =>
    `<span data-dim="geo" data-val="${esc(p.key)}" class="lg${selCls('geo', p.key)}">` +
    `<i style="background:var(--bar);border-radius:50%"></i>${esc(p.label)} <b>${fmt(p.v)}</b></span>`).join('') + '</div>';
  return {
    svg: `<svg viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}" ` +
      `preserveAspectRatio="xMidYMid meet" style="overflow:hidden;border-radius:10px;max-height:400px" role="img" ` +
      `aria-label="Mapa de burbujas por ubicación">${s}</svg>`, legend };
}

/* ============================================================================
   8. TARJETAS + TABLAS GEMELAS
   ========================================================================== */
let CARD_N = 0;
function card(o) {
  const id = 'c' + (++CARD_N);
  return `<section class="card">
    <div class="card-h"><div><h3>${o.title}</h3>${o.sub ? `<p>${o.sub}</p>` : ''}</div>
      <div class="card-tools">${o.table ? `<button class="tbtn" data-tw="${id}" aria-pressed="false" title="Ver los mismos datos como tabla">Tabla</button>` : ''}</div>
    </div>
    <div class="plot" id="p-${id}">${o.body}${o.extra || ''}</div>
    ${o.table ? `<div class="tview" id="t-${id}" hidden>${o.table}</div>` : ''}
  </section>`;
}
function twin(heads, rows) {
  return `<table><thead><tr>${heads.map((h, i) => `<th${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

