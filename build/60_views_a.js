
/* ============================================================================
   14. COMPONENTES DE VISTA
   ========================================================================== */
const IC = {
  db:'<path d="M12 2C7 2 3 3.8 3 6s4 4 9 4 9-1.8 9-4-4-4-9-4z"/><path d="M3 6v6c0 2.2 4 4 9 4s9-1.8 9-4V6"/><path d="M3 12v6c0 2.2 4 4 9 4s9-1.8 9-4v-6"/>',
  pc:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  tag:'<path d="M20.6 13.4L12 22l-9-9V3h10z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  layers:'<path d="M12 2l9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  shieldOk:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 11.5l2.2 2.2L15.5 9"/>',
  fork:'<circle cx="6" cy="4" r="2.2"/><circle cx="18" cy="4" r="2.2"/><circle cx="12" cy="20" r="2.2"/><path d="M6 6.2v3c0 2 2.7 3 6 3s6-1 6-3v-3"/><path d="M12 12.2v5.6"/>',
  win:'<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  pin:'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="2.6"/>',
  alert:'<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  check:'<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="M22 4L12 14.1l-3-3"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  ban:'<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  trend:'<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  plus:'<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  cog:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 8 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H2a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 3.6 8a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H8a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1H22a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  user:'<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  map:'<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  chart:'<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  home:'<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  star:'<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>'
};
const ico = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${IC[k] || IC.info}</svg>`;

function kpi(o) {
  return `<div class="kpi${o.st ? ' st-' + o.st : ''}"${o.go ? ` data-go="${o.go}" style="cursor:pointer"` : ''}>
    <div class="kpi-l">${ico(o.ic)}${o.label}</div>
    <div class="kpi-v">${o.value}</div>
    <div class="kpi-s">${o.sub || ''}</div>
    ${o.meter != null ? `<div class="meter"><i style="width:${Math.max(1.5, Math.min(100, o.meter)).toFixed(1)}%"></i></div>` : ''}
  </div>`;
}
function viewHead(t, p, extra) {
  return `<div class="view-h"><div class="row"><div><h1>${t}</h1>${p ? `<p>${p}</p>` : ''}</div>` +
    `<div class="spacer"></div>${extra || ''}</div></div>`;
}
function sec(t, p) {
  return `<div class="sec"><h2>${t}</h2>${p ? `<p>${p}</p>` : ''}<span class="sec-line"></span></div>`;
}

/* ---- tabla maestra reutilizable: ordena, busca y pagina ---- */
function mtable(o) {
  const id = o.id, st = sortOf(id, o.sort || { k: o.cols[1] ? o.cols[1].k : o.cols[0].k, d: -1 });
  const q = (S.qt[id] || '').trim().toLowerCase();
  let data = o.data;
  if (q) data = data.filter(r => o.cols.some(c => String(r[c.k] == null ? '' : r[c.k]).toLowerCase().includes(q)));
  const col = o.cols.find(c => c.k === st.k);
  if (col) data = data.slice().sort((a, b) => {
    let x = a[st.k], y = b[st.k];
    if (x instanceof Date || y instanceof Date) { x = x ? +x : 0; y = y ? +y : 0; }
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * st.d;
    return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), 'es') * st.d;
  });
  const lim = limitOf(id), shown = data.slice(0, lim);
  const th = o.cols.map(c => `<th data-sort="${id}|${c.k}" class="${c.n ? 'n ' : ''}${st.k === c.k ? 'on' : ''}"` +
    `${c.w ? ` style="width:${c.w}"` : ''}>${esc(c.l)}<span>${st.k === c.k ? (st.d > 0 ? '▲' : '▼') : '↕'}</span></th>`).join('');
  const tb = shown.map(r => `<tr${o.rowAttr ? ' ' + o.rowAttr(r) : ''}>` +
    o.cols.map(c => `<td class="${c.n ? 'n' : ''}${c.cls ? ' ' + c.cls : ''}">${o.cell(r, c)}</td>`).join('') + '</tr>').join('')
    || `<tr><td colspan="${o.cols.length}" style="text-align:center;padding:28px;color:var(--ink-4)">Sin resultados</td></tr>`;
  return `<div class="mt-wrap">
    <div class="mt-bar"><h3>${o.title}</h3>${o.sub ? `<span class="mini">${o.sub}</span>` : ''}
      ${o.tools || ''}
      <div class="fsearch" style="margin-left:auto;max-width:250px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input type="search" data-q="${id}" value="${esc(S.qt[id] || '')}" placeholder="Filtrar…" aria-label="Filtrar tabla">
      </div>
    </div>
    <div class="mt-scroll"><table class="mt"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>
    <div class="dt-foot"><span>Mostrando <b>${fmt(shown.length)}</b> de <b>${fmt(data.length)}</b></span>
      ${shown.length < data.length ? `<button class="btn" data-more="${id}">Ver 60 más</button>` : ''}
      ${o.foot || '<span style="margin-left:auto;color:var(--ink-4)">Pulsa una fila para ver el detalle</span>'}
    </div></div>`;
}

/* ---- lineas de tendencia multiserie ---- */
function trendMulti(labels, series, o) {
  o = o || {};
  if (labels.length < 2) return '<div class="empty">Se necesitan al menos dos lecturas guardadas para dibujar una tendencia</div>';
  const W = 620, H = 210, padL = 40, padR = 14, padT = 14, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(1, vMax(series.map(s => vMax(s.v)))) * 1.05;
  const X = i => padL + (labels.length === 1 ? plotW / 2 : plotW * i / (labels.length - 1));
  const Y = v => padT + plotH - plotH * v / max;
  let s = '';
  for (let g = 0; g <= 3; g++) {
    const y = padT + plotH - plotH * g / 3;
    s += `<line class="gridline" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"/>` +
      `<text class="axis" x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${fmt(max * g / 3)}${o.unit || ''}</text>`;
  }
  series.forEach(ser => {
    const pts = ser.v.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('L');
    if (ser.fill) s += `<path d="M${padL},${(padT + plotH).toFixed(1)}L${pts}L${X(labels.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)}Z" fill="${ser.c}" opacity=".14"/>`;
    s += `<path d="M${pts}" fill="none" stroke="${ser.c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    ser.v.forEach((v, i) => {
      const t = tipRef(`<div class="t-h">${esc(labels[i])}</div><div class="t-r"><span>${esc(ser.n)}</span><b>${fmt1(v)}${o.unit || ''}</b></div>`);
      s += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="4" fill="${ser.c}" stroke="var(--surface-1)" stroke-width="2" data-tip="${t}"/>`;
    });
  });
  const every = Math.max(1, Math.ceil(labels.length / 7));
  labels.forEach((l, i) => {
    if (i % every === 0 || i === labels.length - 1)
      s += `<text class="axis" x="${X(i).toFixed(1)}" y="${H - padB + 16}" text-anchor="middle">${esc(l)}</text>`;
  });
  const leg = series.length > 1 ? '<div class="legend">' + series.map(ser =>
    `<span><i style="background:${ser.c}"></i>${esc(ser.n)}</span>`).join('') + '</div>' : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Tendencia')}">${s}</svg>` + leg;
}

/* ============================================================================
   15. VISTA · RESUMEN EJECUTIVO (administrador)
   ========================================================================== */
function vResumen(A, rows) {
  const t = CMP.tot, p = histPrev();
  const gest = A.topApps.filter(([k]) => (rule(k) || {}).gest).length;
  const noGest = A.nApp - gest;
  const needUpd = CMP.appList.filter(o => o.bad || o.warn).length;
  const devOut = t.bad + t.warn;
  const crit = A.topApps.filter(([k]) => (rule(k) || {}).crit).length;
  const stOf = v => v >= CFG.params.umbralOk ? 'ok' : v >= CFG.params.umbralWarn ? 'warn' : 'crit';

  const kpis = [
    kpi({ ic:'pc', label:'Dispositivos', value: fmt(A.nDev), go:'equipos',
      sub: p ? `${delta(A.nDev, p.k.dev, true)} desde ${p.fecha}` : 'En el inventario cargado' }),
    kpi({ ic:'grid', label:'Aplicaciones detectadas', value: fmt(A.nApp), go:'aplicaciones',
      sub:`De <b>${fmt(A.nVendor)}</b> fabricantes` }),
    kpi({ ic:'shieldOk', label:'Cumplimiento', value: fmt1(t.pctOk) + ' %', meter: t.pctOk, st: stOf(t.pctOk), go:'cumplimiento',
      sub: `<b>${fmt(t.ok)}</b> de ${fmt(t.n)} equipos · medido sobre <b>${fmt(t.scope)}</b> apps bajo estándar` +
        (p ? ` · ${delta(t.pctOk, p.k.pctOk, true, ' pts')}` : '') }),
    kpi({ ic:'alert', label:'Equipos fuera de cumplimiento', value: fmt(t.bad), st: t.bad ? 'crit' : 'ok', go:'cumplimiento',
      sub: p ? `${delta(t.bad, p.k.bad, false)} desde ${p.fecha}` : `<b>${fmt(t.warn)}</b> más requieren atención` }),
    kpi({ ic:'fork', label:'Apps que requieren actualización', value: fmt(needUpd), st: needUpd ? 'warn' : 'ok', go:'versiones',
      sub:`<b>${fmt(A.debtTotal)}</b> instalaciones por detrás` }),
    kpi({ ic:'layers', label:'Equipos con software desactualizado', value: fmt(A.devLag.size),
      st: pct(A.devLag.size, A.nDev) > 50 ? 'serious' : 'warn', go:'versiones',
      sub:`<b>${fmt1(pct(A.devLag.size, A.nDev))} %</b> del parque` }),
    kpi({ ic:'shield', label:'Aplicaciones administradas', value: fmt(gest), go:'admin',
      sub:`<b>${fmt(noGest)}</b> sin administrar · ${fmt1(pct(gest, A.nApp))} % gestionado`, meter: pct(gest, A.nApp) }),
    kpi({ ic:'star', label:'Aplicaciones críticas', value: fmt(crit), st: CMP.critApps.length ? 'crit' : 'ok', go:'cumplimiento',
      sub: CMP.critApps.length ? `<b>${fmt(CMP.critApps.length)}</b> con incidencias` : 'Todas en versión aprobada' }),
    kpi({ ic:'ban', label:'Software no autorizado', value: fmt(CMP.noAuthApps.length),
      st: CMP.noAuthApps.length ? 'crit' : 'ok', go:'cumplimiento',
      sub: CMP.noAuthApps.length ? 'Detectado en el parque' : 'Ninguna app marcada como no permitida' }),
    kpi({ ic:'clock', label:'Sin sincronizar', value: fmt(CMP.stale.size), st: CMP.stale.size ? 'warn' : 'ok', go:'equipos',
      sub:`Más de <b>${CFG.params.syncDias}</b> días sin reportar` })
  ];

  const dn = donut([
    ['Cumplen', t.ok, 'cumpl', 'Cumple'],
    ['Requieren atención', t.warn, 'cumpl', 'Requiere atención'],
    ['No cumplen', t.bad, 'cumpl', 'No cumple']
  ].filter(d => d[1] > 0), { colors:['var(--ok)','var(--warn)','var(--crit)'], centerL:'Equipos',
    centerV: t.n, unit:'Equipos', aria:'Estado de cumplimiento del parque' });

  const riesgo = CMP.appList.filter(o => o.riesgo > 0).slice(0, 10);
  const topInst = A.topApps.slice(0, 10).map(([k, v]) => [appLabel(k), v, 'appKey', k]);

  return viewHead('Resumen', 'Estado general del parque de software sobre la selección activa.') +
    `<div class="grid kpis" style="margin-top:14px">${kpis.join('')}</div>` +
    sec('Dónde intervenir primero', 'Riesgo = equipos incumplidores, ponderado por criticidad de la aplicación') +
    `<div class="gwide">` +
      card({ title:'Estado de cumplimiento del parque',
        sub:'Un equipo está en rojo si tiene al menos una aplicación por debajo de la versión mínima o no autorizada',
        body: dn.svg, extra: dn.legend,
        table: twin(['Estado','Equipos','%'], [['Cumplen',fmt(t.ok),fmt1(pct(t.ok,t.n))+' %'],
          ['Requieren atención',fmt(t.warn),fmt1(pct(t.warn,t.n))+' %'],
          ['No cumplen',fmt(t.bad),fmt1(pct(t.bad,t.n))+' %']]) }) +
      card({ title:'Aplicaciones con mayor riesgo', sub:'Ordenadas por impacto: equipos afectados × criticidad',
        body: riesgo.length ? barH(riesgo.map(o => [appLabel(o.key), o.bad + o.warn, 'appKey', o.key,
          ['Versión aprobada', (rule(o.key) || {}).rec || '—']]),
          { unit:'Equipos con incidencia', W:560, labelW:210, trunc:32, aria:'Aplicaciones por riesgo' })
          : '<div class="empty">Ninguna aplicación incumple el estándar en esta selección</div>',
        table: twin(['Aplicación','No cumplen','Atención','Cumplen'], riesgo.map(o =>
          [appLabel(o.key), fmt(o.bad), fmt(o.warn), fmt(o.ok)])) }) +
    `</div>` +
    sec('Alertas', 'Reglas de vigilancia sobre el estado actual') +
    `<div class="alerts">${buildAlerts(A).map(a =>
      `<div class="alert ${a.lv}"><div class="alert-ic">${ico(a.ic)}</div><div class="alert-b">
        <div class="alert-t">${esc(a.t)}</div><div class="alert-d">${a.d}</div>
        ${a.act ? `<button class="alert-a" data-${a.act[0] === 'view' ? 'go' : 'goapp'}="${esc(a.act[1])}">Ver detalle</button>` : ''}
      </div></div>`).join('')}</div>` +
    sec('Aplicaciones con más instalaciones') +
    `<div class="gwide">` +
      card({ title:'Top aplicaciones por equipos', sub:'Cobertura real: en cuántos equipos aparece cada aplicación',
        body: barH(topInst, { unit:'Equipos', W:560, labelW:210, trunc:32, aria:'Aplicaciones más desplegadas' }),
        table: twin(['Aplicación','Equipos'], A.topApps.slice(0,25).map(([k,v]) => [appLabel(k), fmt(v)])) }) +
      card({ title:'Parque por versión de sistema operativo', sub:'Las builds minoritarias suelen ser las primeras en quedarse sin soporte',
        body: donut(A.osList.slice(0,6).map(([k,v]) => [k,v,'osver',k]),
          { centerL:'Equipos', unit:'Equipos', aria:'Equipos por build de SO' }).svg,
        extra: donut(A.osList.slice(0,6).map(([k,v]) => [k,v,'osver',k]), { unit:'Equipos' }).legend,
        table: twin(['Versión SO','Equipos','%'], A.osList.map(([k,v]) => [k, fmt(v), fmt1(pct(v,A.nDev))+' %'])) }) +
    `</div>`;
}

/* ============================================================================
   16. VISTA · CUMPLIMIENTO
   ========================================================================== */
function vCumplimiento(A, rows) {
  const t = CMP.tot;
  const porCat = new Map();
  CMP.app.forEach((o, k) => {
    const c = (rule(k) || {}).cat || 'Otro';
    let m = porCat.get(c); if (!m) porCat.set(c, m = { ok:0, warn:0, bad:0, na:0, apps:0, dentro:0 });
    m.ok += o.ok; m.warn += o.warn; m.bad += o.bad; m.na += o.na; m.apps++;
    if (inScope(k)) m.dentro++;
  });
  const cats = Array.from(porCat.entries())
    .sort((a,b) => (b[1].bad+b[1].warn) - (a[1].bad+a[1].warn) || b[1].dentro - a[1].dentro);

  const incum = [];
  CMP.dev.forEach((d, dev) => {
    if (d.estado === 'ok') return;
    incum.push({ dev, estado: d.estado, bad: d.bad, warn: d.warn, noAuth: d.noAuth.length,
      det: d.noAuth.concat(d.bad_).slice(0,3).map(appLabel).join(', '),
      last: d.last, stale: CMP.stale.has(dev) ? (d.staleDias || 0) : 0 });
  });

  const appsTbl = CMP.appList.map(o => {
    const r = rule(o.key) || {};
    return { key:o.key, name: appLabel(o.key), vendor: pretty(vendorOfApp(o.key)), cat: r.cat || 'Otro',
      rec: r.rec || '—', min: r.min || '—', total:o.total, ok:o.ok, warn:o.warn, bad:o.bad,
      pctOk:o.pctOk, estado:o.estado, crit: r.crit ? 1 : 0, _o:o };
  });

  return viewHead('Cumplimiento',
    `Cada equipo se evalúa contra el estándar definido en Administración. El cálculo cubre las ` +
    `<b>${fmt(t.scope)}</b> aplicaciones bajo control` +
    (CFG.params.alcance === 'todas' ? ' (alcance ampliado a todo el catálogo).'
      : ' —las administradas, las críticas y las no permitidas—. El resto del inventario se muestra pero no puntúa.') +
    ` Puedes ampliar el alcance en Administración.`) +
    `<div class="grid kpis" style="margin-top:14px">
      ${kpi({ ic:'shieldOk', label:'Equipos que cumplen', value: fmt(t.ok), st:'ok', meter: pct(t.ok,t.n),
        sub:`<b>${fmt1(t.pctOk)} %</b> del parque` })}
      ${kpi({ ic:'alert', label:'Requieren atención', value: fmt(t.warn), st:'warn', meter: pct(t.warn,t.n),
        sub:'Por debajo de la versión aprobada pero sobre la mínima' })}
      ${kpi({ ic:'ban', label:'No cumplen', value: fmt(t.bad), st:'crit', meter: pct(t.bad,t.n),
        sub:'Bajo la versión mínima o con software no permitido' })}
      ${kpi({ ic:'cog', label:'Sin estándar definido', value: fmt(A.topApps.filter(([k]) => !rule(k)).length),
        go:'admin', sub:'Aplicaciones que aún no puntúan en el cálculo' })}
    </div>` +
    sec('Cumplimiento por categoría', 'Dónde se concentra el incumplimiento') +
    `<div class="mt-wrap"><div class="mt-scroll"><table class="mt">
      <thead><tr><th>Categoría</th><th class="n">Apps</th><th class="n">Bajo control</th>
        <th style="width:190px">Reparto</th>
        <th class="n">Cumplen</th><th class="n">Atención</th><th class="n">No cumplen</th></tr></thead>
      <tbody>${cats.map(([c, m]) => `<tr data-cat="${esc(c)}"${m.dentro ? '' : ' style="opacity:.5"'}>
        <td class="name">${esc(c)}</td><td class="n">${fmt(m.apps)}</td>
        <td class="n">${m.dentro ? fmt(m.dentro) : '<span class="muted">—</span>'}</td>
        <td>${m.dentro ? cbar(m) : '<span class="mini muted">fuera del alcance</span>'}</td>
        <td class="n" style="color:var(--ok-ink)">${fmt(m.ok)}</td>
        <td class="n" style="color:var(--warn-ink)">${fmt(m.warn)}</td>
        <td class="n" style="color:var(--crit-ink)">${fmt(m.bad)}</td></tr>`).join('')}</tbody>
    </table></div></div>` +
    sec('Aplicaciones frente al estándar') +
    mtable({ id:'cmpApps', title:'Estado por aplicación',
      sub:'Pulsa una fila para ver los equipos afectados',
      data: appsTbl, sort:{ k:'bad', d:-1 },
      rowAttr: r => `data-goapp="${esc(r.key)}"`,
      cols:[
        { k:'name', l:'Aplicación', cls:'name' }, { k:'vendor', l:'Fabricante' }, { k:'cat', l:'Categoría' },
        { k:'rec', l:'Versión aprobada' }, { k:'total', l:'Equipos', n:true },
        { k:'pctOk', l:'% al día', n:true }, { k:'bad', l:'No cumplen', n:true },
        { k:'estado', l:'Estado' }],
      cell:(r,c) => {
        if (c.k === 'name') return (r.crit ? '<span title="Aplicación crítica" style="color:var(--warn)">★ </span>' : '') + esc(r.name);
        if (c.k === 'rec' || c.k === 'min') return `<span class="mono mini">${esc(r[c.k])}</span>`;
        if (c.k === 'pctOk') return `<span style="color:${r.pctOk>=95?'var(--ok-ink)':r.pctOk>=60?'var(--warn-ink)':'var(--crit-ink)'}">${fmt1(r.pctOk)} %</span>`;
        if (c.k === 'bad') return r.bad ? `<b style="color:var(--crit-ink)">${fmt(r.bad)}</b>` : '<span class="muted">0</span>';
        if (c.k === 'estado') return semaforo(r.estado);
        if (c.n) return fmt(r[c.k]);
        return esc(r[c.k]);
      } }) +
    sec('Equipos fuera de cumplimiento') +
    mtable({ id:'cmpDev', title:'Equipos con incidencias', sub:`${fmt(incum.length)} equipos`,
      data: incum, sort:{ k:'bad', d:-1 },
      rowAttr: r => `data-godev="${esc(r.dev)}"`,
      cols:[
        { k:'dev', l:'Equipo', cls:'name' }, { k:'estado', l:'Estado' },
        { k:'bad', l:'No cumplen', n:true }, { k:'warn', l:'Atención', n:true },
        { k:'noAuth', l:'No autorizadas', n:true }, { k:'det', l:'Principales incidencias' },
        { k:'stale', l:'Días sin reportar', n:true }],
      cell:(r,c) => {
        if (c.k === 'estado') return semaforo(r.estado);
        if (c.k === 'stale') return r.stale ? `<b style="color:var(--warn-ink)">${fmt(r.stale)}</b>` : '<span class="muted">—</span>';
        if (c.k === 'noAuth') return r.noAuth ? `<b style="color:var(--crit-ink)">${fmt(r.noAuth)}</b>` : '<span class="muted">0</span>';
        if (c.k === 'det') return `<span class="mini">${esc(r.det || '—')}</span>`;
        if (c.n) return fmt(r[c.k]);
        return esc(r[c.k]);
      } });
}

/* ============================================================================
   17. VISTA · APLICACIONES  (lista y detalle)
   ========================================================================== */
function vAplicaciones(A, rows) {
  if (S.sel.app) return vApp(A, rows, S.sel.app);
  const data = A.topApps.map(([k, n]) => {
    const r = rule(k) || {}, o = CMP.app.get(k) || { ok:0, warn:0, bad:0, total:n, pctOk:0, estado:'na' };
    const vm = A.appVerDev.get(k) || new Map();
    return { key:k, name: appLabel(k), vendor: pretty(vendorOfApp(k)), cat: r.cat || 'Otro',
      inst:n, vers: vm.size, rec: r.rec || '—', pctOk: o.pctOk, bad: o.bad, estado: o.estado,
      gest: r.gest ? 'Sí' : 'No', crit: r.crit ? 1 : 0, _o:o };
  });
  return viewHead('Aplicaciones', 'Catálogo detectado en el parque. Pulsa una aplicación para ver su distribución de versiones y los equipos afectados.') +
    `<div class="grid kpis" style="margin:14px 0 4px">
      ${kpi({ ic:'grid', label:'Aplicaciones', value: fmt(A.nApp), sub:`De <b>${fmt(A.nVendor)}</b> fabricantes` })}
      ${kpi({ ic:'shield', label:'Administradas', value: fmt(data.filter(d => d.gest === 'Sí').length),
        sub:'Marcadas como gestionadas en Administración' })}
      ${kpi({ ic:'star', label:'Críticas', value: fmt(data.filter(d => d.crit).length), sub:'Prioridad máxima de parcheo' })}
      ${kpi({ ic:'fork', label:'Con versiones mixtas', value: fmt(A.frag.length),
        sub:`<b>${fmt1(pct(A.frag.length, A.nApp))} %</b> del catálogo` })}
    </div><div style="height:14px"></div>` +
    mtable({ id:'apps', title:'Catálogo de aplicaciones', data, sort:{ k:'inst', d:-1 },
      rowAttr: r => `data-goapp="${esc(r.key)}"`,
      cols:[
        { k:'name', l:'Aplicación', cls:'name' }, { k:'vendor', l:'Fabricante' }, { k:'cat', l:'Categoría' },
        { k:'inst', l:'Equipos', n:true }, { k:'vers', l:'Versiones', n:true },
        { k:'rec', l:'Versión aprobada' }, { k:'pctOk', l:'% al día', n:true },
        { k:'gest', l:'Administrada' }, { k:'estado', l:'Estado' }],
      cell:(r,c) => {
        if (c.k === 'name') return (r.crit ? '<span title="Crítica" style="color:var(--warn)">★ </span>' : '') + esc(r.name);
        if (c.k === 'rec') return `<span class="mono mini">${esc(r.rec)}</span>`;
        if (c.k === 'pctOk') return r.estado === 'na' ? '<span class="muted">—</span>' :
          `<span style="color:${r.pctOk>=95?'var(--ok-ink)':r.pctOk>=60?'var(--warn-ink)':'var(--crit-ink)'}">${fmt1(r.pctOk)} %</span>`;
        if (c.k === 'gest') return r.gest === 'Sí' ? '<span class="pill y">Sí</span>' : '<span class="pill n">No</span>';
        if (c.k === 'estado') return semaforo(r.estado);
        if (c.n) return fmt(r[c.k]);
        return esc(r[c.k]);
      } });
}

/** % de equipos en la version aprobada, util incluso cuando la app no puntua. */
function enVersion(key, rec, devVer) {
  if (!rec || !devVer.size) return '—';
  let n = 0;
  devVer.forEach(v => { if (!VER_UNK.test(v) && verCmp(v, rec) >= 0) n++; });
  return fmt1(pct(n, devVer.size)) + ' %';
}
function vApp(A, rows, key) {
  const r = rule(key) || {}, o = CMP.app.get(key);
  const vm = A.appVerDev.get(key) || new Map();
  const total = (A.appDev.get(key) || new Set()).size;
  if (!total) return viewHead('Aplicación no encontrada', 'No hay datos de esta aplicación en la selección activa.') +
    `<button class="btn" data-go="aplicaciones">Volver al catálogo</button>`;
  const vers = Array.from(vm.entries()).map(([v, set]) => [v, set.size]).sort((a,b) => verCmp(b[0], a[0]));
  const latest = M.latestVer.get(key);
  const rowsApp = rows.filter(x => x.appKey === key);
  const firstTs = rowsApp.map(x => x.ts).filter(Boolean);
  // equipos afectados con su version efectiva
  const devVer = new Map();
  for (const x of rowsApp) {
    const p = devVer.get(x.device);
    if (!p || (!VER_UNK.test(x.ver) && verCmp(x.ver, p) > 0)) devVer.set(x.device, x.ver);
  }
  const devTbl = Array.from(devVer.entries()).map(([d, v]) => ({
    dev:d, ver:v, estado: evalVer(key, v), user: (rowsApp.find(x => x.device === d) || {}).user || '',
    osver: (rowsApp.find(x => x.device === d) || {}).osver || '',
    last: (CMP.dev.get(d) || {}).last || null
  }));
  // evolucion en el histórico
  const hs = HIST.filter(h => h.apps && h.apps[key]);
  const eco = hs.length > 1 ? trendMulti(hs.map(h => h.fecha),
    [{ n:'Al día', c:'var(--ok)', v: hs.map(h => h.apps[key][1]), fill:true },
     { n:'Atención', c:'var(--warn)', v: hs.map(h => h.apps[key][2]) },
     { n:'No cumplen', c:'var(--crit)', v: hs.map(h => h.apps[key][3]) }], { unit:'', aria:'Evolución del cumplimiento de la aplicación' })
    : '<div class="empty">Se necesitan al menos dos lecturas guardadas en fechas distintas para ver la evolución</div>';

  const nota = scopeNote(key);
  return `<div class="view-h"><div class="row">
      <div><div class="mini">${esc(pretty(vendorOfApp(key)))} · ${esc(r.cat || 'Sin categoría')}</div>
        <h1>${r.crit ? '<span title="Crítica" style="color:var(--warn)">★ </span>' : ''}${esc(appLabel(key))}</h1></div>
      <div class="spacer"></div>
      <button class="btn sheet-back" data-go="aplicaciones">← Todas las aplicaciones</button>
      <button class="btn" data-filterapp="${esc(key)}">Filtrar el tablero por esta app</button>
    </div></div>
    <div class="sheet" style="margin-top:14px"><dl class="facts">
      <div class="fact"><dt>Instalaciones</dt><dd class="big">${fmt(total)}</dd></div>
      <div class="fact"><dt>Versiones conviviendo</dt><dd class="big">${fmt(vm.size)}</dd></div>
      <div class="fact"><dt>Versión aprobada</dt><dd class="mono">${esc(r.rec || 'sin definir')}</dd></div>
      <div class="fact"><dt>Versión mínima</dt><dd class="mono">${esc(r.min || 'sin definir')}</dd></div>
      <div class="fact"><dt>Versión más alta detectada</dt><dd class="mono">${esc(latest || '—')}</dd></div>
      <div class="fact"><dt>% al día</dt><dd class="big" style="color:${nota ? 'var(--ink-3)' : o && o.pctOk>=95?'var(--ok-ink)':o && o.pctOk>=60?'var(--warn-ink)':'var(--crit-ink)'}">${
        nota ? enVersion(key, r.rec, devVer) : (o ? fmt1(o.pctOk)+' %' : '—')}</dd>
        ${nota ? '<div class="mini">en la versión aprobada · no puntúa</div>' : ''}</div>
      <div class="fact"><dt>Estado</dt><dd>${nota ? `<span class="sem sem-pill off">${esc(SCOPE_LAB[nota])}</span>` : semaforo(o.estado)}</dd></div>
      <div class="fact"><dt>Administrada</dt><dd>${r.gest ? 'Sí, por Intune' : 'No administrada'}</dd></div>
      <div class="fact"><dt>Detección más antigua</dt><dd>${firstTs.length ? new Date(vMin(firstTs)).toLocaleDateString('es-CO') : '—'}</dd></div>
      <div class="fact"><dt>Última detección</dt><dd>${firstTs.length ? new Date(vMax(firstTs)).toLocaleDateString('es-CO') : '—'}</dd></div>
    </dl>
    ${nota ? `<div class="banner" style="margin:16px 0 0">${ico('info')}<div>
      <b>${esc(SCOPE_LAB[nota])}.</b> ${nota === 'fuera'
        ? 'Esta aplicación tiene un estándar definido pero no entra en el cálculo de cumplimiento, ' +
          'porque no está marcada como administrada ni como crítica.'
        : 'Todavía no tiene versión aprobada, así que no puede evaluarse.'}
      <button class="alert-a" data-scopein="${esc(key)}" style="margin-top:8px">Incluir en el estándar</button>
    </div></div>` : ''}
    ${o && !nota ? `<div style="margin-top:16px">${cbar(o)}
      <div class="rep-legend"><span class="sem ok">${fmt(o.ok)} cumplen</span>
      <span class="sem warn">${fmt(o.warn)} requieren atención</span>
      <span class="sem bad">${fmt(o.bad)} no cumplen</span></div></div>` : ''}
    </div>` +
    sec('Distribución de versiones', 'Qué versión predomina y cuántos equipos siguen atrás') +
    `<div class="gwide">` +
      card({ title:'Equipos por versión', sub:`La versión aprobada es <b class="mono">${esc(r.rec || '—')}</b>; pulsa una barra para aislar esa versión`,
        body: barH(vers.map(([v, n]) => [v + (v === r.rec ? '  · aprobada' : v === latest ? '  · más alta' : ''), n, 'ver', v]),
          { unit:'Equipos', W:560, labelW:210, trunc:30, rowH:25,
            color:(d) => { const st = evalVer(key, d[3]); return st==='ok'?'var(--ok)':st==='warn'?'var(--warn)':st==='bad'?'var(--crit)':'var(--bar)'; },
            aria:'Equipos por versión' }),
        extra:`<div class="rep-legend"><span class="sem ok">Cumple</span><span class="sem warn">Requiere atención</span><span class="sem bad">No cumple</span></div>`,
        table: twin(['Versión','Equipos','% del total','Estado'], vers.map(([v,n]) =>
          [v, fmt(n), fmt1(pct(n,total))+' %', EST_LAB[evalVer(key,v)]])) }) +
      card({ title:'Evolución del cumplimiento', sub:'Comparación entre las lecturas guardadas en el navegador',
        body: eco }) +
    `</div>` +
    sec('Equipos con esta aplicación') +
    mtable({ id:'appDev', title:'Equipos afectados', sub:`${fmt(devTbl.length)} equipos`,
      data: devTbl, sort:{ k:'estado', d:1 },
      rowAttr: x => `data-godev="${esc(x.dev)}"`,
      cols:[{ k:'dev', l:'Equipo', cls:'name' }, { k:'user', l:'Usuario' },
        { k:'ver', l:'Versión instalada' }, { k:'osver', l:'Versión SO' },
        { k:'estado', l:'Estado' }, { k:'last', l:'Último reporte' }],
      cell:(x,c) => {
        if (c.k === 'estado') return semaforo(x.estado);
        if (c.k === 'ver') return `<span class="mono">${esc(x.ver)}</span>`;
        if (c.k === 'last') return x.last ? x.last.toLocaleDateString('es-CO') : '<span class="muted">—</span>';
        return esc(x[c.k] || '—');
      } });
}

/* ============================================================================
   18. VISTA · EQUIPOS  (lista y detalle)
   ========================================================================== */
function vEquipos(A, rows) {
  if (S.sel.device) return vEquipo(A, rows, S.sel.device);
  const byDev = new Map();
  for (const r of rows) {
    let d = byDev.get(r.device);
    if (!d) byDev.set(r.device, d = { dev:r.device, user:r.user, os:r.os, osver:r.osver,
      cliente:r.cliente, area:r.area, apps:new Set(), last:null });
    d.apps.add(r.appKey);
    if (r.ts && (!d.last || r.ts > d.last)) d.last = r.ts;
  }
  const data = Array.from(byDev.values()).map(d => {
    const c = CMP.dev.get(d.dev) || { ok:0, warn:0, bad:0, estado:'na', noAuth:[] };
    return { dev:d.dev, user:d.user || '—', osver:d.osver, apps:d.apps.size,
      lag: A.devLag.get(d.dev) || 0, bad:c.bad + c.noAuth.length, estado:c.estado,
      last:d.last, stale: CMP.stale.has(d.dev) ? 1 : 0, cliente:d.cliente || '', area:d.area || '' };
  });
  const t = CMP.tot;
  return viewHead('Equipos', 'Inventario por dispositivo. Pulsa un equipo para ver su ficha completa y su estado frente al estándar.') +
    `<div class="grid kpis" style="margin:14px 0 4px">
      ${kpi({ ic:'pc', label:'Dispositivos', value: fmt(A.nDev), sub:`Media de <b>${fmt1(A.avgApps)}</b> apps por equipo` })}
      ${kpi({ ic:'shieldOk', label:'Cumplen', value: fmt(t.ok), st:'ok', meter: pct(t.ok,t.n), sub:`<b>${fmt1(t.pctOk)} %</b>` })}
      ${kpi({ ic:'alert', label:'Con incidencias', value: fmt(t.warn + t.bad), st: t.bad ? 'crit' : 'warn',
        sub:`<b>${fmt(t.bad)}</b> en rojo · <b>${fmt(t.warn)}</b> en ámbar` })}
      ${kpi({ ic:'clock', label:'Sin sincronizar', value: fmt(CMP.stale.size), st: CMP.stale.size ? 'warn' : 'ok',
        sub:`Más de <b>${CFG.params.syncDias}</b> días` })}
    </div><div style="height:14px"></div>` +
    mtable({ id:'devs', title:'Inventario de dispositivos', data, sort:{ k:'lag', d:-1 },
      rowAttr: r => `data-godev="${esc(r.dev)}"`,
      cols:[{ k:'dev', l:'Equipo', cls:'name' }, { k:'user', l:'Usuario' },
        { k:'osver', l:'Versión Windows' }, { k:'apps', l:'Apps', n:true },
        { k:'lag', l:'Desactualizadas', n:true }, { k:'bad', l:'No cumplen', n:true },
        { k:'estado', l:'Cumplimiento' }, { k:'last', l:'Última sincronización' }],
      cell:(r,c) => {
        if (c.k === 'estado') return semaforo(r.estado);
        if (c.k === 'lag') return r.lag ? `<b style="color:${r.lag>15?'var(--crit-ink)':'var(--warn-ink)'}">${fmt(r.lag)}</b>` : '<span class="muted">0</span>';
        if (c.k === 'bad') return r.bad ? `<b style="color:var(--crit-ink)">${fmt(r.bad)}</b>` : '<span class="muted">0</span>';
        if (c.k === 'last') return r.last
          ? `<span class="${r.stale ? '' : 'mini'}" style="${r.stale ? 'color:var(--warn-ink);font-weight:600' : ''}">${r.last.toLocaleDateString('es-CO')}</span>`
          : '<span class="muted">—</span>';
        if (c.n) return fmt(r[c.k]);
        return esc(r[c.k] || '—');
      } });
}

function vEquipo(A, rows, dev) {
  const rr = rows.filter(x => x.device === dev);
  if (!rr.length) return viewHead('Equipo no encontrado', 'No hay datos de este equipo en la selección activa.') +
    `<button class="btn" data-go="equipos">Volver al inventario</button>`;
  const c = CMP.dev.get(dev) || { ok:0, warn:0, bad:0, na:0, estado:'na', noAuth:[], last:null };
  const f = rr[0];
  const best = new Map();
  for (const x of rr) { const p = best.get(x.appKey); if (!p || (!VER_UNK.test(x.ver) && verCmp(x.ver, p) > 0)) best.set(x.appKey, x.ver); }
  const apps = Array.from(best.entries()).map(([k, v]) => {
    const r = rule(k) || {};
    return { key:k, name: appLabel(k), vendor: pretty(vendorOfApp(k)), cat: r.cat || 'Otro',
      ver:v, rec: r.rec || '—', estado: evalVer(k, v), crit: r.crit ? 1 : 0,
      gest: r.gest ? 'Sí' : 'No', ord: { bad:0, warn:1, na:2, ok:3 }[evalVer(k, v)] };
  });
  const cpeOk = rr.filter(x => x.cpe).length;
  return `<div class="view-h"><div class="row">
      <div><div class="mini">${esc(f.cliente || f.domain || 'Equipo')}${f.area ? ' · ' + esc(f.area) : ''}</div>
        <h1>${esc(dev)}</h1></div>
      <div class="spacer"></div>
      <button class="btn sheet-back" data-go="equipos">← Todos los equipos</button>
      <button class="btn" data-filterdev="${esc(dev)}">Filtrar el tablero por este equipo</button>
    </div></div>
    <div class="sheet" style="margin-top:14px"><dl class="facts">
      <div class="fact"><dt>Estado de cumplimiento</dt><dd>${semaforo(c.estado)}</dd></div>
      <div class="fact"><dt>Usuario principal</dt><dd>${esc(f.user || 'no informado')}</dd></div>
      <div class="fact"><dt>Sistema operativo</dt><dd>${esc(f.os || 'Windows')}</dd></div>
      <div class="fact"><dt>Versión de Windows</dt><dd>${esc(f.osver)}</dd></div>
      <div class="fact"><dt>Aplicaciones</dt><dd class="big">${fmt(best.size)}</dd></div>
      <div class="fact"><dt>Desactualizadas</dt><dd class="big" style="color:var(--warn-ink)">${fmt(A.devLag.get(dev) || 0)}</dd></div>
      <div class="fact"><dt>No cumplen</dt><dd class="big" style="color:${c.bad+c.noAuth.length?'var(--crit-ink)':'var(--ok-ink)'}">${fmt(c.bad + c.noAuth.length)}</dd></div>
      <div class="fact"><dt>Última sincronización</dt><dd>${c.last ? c.last.toLocaleString('es-CO',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'sin fecha'}
        ${c.staleDias ? `<div class="mini" style="color:var(--warn-ink);font-weight:600">Hace ${fmt(c.staleDias)} días</div>` : ''}</dd></div>
      <div class="fact"><dt>Trazabilidad CPE</dt><dd>${fmt1(pct(cpeOk, rr.length))} %</dd></div>
      ${f.geo ? `<div class="fact"><dt>Ubicación</dt><dd>${esc(f.geo)}</dd></div>` : ''}
    </dl>
    <div style="margin-top:16px">${cbar(c)}
      <div class="rep-legend"><span class="sem ok">${fmt(c.ok)} al día</span>
      <span class="sem warn">${fmt(c.warn)} requieren atención</span>
      <span class="sem bad">${fmt(c.bad + c.noAuth.length)} no cumplen</span>
      <span class="sem off">${fmt(c.na)} sin estándar</span></div></div>
    </div>` +
    (c.noAuth.length ? sec('Software no autorizado') +
      `<div class="alerts"><div class="alert crit"><div class="alert-ic">${ico('ban')}</div><div class="alert-b">
        <div class="alert-t">${fmt(c.noAuth.length)} aplicaciones no permitidas en este equipo</div>
        <div class="alert-d">${c.noAuth.map(k => '<b>' + esc(appLabel(k)) + '</b>').join(' · ')}</div>
      </div></div></div>` : '') +
    sec('Aplicaciones instaladas', 'Ordenadas por severidad: primero lo que hay que corregir') +
    mtable({ id:'devApps', title:'Software del equipo', data: apps, sort:{ k:'ord', d:1 },
      rowAttr: r => `data-goapp="${esc(r.key)}"`,
      cols:[{ k:'name', l:'Aplicación', cls:'name' }, { k:'vendor', l:'Fabricante' },
        { k:'cat', l:'Categoría' }, { k:'ver', l:'Versión instalada' },
        { k:'rec', l:'Versión aprobada' }, { k:'gest', l:'Administrada' },
        { k:'ord', l:'Estado' }],
      cell:(r,c) => {
        if (c.k === 'ord') return semaforo(r.estado);
        if (c.k === 'name') return (r.crit ? '<span title="Crítica" style="color:var(--warn)">★ </span>' : '') + esc(r.name);
        if (c.k === 'ver' || c.k === 'rec') return `<span class="mono">${esc(r[c.k])}</span>`;
        if (c.k === 'gest') return r.gest === 'Sí' ? '<span class="pill y">Sí</span>' : '<span class="pill n">No</span>';
        return esc(r[c.k] || '—');
      } });
}
