
/* ============================================================================
   5. ESTADO · RUTAS · FILTRADO CRUZADO
   ========================================================================== */
const DIMS = {
  device: 'Equipo', vendor: 'Fabricante', appKey: 'Aplicación', ver: 'Versión',
  osver: 'Versión SO', cpeK: 'Trazabilidad CPE', geo: 'Ubicación', day: 'Fecha',
  bucket: 'Apps/equipo', cliente: 'Cliente', area: 'Área', cumpl: 'Cumplimiento',
  cat: 'Categoría', gestK: 'Administración'
};
const S = {
  f: {}, q: '', view: 'resumen', mode: 'admin',
  sel: { app: null, device: null },
  sort: {}, limit: {}, qt: {}
};

/* Dimensiones derivadas: no existen en la fila, se calculan al vuelo. */
function val(r, dim) {
  switch (dim) {
    case 'cpeK':  return r.cpe ? 'Con CPE' : 'Sin CPE';
    case 'cumpl': return CMP.rowState.get(r) || 'Sin estándar';
    case 'cat':   return (rule(r.appKey) || {}).cat || 'Otro';
    case 'gestK': return (rule(r.appKey) || {}).gest ? 'Administrada' : 'No administrada';
    default:      return r[dim];
  }
}

function toggleFilter(dim, value) {
  if (value == null || value === '') return;
  let s = S.f[dim];
  if (!s) S.f[dim] = s = new Set();
  s.has(value) ? s.delete(value) : s.add(value);
  if (!s.size) delete S.f[dim];
  S.limit = {};
  render();
}
function clearFilters() { S.f = {}; S.q = ''; const q = $('#qGlobal'); if (q) q.value = ''; S.limit = {}; render(); }
const activeDims = () => Object.keys(S.f);

function filterRows(exceptDim) {
  const dims = activeDims().filter(d => d !== exceptDim);
  const q = S.q.trim().toLowerCase();
  if (!dims.length && !q) return M.rows;
  return M.rows.filter(r => {
    for (const d of dims) if (!S.f[d].has(val(r, d))) return false;
    if (q && !(r.device.toLowerCase().includes(q) || r.appKey.toLowerCase().includes(q) ||
               r.ver.toLowerCase().includes(q) || (r.geo && r.geo.toLowerCase().includes(q)) ||
               (r.user && r.user.toLowerCase().includes(q)) ||
               (r.cliente && r.cliente.toLowerCase().includes(q)))) return false;
    return true;
  });
}

/* ---- rutas: el hash permite volver atrás desde un detalle ---- */
const VIEW_IDS = ['resumen','cumplimiento','aplicaciones','equipos','versiones','tendencias','mapas','datos','informe','admin'];
function go(view, sel) {
  S.view = view;
  S.sel = { app: null, device: null };
  if (sel) Object.assign(S.sel, sel);
  S.limit = {};
  const h = sel && sel.app ? 'app=' + encodeURIComponent(sel.app)
          : sel && sel.device ? 'equipo=' + encodeURIComponent(sel.device) : view;
  if (location.hash.slice(1) !== h) location.hash = h;
  else render();
  window.scrollTo({ top: 0 });
}
function readHash() {
  const h = decodeURIComponent(location.hash.slice(1) || '');
  if (h.startsWith('app=')) { S.view = 'aplicaciones'; S.sel = { app: h.slice(4), device: null }; return; }
  if (h.startsWith('equipo=')) { S.view = 'equipos'; S.sel = { app: null, device: h.slice(7) }; return; }
  S.view = VIEW_IDS.includes(h) ? h : 'resumen';
  S.sel = { app: null, device: null };
}

/* estado por tabla, para que cada tabla recuerde su orden y su paginación */
const sortOf = (id, def) => S.sort[id] || (S.sort[id] = Object.assign({ k: '', d: -1 }, def));
const limitOf = id => S.limit[id] || (S.limit[id] = 60);

/* ============================================================================
   9. CATALOGO DE ESTANDARES  ·  persistente en el navegador
   ========================================================================== */
const CFG_KEY = 'invapp.cfg.v1', HIST_KEY = 'invapp.hist.v1';
const CFG_DEF = {
  v: 1,
  org: '',
  params: { syncDias: 7, umbralOk: 95, umbralWarn: 85, coberturaGestionada: 90, thinPct: 30,
            alcance: 'gestionadas' },
  apps: {}, graph: {}, kql: {}
};
let CFG = JSON.parse(JSON.stringify(CFG_DEF));

function cfgLoad() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      CFG = Object.assign(JSON.parse(JSON.stringify(CFG_DEF)), o);
      CFG.params = Object.assign({}, CFG_DEF.params, o.params || {});
      CFG.apps = o.apps || {};
      CFG.graph = o.graph || {};
      CFG.kql = o.kql || {};
    }
  } catch (e) { /* almacenamiento bloqueado: se sigue en memoria */ }
}
function cfgSave() {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); return true; }
  catch (e) { return false; }
}
const rule = k => CFG.apps[k];

/* ---- categorias por palabras clave: propuesta inicial editable ---- */
const CATS = ['Seguridad','Navegador','Ofimática','Comunicación','Desarrollo','Runtime y librerías',
              'Controladores','Gestión y agentes','Utilidades','Otro'];
const CAT_RULES = [
  ['Seguridad', /defender|cortex|xdr|nessus|netskope|antivirus|endpoint_protection|security|firewall|encrypt|bitlocker|mcafee|symantec|crowdstrike|sentinel|trellix|forcepoint|sophos|kaspersky|tenable|rapid7|qualys|securid|purview|information_protection|laps|administrator_password/],
  ['Navegador', /chrome|edge|firefox|browser|opera|brave|safari/],
  ['Comunicación', /webex|zoom|teams|skype|slack|meet|lync|jabber/],
  ['Ofimática', /office|word|excel|power_?point|outlook|onedrive|sharepoint|visio|project|acrobat|reader|pdf|onenote|microsoft_365|libreoffice/],
  ['Desarrollo', /visual_studio|vscode|visual_studio_code|\bgit\b|git-scm|python|node|npm|jetbrains|intellij|pycharm|webstorm|postman|docker|sql_server|ssms|eclipse|android_studio|powershell|azure_cli|terraform|insomnia/],
  ['Runtime y librerías', /runtime|redistributable|visual_c|\.net|dotnet|framework|\bjava\b|\bjre\b|\bjdk\b|corretto|openssl|edge_?webview|webview2|silverlight/],
  ['Controladores', /driver|print|lexmark|realtek|nvidia|chipset|audio|graphics|bluetooth|wlan|touchpad|firmware|command_\|_|dell_command|hp_/],
  ['Gestión y agentes', /agent|_client|management_extension|intune|sccm|configuration_manager|nexthink|collector|remote_help|bigfix|lansweeper|company_portal|workspace|citrix/],
  ['Utilidades', /7-?zip|winrar|winzip|notepad|putty|filezilla|\bvlc\b|teamviewer|anydesk|greenshot|paint|snagit|everything/]
];
function guessCat(key) {
  const k = norm(key).replace(/([a-z])([0-9])/g, '$1 $2') + ' ' + key.toLowerCase();
  for (const [cat, re] of CAT_RULES) if (re.test(key.toLowerCase()) || re.test(k)) return cat;
  return 'Otro';
}

/**
 * Version efectiva de cada equipo para cada aplicacion: la mas alta que tiene
 * instalada. Es la que decide su estado, no cada entrada suelta del inventario.
 */
function effVersions(rows) {
  const out = new Map();                       // appKey -> Map(device -> version)
  for (const r of rows) {
    let m = out.get(r.appKey); if (!m) out.set(r.appKey, m = new Map());
    const p = m.get(r.device);
    if (p === undefined || (!VER_UNK.test(r.ver) && verCmp(r.ver, p) > 0)) m.set(r.device, r.ver);
  }
  return out;
}
/** Reparto de equipos por version efectiva, de la mas nueva a la mas antigua. */
function verSpread(devVer) {
  const c = new Map();
  devVer.forEach(v => { if (!VER_UNK.test(v)) c.set(v, (c.get(v) || 0) + 1); });
  return Array.from(c.entries()).sort((a, b) => verCmp(b[0], a[0]));
}
/**
 * Umbrales por defecto. Aprobar siempre la version mas alta detectada dejaria
 * el parque entero en rojo el primer dia: en un inventario real casi ningun
 * equipo esta al maximo en TODAS sus aplicaciones. La propuesta es percentil:
 *   - aprobada = la version mas nueva que ya cubre al menos la mitad del parque
 *   - minima   = la que cubre el 90 %, es decir el suelo del rezago habitual
 * El administrador puede endurecerlo con un clic desde Administracion.
 */
function seedThresholds(spread, total) {
  if (!spread.length) return { rec: '', min: '' };
  let acc = 0, rec = '', min = spread[spread.length - 1][0];
  for (const [v, n] of spread) {
    acc += n;
    if (!rec && acc >= total * 0.5) rec = v;
    if (acc >= total * 0.9) { min = v; break; }
  }
  if (!rec) rec = spread[spread.length - 1][0];
  if (verCmp(min, rec) > 0) min = rec;
  return { rec, min };
}

/**
 * Propone una regla por aplicación a partir de los datos.
 * Solo toca reglas marcadas `auto`: lo que el administrador edita nunca se pisa.
 */
function seedCatalog() {
  const A = M.aggFull;
  const eff = M.effVer || (M.effVer = effVersions(M.rows));
  let nuevas = 0, actualizadas = 0;
  A.appDev.forEach((devs, k) => {
    const spread = verSpread(eff.get(k) || new Map());
    const { rec, min } = seedThresholds(spread, devs.size);
    const cat = guessCat(k);
    const gest = pct(devs.size, A.nDev) >= CFG.params.coberturaGestionada;
    const prev = CFG.apps[k];
    if (!prev) {
      CFG.apps[k] = { min, rec, crit: cat === 'Seguridad', estado: 'permitida', cat, gest, auto: true };
      nuevas++;
    } else if (prev.auto) {
      if (prev.rec !== rec || prev.min !== min) actualizadas++;
      Object.assign(prev, { min, rec, cat: prev.cat || cat, gest });
    }
  });
  if (nuevas || actualizadas) cfgSave();
  return { nuevas, actualizadas, auto: Object.values(CFG.apps).filter(r => r.auto).length };
}

/* ============================================================================
   10. MOTOR DE CUMPLIMIENTO
   ========================================================================== */
const CMP = { rowState: new Map(), dev: new Map(), app: new Map(), tot: null, stale: new Set() };
const EST_LAB = { ok: 'Cumple', warn: 'Requiere atención', bad: 'No cumple', na: 'No puntúa' };
/** Por que una aplicacion no puntua: sin regla, o con regla pero fuera del alcance. */
function scopeNote(k) {
  if (!rule(k)) return 'sin-regla';
  return inScope(k) ? null : 'fuera';
}
const SCOPE_LAB = { 'sin-regla': 'Sin estándar definido', 'fuera': 'Fuera del alcance' };
const EST_CLS = { ok: 'ok', warn: 'warn', bad: 'bad', na: 'off' };

/**
 * Alcance del cumplimiento. Un equipo corporativo lleva decenas de librerias,
 * controladores y componentes; exigir que TODOS esten en la ultima version
 * convierte el indicador en ruido. Por defecto solo puntuan las aplicaciones
 * que el administrador gobierna: las administradas, las criticas y las
 * expresamente no permitidas. Puede ampliarse a todo el catalogo.
 */
function inScope(k) {
  const r = rule(k);
  if (!r) return false;
  if (r.estado === 'no-permitida') return true;
  if (CFG.params.alcance === 'todas') return true;
  return !!(r.gest || r.crit);
}
/** Estado de una version concreta frente a su regla. */
function evalVer(k, ver) {
  const r = rule(k);
  if (!r) return 'na';
  if (r.estado === 'no-permitida') return 'bad';         // software no autorizado
  if (!inScope(k)) return 'na';                          // fuera del alcance del estandar
  if (VER_UNK.test(ver) || !r.rec) return 'na';
  if (verCmp(ver, r.rec) >= 0) return 'ok';
  if (r.min && verCmp(ver, r.min) >= 0) return 'warn';
  return 'bad';
}
const worse = (a, b) => {
  const o = { bad: 3, warn: 2, ok: 1, na: 0 };
  return o[b] > o[a] ? b : a;
};

/**
 * Evalua todo el conjunto filtrado. El estado de un equipo frente a una app usa
 * la version MAS ALTA que ese equipo tiene instalada de esa app.
 */
function computeCompliance(rows) {
  CMP.rowState = new Map(); CMP.dev = new Map(); CMP.app = new Map(); CMP.stale = new Set();
  const best = new Map();                        // device|app -> version mas alta
  for (const r of rows) {
    if (!r.device) continue;                     // fila agregada: no hay equipo al que atribuirla
    const id = r.device + ' ' + r.appKey;
    const p = best.get(id);
    if (!p || (!VER_UNK.test(r.ver) && verCmp(r.ver, p) > 0)) best.set(id, r.ver);
  }
  // filas agregadas: no hay equipo al que atribuir, se pesan por recuento
  const aggApp = new Map();
  for (const r of rows) {
    if (r.device) continue;
    let a = aggApp.get(r.appKey);
    if (!a) aggApp.set(r.appKey, a = { ok: 0, warn: 0, bad: 0, na: 0 });
    a[evalVer(r.appKey, r.ver)] += (r.w || 1);
  }
  const pairApp = new Map();                     // appKey -> Map(device -> estado)
  best.forEach((ver, id) => {
    const i = id.indexOf(' ');
    const dev = id.slice(0, i), k = id.slice(i + 1);
    const st = evalVer(k, ver);
    let dm = CMP.dev.get(dev);
    if (!dm) CMP.dev.set(dev, dm = { ok: 0, warn: 0, bad: 0, na: 0, noAuth: [], bad_: [], warn_: [], last: null });
    dm[st]++;
    if (st === 'bad') { const r = rule(k); (r && r.estado === 'no-permitida' ? dm.noAuth : dm.bad_).push(k); }
    else if (st === 'warn') dm.warn_.push(k);
    let am = pairApp.get(k); if (!am) pairApp.set(k, am = new Map());
    am.set(dev, st);
  });
  // estado por fila, para poder filtrar por cumplimiento
  for (const r of rows) {
    const am = pairApp.get(r.appKey);
    CMP.rowState.set(r, r.device
      ? EST_LAB[(am && am.get(r.device)) || 'na']
      : EST_LAB[evalVer(r.appKey, r.ver)]);
    if (r.ts) { const d = CMP.dev.get(r.device); if (d && (!d.last || r.ts > d.last)) d.last = r.ts; }
  }
  // resumen por aplicacion: detalle y agregado suman en la misma ficha
  const claves = new Set(Array.from(pairApp.keys()).concat(Array.from(aggApp.keys())));
  claves.forEach(k => {
    const am = pairApp.get(k), ag = aggApp.get(k);
    const o = { ok: 0, warn: 0, bad: 0, na: 0, total: 0, key: k };
    if (am) am.forEach(st => o[st]++);
    if (ag) { o.ok += ag.ok; o.warn += ag.warn; o.bad += ag.bad; o.na += ag.na; }
    o.total = o.ok + o.warn + o.bad + o.na;
    o.estado = o.bad ? 'bad' : o.warn ? 'warn' : o.ok ? 'ok' : 'na';
    o.pctOk = pct(o.ok, o.total);
    const r = rule(k) || {};
    o.riesgo = (o.bad * 3 + o.warn) * (r.crit ? 2.5 : 1) * (r.estado === 'no-permitida' ? 2 : 1);
    CMP.app.set(k, o);
  });
  // estado por equipo + falta de sincronizacion
  const maxTs = M.maxDate;
  const tot = { ok: 0, warn: 0, bad: 0, na: 0 };
  CMP.dev.forEach((d, dev) => {
    d.estado = d.bad || d.noAuth.length ? 'bad' : d.warn ? 'warn' : 'ok';
    if (maxTs && d.last && (maxTs - d.last) > CFG.params.syncDias * DAY_MS) {
      CMP.stale.add(dev);
      if (d.estado === 'ok') d.estado = 'warn';
      d.staleDias = Math.round((maxTs - d.last) / DAY_MS);
    }
    tot[d.estado]++;
  });
  tot.n = CMP.dev.size;
  tot.base = 'equipos';
  // Sin detalle por equipo no se puede decir "este equipo cumple": se mide sobre
  // instalaciones, que es lo que el archivo agregado si permite afirmar.
  // Con cualquier fuente agregada, el titular sale de las instalaciones: el
  // detalle por equipo solo cubre las aplicaciones que se exportaron enteras,
  // y mezclar ambas bases daria dos porcentajes distintos del mismo parque.
  if ((!CMP.dev.size || (typeof M !== 'undefined' && M.hasAgregado)) && CMP.app.size) {
    let ok = 0, warn = 0, bad = 0;
    CMP.app.forEach((o, k) => { if (!inScope(k)) return; ok += o.ok; warn += o.warn; bad += o.bad; });
    tot.ok = ok; tot.warn = warn; tot.bad = bad;
    tot.n = ok + warn + bad;
    tot.base = 'instalaciones';
  }
  tot.pctOk = pct(tot.ok, tot.n);
  CMP.scope = new Set();
  CMP.app.forEach((o, k) => { if (inScope(k)) CMP.scope.add(k); });
  tot.scope = CMP.scope.size;
  CMP.tot = tot;
  CMP.appList = Array.from(CMP.app.values()).sort((a, b) => b.riesgo - a.riesgo || b.bad - a.bad);
  CMP.noAuthApps = CMP.appList.filter(o => (rule(o.key) || {}).estado === 'no-permitida');
  CMP.critApps = CMP.appList.filter(o => (rule(o.key) || {}).crit && o.estado !== 'ok');
  return CMP;
}

/* ============================================================================
   11. HISTORICO  ·  una instantánea por carga, para medir la evolución
   ========================================================================== */
let HIST = [];
function histLoad() {
  try { HIST = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); }
  catch (e) { HIST = []; }
  if (!Array.isArray(HIST)) HIST = [];
}
function histSave() {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(HIST.slice(-24))); return true; }
  catch (e) { return false; }
}
/** Guarda el estado del archivo recién cargado. Una entrada por día y organización. */
function histSnapshot() {
  const A = M.aggFull;
  const cmp = computeCompliance(M.rows);
  const fecha = dayKey(M.maxDate || new Date());
  const apps = {};
  A.topApps.slice(0, 150).forEach(([k]) => {
    const o = CMP.app.get(k);
    if (o) apps[k] = [o.total, o.ok, o.warn, o.bad];
  });
  const snap = {
    fecha, ts: Date.now(), archivo: M.fileName, org: CFG.org || '',
    k: {
      dev: A.nDev, apps: A.nApp, vendors: A.nVendor, filas: A.n,
      ok: cmp.tot.ok, warn: cmp.tot.warn, bad: cmp.tot.bad,
      pctOk: +cmp.tot.pctOk.toFixed(2), deuda: A.debtTotal, pares: A.pairs,
      stale: cmp.stale.size, noAuth: cmp.noAuthApps.length,
      gest: Object.values(CFG.apps).filter(r => r.gest).length
    },
    apps
  };
  const i = HIST.findIndex(h => h.fecha === fecha && (h.org || '') === (CFG.org || ''));
  if (i >= 0) HIST[i] = snap; else HIST.push(snap);
  HIST.sort((a, b) => a.fecha < b.fecha ? -1 : 1);
  if (HIST.length > 24) HIST = HIST.slice(-24);
  histSave();
  return snap;
}
/** Instantánea anterior comparable (día distinto, misma organización). */
function histPrev() {
  const fecha = dayKey(M.maxDate || new Date());
  const org = CFG.org || '';
  const prev = HIST.filter(h => (h.org || '') === org && h.fecha < fecha);
  return prev.length ? prev[prev.length - 1] : null;
}

/* ============================================================================
   12. ALERTAS
   ========================================================================== */
function buildAlerts(A) {
  const out = [], p = histPrev();
  const add = (lv, ic, t, d, act) => out.push({ lv, ic, t, d, act });

  CMP.critApps.slice(0, 3).forEach(o => {
    add('crit', 'alert', 'Aplicación crítica desactualizada',
      `<b>${esc(pretty(nameOfApp(o.key)))}</b> está marcada como crítica y <b>${fmt(o.bad + o.warn)}</b> de ` +
      `${fmt(o.total)} equipos no tienen la versión aprobada.`, ['app', o.key]);
  });
  if (CMP.noAuthApps.length) {
    const eq = new Set();
    CMP.dev.forEach((d, dev) => { if (d.noAuth.length) eq.add(dev); });
    add('crit', 'ban', 'Software no autorizado detectado',
      `<b>${fmt(CMP.noAuthApps.length)}</b> aplicaciones marcadas como no permitidas aparecen en ` +
      `<b>${fmt(eq.size)}</b> equipos.`, ['view', 'cumplimiento']);
  }
  if (CMP.stale.size) {
    add(pct(CMP.stale.size, CMP.tot.n) > 15 ? 'crit' : 'warn', 'clock', 'Equipos sin sincronización reciente',
      `<b>${fmt(CMP.stale.size)}</b> equipos llevan más de <b>${CFG.params.syncDias}</b> días sin reportar. ` +
      `Su inventario ya no refleja el estado real.`, ['view', 'equipos']);
  }
  if (p) {
    const dBad = CMP.tot.bad - p.k.bad;
    if (dBad > 0) add('serious', 'trend', 'Aumento de equipos fuera de cumplimiento',
      `Hay <b>${fmt(dBad)}</b> equipos más en rojo que el <b>${p.fecha}</b> (${fmt(p.k.bad)} → ${fmt(CMP.tot.bad)}).`,
      ['view', 'tendencias']);
    const dOk = CMP.tot.pctOk - p.k.pctOk;
    if (dOk >= 2) add('ok', 'check', 'El cumplimiento está mejorando',
      `El porcentaje de equipos que cumplen sube <b>${fmt1(dOk)} puntos</b> desde el <b>${p.fecha}</b>.`,
      ['view', 'tendencias']);
    const nuevas = A.topApps.filter(([k]) => !p.apps[k]).length;
    if (nuevas > 0 && Object.keys(p.apps).length)
      add('info', 'plus', 'Aplicaciones nuevas en el parque',
        `<b>${fmt(nuevas)}</b> aplicaciones no aparecían en la lectura del <b>${p.fecha}</b>.`, ['view', 'aplicaciones']);
  }
  const sinReglaN = A.topApps.filter(([k]) => !rule(k)).length;
  if (sinReglaN) add('warn', 'cog', 'Aplicaciones sin estándar definido',
    `<b>${fmt(sinReglaN)}</b> aplicaciones no tienen versión aprobada y quedan fuera del cálculo de cumplimiento.`,
    ['view', 'admin']);
  const thin = Array.from(A.devApps.entries()).filter(([, s]) => s.size < A.avgApps * 0.3).length;
  if (thin) add('warn', 'pc', 'Inventarios incompletos',
    `<b>${fmt(thin)}</b> equipos declaran menos de un tercio de la media de aplicaciones. ` +
    `Suele ser el agente truncando la lectura.`, ['view', 'equipos']);
  if (!out.length) add('ok', 'check', 'Sin alertas activas',
    'Ninguna regla de alerta se ha disparado sobre la selección actual.');
  return out;
}

/* ============================================================================
   13. AYUDAS DE PRESENTACION
   ========================================================================== */
const nameOfApp = k => (M.aggFull.appMeta.get(k) || {}).app || k;
const vendorOfApp = k => (M.aggFull.appMeta.get(k) || {}).vendor || '';
const appLabel = k => pretty(nameOfApp(k));

function semaforo(st, txt) {
  return `<span class="sem sem-pill ${EST_CLS[st] || 'off'}">${esc(txt || EST_LAB[st] || st)}</span>`;
}
function cbar(o, small) {
  const t = (o.ok + o.warn + o.bad) || 1;
  const seg = (c, v) => v > 0 ? `<i class="${c}" style="width:${(100 * v / t).toFixed(2)}%"></i>` : '';
  return `<div class="cbar${small ? ' sm' : ''}" role="img" aria-label="${o.ok} cumplen, ${o.warn} requieren atención, ${o.bad} no cumplen">` +
    seg('ok', o.ok) + seg('warn', o.warn) + seg('bad', o.bad) + `</div>`;
}
/** Variación frente al periodo anterior. `good` indica si subir es bueno. */
function delta(now, before, good, unit) {
  if (before == null || !isFinite(before)) return '<span class="delta flat">—</span>';
  const d = now - before;
  const cls = Math.abs(d) < 0.05 ? 'flat' : (d > 0) === !!good ? 'up' : 'down';
  const ar = d > 0.05 ? 'M6 2l4 5H2z' : d < -0.05 ? 'M6 10L2 5h8z' : 'M2 5h8';
  return `<span class="delta ${cls}"><svg viewBox="0 0 12 12" fill="currentColor"><path d="${ar}"/></svg>` +
    `${d > 0 ? '+' : ''}${fmt1(d)}${unit || ''}</span>`;
}
