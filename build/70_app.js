
/* ============================================================================
   24. NAVEGACION Y RENDER
   ========================================================================== */
function renderNav(A) {
  const cli = S.mode === 'cliente';
  const badge = {
    cumplimiento: CMP.tot.bad ? { n: CMP.tot.bad, c: 'alert' } : null,
    equipos: CMP.stale.size ? { n: CMP.stale.size, c: 'warn' } : null,
    versiones: A.debt.length ? { n: A.debt.length, c: '' } : null,
    admin: Object.values(CFG.apps).filter(r => r.auto).length ? { n: Object.values(CFG.apps).filter(r => r.auto).length, c: 'warn' } : null
  };
  const item = id => {
    const v = VIEWS[id], b = badge[id];
    return `<a data-go="${id}"${S.view === id ? ' aria-current="page"' : ''} tabindex="0" role="link">` +
      `${ico(v.ic)}${esc(v.l)}${b && !cli ? `<b class="${b.c}">${fmt(b.n)}</b>` : ''}</a>`;
  };
  $('#nav').innerHTML = cli
    ? `<div class="nav-grp">Vista cliente</div>` + ['resumen','informe','tendencias'].map(item).join('')
    : `<div class="nav-grp">Panel</div>` + ['resumen','cumplimiento'].map(item).join('') +
      `<div class="nav-grp">Inventario</div>` + ['aplicaciones','equipos','versiones','mapas'].map(item).join('') +
      `<div class="nav-grp">Gestión</div>` + ['datos','tendencias','informe','admin'].map(item).join('');
}

function fsel(dim, label, entries) {
  if (!entries.length) return '';
  const cur = S.f[dim] && S.f[dim].size === 1 ? Array.from(S.f[dim])[0] : '';
  return `<select class="fsel" data-fdim="${dim}" aria-label="${esc(label)}"><option value="">${esc(label)}</option>` +
    entries.map(([k, v]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>` +
      `${esc(truncate(pretty(String(k)), 32))}${v != null ? ' (' + fmt(v) + ')' : ''}</option>`).join('') + '</select>';
}
function renderFilters() {
  const F = M.aggFull;
  const cats = new Map();
  F.appDev.forEach((s, k) => { const c = (rule(k) || {}).cat || 'Otro'; cats.set(c, (cats.get(c) || 0) + 1); });
  let h = '';
  if (M.hasCliente) h += fsel('cliente', 'Cliente · todos', sizeDesc(F.clienteDev).slice(0, 100));
  if (M.hasArea) h += fsel('area', 'Área · todas', sizeDesc(F.areaDev).slice(0, 100));
  h += fsel('vendor', 'Fabricante · todos', F.topVendors.slice(0, 150));
  h += fsel('cat', 'Categoría · todas', Array.from(cats.entries()).sort((a, b) => b[1] - a[1]));
  h += fsel('osver', 'Versión SO · todas', F.osList);
  h += fsel('cumpl', 'Cumplimiento · todo', [['Cumple', null], ['Requiere atención', null], ['No cumple', null], ['Sin estándar', null]]);
  if (M.hasGeo) h += fsel('geo', 'Ubicación · todas', F.geoList.slice(0, 100));
  $('#selHost').innerHTML = h;
}
function renderChips() {
  let h = '';
  for (const d of activeDims()) for (const v of S.f[d])
    h += `<span class="chip"><i>${esc(DIMS[d] || d)}</i><b>${esc(truncate(pretty(String(v)), 34))}</b>` +
      `<button data-rm-dim="${d}" data-rm-val="${esc(v)}" aria-label="Quitar filtro">×</button></span>`;
  if (S.q.trim()) h += `<span class="chip"><i>Búsqueda</i><b>${esc(S.q)}</b><button data-rm-q="1" aria-label="Quitar búsqueda">×</button></span>`;
  if (h) h += `<button class="chip-clear" id="clearAll">Limpiar todo</button>`;
  $('#chips').innerHTML = h;
}

let RAF = 0;
function render() {
  clearTimeout(RAF);
  RAF = setTimeout(() => {
    TIPS = []; CARD_N = 0;
    // filtrar por cumplimiento exige conocer el estado antes de filtrar
    if (S.f.cumpl) computeCompliance(M.rows);
    const rows = filterRows();
    const A = aggregate(rows);
    computeCompliance(rows);
    document.body.dataset.mode = S.mode;
    document.body.classList.toggle('mode-cliente', S.mode === 'cliente');
    renderNav(A); renderFilters(); renderChips();
    const v = VIEWS[S.view] || VIEWS.resumen;
    $('#view').innerHTML = v.f(A, rows);
    $('#fileName').textContent = M.sources.length > 1
      ? M.sources.length + ' archivos' : truncate((M.sources[0] || {}).name || '—', 26);
    $('#fileName').title = M.sources.map(s => s.name + ' (' + s.shape + ', ' + fmt(s.filas) + ')').join(String.fromCharCode(10));
    $('#fileRows').textContent = '· ' + fmt(M.rows.length) + ' filas';
    $('#brandSub').textContent = CFG.org || 'Gestión de software y cumplimiento';
    $('#mAdmin').setAttribute('aria-pressed', S.mode === 'admin' ? 'true' : 'false');
    $('#mCliente').setAttribute('aria-pressed', S.mode === 'cliente' ? 'true' : 'false');
  }, 0);
}

/* ============================================================================
   25. EXPORTACION  ·  CSV, Excel (.xlsx generado a mano) y PDF por impresión
   ========================================================================== */
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const ENC = new TextEncoder();
const xesc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

async function deflateRaw(u8) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const st = new Blob([u8]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(st).arrayBuffer());
  } catch (e) { return null; }
}
/** Empaqueta un ZIP mínimo (lo que es un .xlsx). Comprime si el navegador puede. */
async function makeZip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const nameU8 = ENC.encode(f.name), raw = ENC.encode(f.data);
    const crc = crc32(raw);
    let data = await deflateRaw(raw), method = 8;
    if (!data || data.length >= raw.length) { data = raw; method = 0; }
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, method, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x2821, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true);
    lh.setUint16(26, nameU8.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nameU8, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x2821, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true);
    ch.setUint16(28, nameU8.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nameU8);
    off += 30 + nameU8.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true);
  eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true);
  eo.setUint32(12, cdSize, true); eo.setUint32(16, off, true);
  return new Blob(parts.concat(central, [new Uint8Array(eo.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const COLREF = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
function sheetXml(rows) {
  const body = rows.map((r, i) => '<row r="' + (i + 1) + '">' + r.map((c, j) => {
    const ref = COLREF(j) + (i + 1);
    if (typeof c === 'number' && isFinite(c)) return `<c r="${ref}"><v>${c}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xesc(c)}</t></is></c>`;
  }).join('') + '</row>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    body + '</sheetData></worksheet>';
}
async function makeXlsx(sheets) {
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map((s, i) => `<sheet name="${xesc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      '</Relationships>' }
  ];
  sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows) }));
  return makeZip(files);
}

/* ---- hojas del libro exportado ---- */
function exportSheets(rows, A) {
  const inv = [['Equipo', 'Usuario', 'Cliente', 'Área', 'Fabricante', 'Aplicación', 'Categoría',
    'Versión instalada', 'Versión aprobada', 'Versión mínima', 'Estado', 'Crítica', 'Administrada',
    'Sistema operativo', 'Versión SO', 'CPE', 'Fecha']];
  const best = new Map();
  for (const r of rows) { const id = r.device + ' ' + r.appKey; const p = best.get(id);
    if (!p || (!VER_UNK.test(r.ver) && verCmp(r.ver, p.ver) > 0)) best.set(id, r); }
  best.forEach(r => {
    const u = rule(r.appKey) || {};
    inv.push([r.device, r.user, r.cliente, r.area, pretty(r.vendor), pretty(r.app), u.cat || '',
      r.ver, u.rec || '', u.min || '', EST_LAB[evalVer(r.appKey, r.ver)], u.crit ? 'Sí' : 'No',
      u.gest ? 'Sí' : 'No', r.os, r.osver, r.cpeRaw,
      r.ts ? r.ts.toLocaleString('es-CO') : '']);
  });
  const apps = [['Aplicación', 'Fabricante', 'Categoría', 'Equipos', 'Versiones', 'Versión aprobada',
    'Versión mínima', 'Cumplen', 'Requieren atención', 'No cumplen', '% al día', 'Estado', 'Crítica', 'Administrada']];
  CMP.appList.forEach(o => { const u = rule(o.key) || {};
    apps.push([appLabel(o.key), pretty(vendorOfApp(o.key)), u.cat || '', o.total,
      (A.appVerDev.get(o.key) || new Map()).size, u.rec || '', u.min || '',
      o.ok, o.warn, o.bad, +o.pctOk.toFixed(1), EST_LAB[o.estado], u.crit ? 'Sí' : 'No', u.gest ? 'Sí' : 'No']); });
  const devs = [['Equipo', 'Usuario', 'Cliente', 'Área', 'Versión SO', 'Aplicaciones', 'Desactualizadas',
    'Cumplen', 'Requieren atención', 'No cumplen', 'No autorizadas', 'Estado', 'Última sincronización', 'Días sin reportar']];
  CMP.dev.forEach((d, dev) => {
    const f = rows.find(r => r.device === dev) || {};
    devs.push([dev, f.user || '', f.cliente || '', f.area || '', f.osver || '',
      d.ok + d.warn + d.bad + d.na, A.devLag.get(dev) || 0, d.ok, d.warn, d.bad + d.noAuth.length,
      d.noAuth.length, EST_LAB[d.estado], d.last ? d.last.toLocaleString('es-CO') : '', d.staleDias || 0]);
  });
  const res = [['Indicador', 'Valor'],
    ['Organización', CFG.org || ''], ['Archivo', M.fileName], ['Generado', new Date().toLocaleString('es-CO')],
    ['Registros analizados', A.n], ['Dispositivos', A.nDev], ['Aplicaciones', A.nApp], ['Fabricantes', A.nVendor],
    ['Equipos que cumplen', CMP.tot.ok], ['Equipos que requieren atención', CMP.tot.warn],
    ['Equipos que no cumplen', CMP.tot.bad], ['% de cumplimiento', +CMP.tot.pctOk.toFixed(2)],
    ['Actualizaciones pendientes', A.debtTotal], ['Equipos sin sincronizar', CMP.stale.size],
    ['Aplicaciones no autorizadas', CMP.noAuthApps.length],
    ['Aplicaciones críticas con incidencias', CMP.critApps.length]];
  return [{ name: 'Resumen', rows: res }, { name: 'Aplicaciones', rows: apps },
    { name: 'Equipos', rows: devs }, { name: 'Inventario', rows: inv }];
}

function toast(msg) {
  const t = $('#toast');
  t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${IC.check}</svg>${esc(msg)}`;
  t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2600);
}
const EMBEDDED = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();
async function getDownloads() {
  try { return (window.claude && typeof window.claude.use === 'function') ? await window.claude.use('downloads') : null; }
  catch (e) { return null; }
}
async function saveFile(name, data, mime) {
  const dl = await getDownloads();
  if (dl) {
    try { await dl.save({ filename: name, data }); toast('Guardado: ' + name); }
    catch (e) { toast(e && e.code === 'declined' ? 'Descarga cancelada' : 'No se pudo guardar el archivo'); }
    return;
  }
  if (EMBEDDED && typeof data === 'string') {
    try { await navigator.clipboard.writeText(data); toast('Copiado al portapapeles'); }
    catch (e) { toast('No se pudo copiar'); }
    return;
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast('Descargado: ' + name);
}
const baseName = () => (CFG.org ? norm(CFG.org).slice(0, 20) + '_' : '') +
  (M.fileName || 'inventario').replace(/\.[^.]+$/, '').slice(0, 40);

function csvOf(sheets) {
  const q = v => { const s = v == null ? '' : String(v); return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + sheets.map(sh => '### ' + sh.name + '\r\n' +
    sh.rows.map(r => r.map(q).join(';')).join('\r\n')).join('\r\n\r\n');
}

/* ============================================================================
   26. INTERACCION
   ========================================================================== */
const tip = $('#tip');
function showTip(html, x, y) {
  tip.innerHTML = html; tip.classList.add('on');
  const r = tip.getBoundingClientRect();
  let left = x + 16, top = y + 16;
  if (left + r.width > innerWidth - 10) left = x - r.width - 16;
  if (top + r.height > innerHeight - 10) top = y - r.height - 16;
  tip.style.left = Math.max(8, left) + 'px'; tip.style.top = Math.max(8, top) + 'px';
}
const hideTip = () => tip.classList.remove('on');
document.addEventListener('mousemove', e => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (!el) return hideTip();
  const i = +el.getAttribute('data-tip');
  TIPS[i] != null ? showTip(TIPS[i], e.clientX, e.clientY) : hideTip();
}, { passive: true });
document.addEventListener('scroll', hideTip, { passive: true, capture: true });

document.addEventListener('click', async e => {
  const t = e.target;
  const cl = s => t.closest && t.closest(s);
  let el;
  if ((el = cl('[data-go]'))) { hideTip(); go(el.getAttribute('data-go')); return; }
  if ((el = cl('[data-goapp]'))) { hideTip(); go('aplicaciones', { app: el.getAttribute('data-goapp') }); return; }
  if ((el = cl('[data-godev]'))) { hideTip(); go('equipos', { device: el.getAttribute('data-godev') }); return; }
  if ((el = cl('[data-scopein]'))) {
    const k = el.getAttribute('data-scopein');
    const r = CFG.apps[k] || (CFG.apps[k] = { estado: 'permitida', cat: guessCat(k) });
    r.gest = true; r.auto = false;
    if (!r.rec) { const sp = verSpread((M.effVer.get(k) || new Map()));
      Object.assign(r, seedThresholds(sp, (M.aggFull.appDev.get(k) || new Set()).size)); }
    cfgSave(); toast('Incluida en el estándar de cumplimiento'); render(); return;
  }
  if ((el = cl('[data-filterapp]'))) { toggleFilter('appKey', el.getAttribute('data-filterapp')); return; }
  if ((el = cl('[data-filterdev]'))) { toggleFilter('device', el.getAttribute('data-filterdev')); return; }
  if ((el = cl('[data-cat]'))) { toggleFilter('cat', el.getAttribute('data-cat')); return; }
  if ((el = cl('[data-dim][data-val]'))) { hideTip(); toggleFilter(el.getAttribute('data-dim'), el.getAttribute('data-val')); return; }
  if ((el = cl('[data-rm-dim]'))) { toggleFilter(el.getAttribute('data-rm-dim'), el.getAttribute('data-rm-val')); return; }
  if (cl('[data-rm-q]')) { S.q = ''; $('#qGlobal').value = ''; render(); return; }
  if (t.id === 'clearAll') { clearFilters(); return; }
  if ((el = cl('[data-tw]'))) {
    const id = el.getAttribute('data-tw'), on = el.getAttribute('aria-pressed') === 'true';
    el.setAttribute('aria-pressed', on ? 'false' : 'true');
    el.textContent = on ? 'Tabla' : 'Gráfico';
    $('#p-' + id).hidden = !on; $('#t-' + id).hidden = on; return;
  }
  if ((el = cl('th[data-sort]'))) {
    const [id, k] = el.getAttribute('data-sort').split('|');
    const st = sortOf(id);
    S.sort[id] = st.k === k ? { k, d: -st.d } : { k, d: typeof (VIEWS && 1) === 'number' ? -1 : -1 };
    render(); return;
  }
  if ((el = cl('[data-more]'))) { const id = el.getAttribute('data-more'); S.limit[id] = limitOf(id) + 60; render(); return; }
  if (t.id === 'mAdmin' || t.id === 'mCliente') {
    S.mode = t.id === 'mAdmin' ? 'admin' : 'cliente';
    if (S.mode === 'cliente' && !VIEWS[S.view].cli) { go('informe'); return; }
    render(); return;
  }
  if (t.id === 'histClear') {
    if (confirm('¿Borrar todas las lecturas históricas guardadas en este navegador?')) {
      HIST = []; histSave(); toast('Histórico borrado'); render();
    } return;
  }
  if ((el = cl('[data-kql]'))) {
    CFG.kql = CFG.kql || {}; CFG.kql.ver = el.getAttribute('data-kql'); cfgSave(); render(); return;
  }
  if ((el = cl('[data-rmsrc]'))) {
    const v = el.getAttribute('data-rmsrc');
    if (v === 'todas') {
      if (!confirm('¿Quitar todos los archivos y volver a la pantalla inicial?')) return;
      M.sources = []; mergeSources();
      $('#app').hidden = true; $('#topActions').hidden = true; $('#dropScreen').hidden = false;
      $('#fileInput').value = ''; return;
    }
    const fuera = removeSource(+v);
    if (!fuera) return;
    if (!M.sources.length) {
      $('#app').hidden = true; $('#topActions').hidden = true; $('#dropScreen').hidden = false;
      $('#fileInput').value = ''; toast('Sin archivos cargados'); return;
    }
    M.aggFull = aggregate(M.rows);
    M.effVer = effVersions(M.rows);
    S.f = {}; S.limit = {};
    toast('Quitado: ' + truncate(fuera.name, 28));
    render(); return;
  }
  if ((el = cl('[data-lote]'))) {
    CFG.kql = CFG.kql || {};
    const n = Math.max(1, +CFG.kql.lotes || 1);
    CFG.kql.lote = ((+CFG.kql.lote || 0) + (+el.getAttribute('data-lote')) + n) % n;
    delete CFG.kql[(CFG.kql.ver || 'catalogo')];   // el texto guardado ya no vale
    cfgSave(); render(); return;
  }
  if ((el = cl('[data-kqlact]'))) {
    const acc = el.getAttribute('data-kqlact'), box = $('#kqlBox');
    const cual = box ? box.getAttribute('data-kqlsave') : '';
    if (acc === 'diagnostico') {
      const c = kqlDiagnostico();
      try { await navigator.clipboard.writeText(c); toast('Diagnóstico copiado: pega los bloques uno a uno'); }
      catch (e) { box.value = c; toast('Diagnóstico puesto en el cuadro'); }
      return;
    }
    if (acc === 'contar') {
      const c = kqlContar(box.value);
      try { await navigator.clipboard.writeText(c); toast('Consulta de conteo copiada: pégala en Defender'); }
      catch (e) { box.value = c; toast('Consulta de conteo puesta en el cuadro'); }
      return;
    }
    if (acc === 'copiar') {
      try { await navigator.clipboard.writeText(box.value); toast('Consulta copiada al portapapeles'); }
      catch (e) { box.select(); toast('Pulsa Ctrl+C para copiarla'); }
    } else {
      if (CFG.kql) delete CFG.kql[cual];
      cfgSave(); toast('Consulta restaurada'); render();
    }
    return;
  }
  if ((el = cl('[data-gx]'))) { await gxAction(el.getAttribute('data-gx')); return; }
  if ((el = cl('[data-adm]'))) { await admAction(el.getAttribute('data-adm')); return; }
  if ((el = cl('[data-load]'))) {
    const modo = el.getAttribute('data-load');
    $$('.expmenu').forEach(m => m.remove());
    if (modo === 'add') { $('#fileInput').dataset.add = '1'; $('#fileInput').value = ''; $('#fileInput').click(); }
    else { $('#app').hidden = true; $('#topActions').hidden = true; $('#dropScreen').hidden = false;
           $('#fileInput').value = ''; $('#dropErr').classList.remove('on'); }
    return;
  }
  if (t.id === 'btnExport') { toggleExportMenu(t); return; }
  if ((el = cl('[data-exp]'))) { await doExport(el.getAttribute('data-exp')); return; }
  $$('.expmenu').forEach(m => m.remove());
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { $$('.expmenu').forEach(m => m.remove()); hideTip(); return; }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const a = document.activeElement;
  if (!a) return;
  if (a.hasAttribute && a.hasAttribute('data-go')) { e.preventDefault(); go(a.getAttribute('data-go')); return; }
  if (a.hasAttribute && a.hasAttribute('data-dim') && a.hasAttribute('data-val')) {
    e.preventDefault(); toggleFilter(a.getAttribute('data-dim'), a.getAttribute('data-val'));
  }
});

let qT;
$('#qGlobal').addEventListener('input', e => {
  clearTimeout(qT); qT = setTimeout(() => { S.q = e.target.value; S.limit = {}; render(); }, 240);
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.matches && el.matches('[data-q]')) {
    const id = el.getAttribute('data-q');
    clearTimeout(qT); qT = setTimeout(() => { S.qt[id] = el.value; S.limit[id] = 60; render(); }, 240);
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.matches && el.matches('[data-fdim]')) {
    const d = el.getAttribute('data-fdim'), v = el.value;
    if (!v) delete S.f[d]; else S.f[d] = new Set([v]);
    S.limit = {}; render(); return;
  }
  if (el.matches && el.matches('[data-cfg]')) {
    const path = el.getAttribute('data-cfg').split('.');
    const v = el.type === 'number' ? Math.max(1, +el.value || 1) : el.value.trim();
    let o = CFG;
    for (let i = 0; i < path.length - 1; i++) o = (o[path[i]] = o[path[i]] || {});
    o[path[path.length - 1]] = v;
    if (path[0] === 'kql') { CFG.kql.lote = 0; delete CFG.kql[CFG.kql.ver || 'catalogo']; }
    cfgSave(); toast('Parámetro guardado');
    if (path[0] === 'graph' || path[0] === 'kql') render();
    return;
  }
  if (el.matches && el.matches('[data-kqlsave]')) {
    CFG.kql = CFG.kql || {};
    CFG.kql[el.getAttribute('data-kqlsave')] = el.value;
    cfgSave(); toast('Consulta guardada'); return;
  }
  if (el.matches && el.matches('[data-rule]')) {
    const [k, field] = el.getAttribute('data-rule').split('|');
    const r = CFG.apps[k] || (CFG.apps[k] = { estado: 'permitida', cat: 'Otro' });
    r[field] = el.type === 'checkbox' ? el.checked : el.value.trim();
    r.auto = false;                       // editado a mano: deja de refrescarse solo
    cfgSave(); toast('Estándar actualizado · se aplica al cambiar de sección'); return;
  }
});
window.addEventListener('hashchange', () => { readHash(); render(); window.scrollTo({ top: 0 }); });

/* ---- menú de exportación ---- */
function toggleExportMenu(btn) {
  const ex = $('.expmenu'); if (ex) { ex.remove(); return; }
  const r = btn.getBoundingClientRect();
  const m = document.createElement('div');
  m.className = 'expmenu';
  m.style.cssText = `position:fixed;z-index:210;top:${r.bottom + 7}px;right:${Math.max(8, innerWidth - r.right)}px;
    background:#0E0E0E;border:1px solid var(--line);border-radius:11px;padding:5px;min-width:230px;
    box-shadow:0 14px 40px rgba(0,0,0,.7);display:flex;flex-direction:column;gap:2px`;
  m.innerHTML = [
    ['xlsx', 'Libro de Excel (.xlsx)', 'Resumen, aplicaciones, equipos e inventario'],
    ['csv', 'CSV con todas las hojas', 'Un solo archivo de texto'],
    ['raw', 'CSV del archivo original', 'Las filas tal como se cargaron'],
    ['cfg', 'Configuración (.json)', 'El estándar definido en Administración']
  ].map(([k, l, d]) => `<button data-exp="${k}" style="text-align:left;padding:9px 12px;border-radius:8px;font-size:12.5px">
      <b style="display:block;color:var(--ink)">${l}</b><span class="mini">${d}</span></button>`).join('');
  document.body.appendChild(m);
  $$('.expmenu button').forEach(b => { b.onmouseenter = () => b.style.background = 'var(--surface-2)'; b.onmouseleave = () => b.style.background = ''; });
}
async function doExport(kind) {
  $$('.expmenu').forEach(m => m.remove());
  const rows = filterRows(), A = aggregate(rows);
  computeCompliance(rows);
  if (kind === 'cfg') return saveFile(baseName() + '_estandar.json', JSON.stringify(CFG, null, 2), 'application/json');
  if (kind === 'raw') {
    const q = v => { const s = v instanceof Date ? v.toISOString() : (v == null ? '' : String(v));
      return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = M.headers.length ? M.headers : ['Equipo', 'Fabricante', 'Aplicación', 'Versión'];
    const out = ['﻿' + head.map(q).join(';')];
    for (const r of rows) out.push(M.headers.length ? head.map((_, i) => q(r._raw[i])).join(';')
      : [r.device, r.vendor, r.app, r.ver].map(q).join(';'));
    return saveFile(baseName() + '_seleccion.csv', out.join('\r\n'), 'text/csv;charset=utf-8;');
  }
  const sheets = exportSheets(rows, A);
  if (kind === 'csv') return saveFile(baseName() + '_informe.csv', csvOf(sheets), 'text/csv;charset=utf-8;');
  toast('Generando el libro de Excel…');
  const blob = await makeXlsx(sheets);
  return saveFile(baseName() + '_informe.xlsx', blob);
}

/* ---- acciones de la conexión con Defender ---- */
async function gxAction(a) {
  if (a === 'ps') {
    const lotes = Math.max(0, Math.min(64, +($('#psLotes') || {}).value || 0));
    const propia = !!($('#psPropia') || {}).checked;
    return saveFile('extraer-defender.ps1', scriptPowerShell(lotes, propia), 'text/plain;charset=utf-8');
  }
  if (a === 'entrar') return conectar();
  if (a === 'salir') return desconectar();
  if (a === 'traer') {
    const cuales = [];
    if ($('#gxParque').checked) cuales.push('parque');
    if ($('#gxCatalogo').checked) cuales.push('catalogo');
    if ($('#gxExcepciones').checked) cuales.push('excepciones');
    const lotes = Math.max(0, Math.min(64, +$('#gxLotes').value || 0));
    if (lotes) cuales.push('detalle');
    if (!cuales.length) { toast('Marca al menos una consulta'); return; }
    const btn = $('[data-gx="traer"]');
    btn.disabled = true; btn.textContent = 'Consultando…';
    $('#gxLog').innerHTML = '';
    try {
      const n = await traerDeDefender(cuales, lotes);
      $('#dropScreen').hidden = true; $('#app').hidden = false; $('#topActions').hidden = false;
      toast(fmt(n) + ' filas cargadas desde Defender');
      render();
    } catch (e) {
      $('#gxLog').innerHTML += '<span style="color:var(--crit-ink)">✖ ' + esc(e.message) + '</span>';
      toast('No se pudo consultar');
    } finally {
      const b = $('[data-gx="traer"]');
      if (b) { b.disabled = false; b.textContent = 'Ejecutar y cargar'; }
    }
    return;
  }
}

/* ---- acciones de administración ---- */
async function admAction(a) {
  const A = M.aggFull;
  if (a === 'reseed') { const r = seedCatalog(); toast(`Propuestas actualizadas: ${r.nuevas} nuevas, ${r.actualizadas} refrescadas`); render(); return; }
  if (a === 'approve-latest') {
    let n = 0;
    A.appDev.forEach((s, k) => { const rec = M.latestVer.get(k); if (!rec) return;
      const r = CFG.apps[k] || (CFG.apps[k] = { estado: 'permitida', cat: guessCat(k) });
      if (r.rec !== rec) { r.rec = rec; n++; } });
    cfgSave(); toast(`${n} versiones aprobadas actualizadas`); render(); return;
  }
  if (a === 'mark-managed') {
    let n = 0;
    A.appDev.forEach((s, k) => { const g = pct(s.size, A.nDev) >= CFG.params.coberturaGestionada;
      const r = CFG.apps[k] || (CFG.apps[k] = { estado: 'permitida', cat: guessCat(k) });
      if (g && !r.gest) { r.gest = true; n++; } });
    cfgSave(); toast(`${n} aplicaciones marcadas como administradas`); render(); return;
  }
  if (a === 'export') return doExport('cfg');
  if (a === 'import') { $('#cfgFile').click(); return; }
  if (a === 'reset') {
    if (!confirm('¿Borrar todas las reglas de cumplimiento? El histórico se conserva.')) return;
    CFG.apps = {}; cfgSave(); seedCatalog(); toast('Reglas restablecidas a la propuesta automática'); render();
  }
}
$('#cfgFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const o = JSON.parse(await f.text());
    if (!o || typeof o !== 'object' || !o.apps) throw new Error('El archivo no contiene una configuración válida.');
    CFG.org = o.org || CFG.org;
    CFG.params = Object.assign({}, CFG_DEF.params, o.params || {});
    CFG.apps = o.apps;
    cfgSave(); toast('Configuración importada'); render();
  } catch (err) { toast('No se pudo importar: ' + (err.message || err)); }
  e.target.value = '';
});

$('#btnPrint').addEventListener('click', () => {
  if (S.mode === 'cliente' && S.view !== 'informe') go('informe');
  setTimeout(() => window.print(), 120);
});
/* Cargar: anadir al conjunto actual o empezar de cero. */
$('#btnNew').addEventListener('click', () => {
  const ex = $('.expmenu'); if (ex) { ex.remove(); return; }
  const r = $('#btnNew').getBoundingClientRect();
  const m = document.createElement('div');
  m.className = 'expmenu';
  m.style.cssText = `position:fixed;z-index:210;top:${r.bottom + 7}px;right:${Math.max(8, innerWidth - r.right)}px;
    background:#0E0E0E;border:1px solid var(--line);border-radius:11px;padding:5px;min-width:250px;
    box-shadow:0 14px 40px rgba(0,0,0,.7);display:flex;flex-direction:column;gap:2px`;
  m.innerHTML = `
    <button data-load="add" style="text-align:left;padding:9px 12px;border-radius:8px;font-size:12.5px">
      <b style="display:block;color:var(--ink)">Añadir archivo</b>
      <span class="mini">Se funde con lo ya cargado (lotes, parque, catálogo)</span></button>
    <button data-load="new" style="text-align:left;padding:9px 12px;border-radius:8px;font-size:12.5px">
      <b style="display:block;color:var(--ink)">Empezar de cero</b>
      <span class="mini">Descarta lo cargado y abre la pantalla inicial</span></button>`;
  document.body.appendChild(m);
  $$('.expmenu button').forEach(b => { b.onmouseenter = () => b.style.background = 'var(--surface-2)';
    b.onmouseleave = () => b.style.background = ''; });
});

/* ============================================================================
   27. CARGA DE ARCHIVO
   ========================================================================== */
const dropCard = $('#dropCard'), dropErr = $('#dropErr');
function fail(msg) {
  dropErr.innerHTML = '<b>No se pudo leer el archivo.</b><br>' + esc(msg);
  dropErr.classList.add('on');
  $('#dropScreen').hidden = false; $('#app').hidden = true; $('#topActions').hidden = true;
}
/** `añadir` funde el archivo con lo ya cargado; si no, empieza de cero. */
async function loadFile(file, añadir) {
  if (!file) return;
  dropErr.classList.remove('on'); dropCard.classList.remove('hot');
  const name = file.name || 'archivo';
  try {
    const buf = await file.arrayBuffer();
    let grid, sheet = '';
    const u8 = new Uint8Array(buf.slice(0, 4));
    if (u8[0] === 0x50 && u8[1] === 0x4B) { const r = await readXlsx(buf); grid = r.rows; sheet = r.sheet; }
    else if (u8[0] === 0xD0 && u8[1] === 0xCF) throw new Error('Es un Excel antiguo (.xls). Ábrelo en Excel y guárdalo como .xlsx o .csv.');
    else grid = parseCsv(decodeText(buf));
    const src = addSource(grid, name, sheet, !añadir);
    M.aggFull = aggregate(M.rows);
    M.effVer = effVersions(M.rows);
    seedCatalog();
    histSnapshot();
    if (!añadir) { S.f = {}; S.q = ''; S.qt = {}; S.limit = {}; S.sort = {}; }
    if (añadir) toast(`Añadido: ${truncate(name, 24)} · ${fmt(src.filas)} filas (${src.shape})`);
    $('#qGlobal').value = '';
    $('#dropScreen').hidden = true; $('#app').hidden = false; $('#topActions').hidden = false;
    document.title = (CFG.org ? CFG.org + ' · ' : '') + 'Inventario de Aplicaciones';
    readHash();
    render();
    window.scrollTo({ top: 0 });
  } catch (err) { console.error(err); fail(err && err.message ? err.message : String(err)); }
}
$('#btnPick').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async e => {
  const add = $('#fileInput').dataset.add === '1';
  $('#fileInput').dataset.add = '';
  const fs = Array.from(e.target.files);
  const yaHabia = !$('#app').hidden;
  // secuencial: loadFile es asincrona y en paralelo se pisarian entre si
  for (let i = 0; i < fs.length; i++) await loadFile(fs[i], add || yaHabia || i > 0);
  e.target.value = '';
});
dropCard.addEventListener('click', e => { if (e.target === dropCard) $('#fileInput').click(); });
['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => {
  e.preventDefault(); if ($('#dropScreen').hidden) return; dropCard.classList.add('hot');
}));
['dragleave', 'drop'].forEach(ev => window.addEventListener(ev, e => {
  e.preventDefault();
  if (ev === 'dragleave' && e.relatedTarget) return;
  dropCard.classList.remove('hot');
}));
window.addEventListener('drop', async e => {
  e.preventDefault();
  const fs = e.dataTransfer && e.dataTransfer.files;
  if (!fs || !fs.length) return;
  const primeraCarga = !$('#dropScreen').hidden;
  for (let i = 0; i < fs.length; i++) await loadFile(fs[i], !(primeraCarga && i === 0));
});

/* ---- abrir la aplicación sin datos, para poder conectar ---- */
function abrirVacio(vista) {
  M.aggFull = M.aggFull || aggregate(M.rows);
  M.effVer = M.effVer || new Map();
  $('#dropScreen').hidden = true; $('#app').hidden = false; $('#topActions').hidden = false;
  go(vista || 'datos');
}
$('#btnConectar').addEventListener('click', () => abrirVacio('datos'));

/* arranque */
cfgLoad(); histLoad();
M.aggFull = aggregate(M.rows);
(async () => {
  const err = await completarLogin();
  readHash();
  if (err) { fail(err); return; }
  if (conectado()) { abrirVacio(S.view === 'resumen' ? 'datos' : S.view); toast('Conectado a Defender'); }
})();
</script>
</body>
</html>
