
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
    // el estado va por indice de fila, no por objeto: cada recorrido crea
    // objetos nuevos y una clave por objeto no volveria a encontrarse nunca
    case 'cumpl': return EST_ORD[CMP.rowState[r._i]] || 'Sin estándar';
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

/* Dos contadores para saber si hace falta recalcular. Van sueltos y no dentro
   de M ni de CFG, que se serializan: un contador no tiene por que persistir. */
let MODELO_V = 0, REGLAS_V = 0;

/**
 * Que valores de una dimension pasan el filtro, decidido UNA vez por valor.
 *
 * Devuelve `{paso, a}`: `a` es la columna de enteros de la fila y `paso` dice,
 * para cada entero, si pasa. Filtrar una fila queda en `paso[a[i]]`. Casi todas
 * las dimensiones salen de una columna -«cat» y «gestK» de appKey, «cpeK» de
 * cpeRaw, «cumpl» del estado que ya esta calculado por fila-, y las que no,
 * devuelven null para que se recorra a la antigua.
 */
function pruebaDim(T, dim) {
  const permitidos = S.f[dim];
  const porColumna = (campo, etiqueta) => {
    const c = T.crudo(campo);
    const paso = new Uint8Array(Math.max(1, c.vals.length));
    for (let k = 0; k < paso.length; k++) paso[k] = permitidos.has(etiqueta(c.vals[k] || '')) ? 1 : 0;
    return { paso, a: c.a };                     // `a` nulo: la columna no existe
  };
  switch (dim) {
    case 'cpeK':  return porColumna('cpeRaw', s => ES_CPE(s) ? 'Con CPE' : 'Sin CPE');
    case 'cat':   return porColumna('appKey', k => (rule(k) || {}).cat || 'Otro');
    case 'gestK': return porColumna('appKey', k => (rule(k) || {}).gest ? 'Administrada' : 'No administrada');
    case 'cumpl': {
      const paso = new Uint8Array(EST_ORD.length);
      for (let k = 0; k < paso.length; k++) paso[k] = permitidos.has(EST_ORD[k] || 'Sin estándar') ? 1 : 0;
      const est = CMP.rowState.length >= T.length ? CMP.rowState : new Uint8Array(T.length);
      return { paso, a: est };
    }
    case 'day': {
      // El dia se guarda como numero; se etiqueta solo los que existen de
      // verdad, que son unos pocos, y no los veinte mil del calendario.
      const dias = T.dias, n = T.length;
      let ultimo = 0;
      for (let i = 0; i < n; i++) if (dias[i] > ultimo) ultimo = dias[i];
      const paso = new Uint8Array(ultimo + 1);
      const vistos = new Set();
      for (let i = 0; i < n; i++) { const dd = dias[i]; if (dd >= 0) vistos.add(dd); }
      vistos.forEach(dd => { if (permitidos.has(dayKey(new Date(dd * DAY_MS)))) paso[dd] = 1; });
      return { paso, a: dias };
    }
    default:
      if (!CAMPOS_TXT.includes(dim)) return null;   // dimension que no es columna
      return porColumna(dim, s => s || DEFECTO[dim] || '');
  }
}

/** Lo mismo para la busqueda de texto: se mira una vez por valor distinto en
 *  cada campo buscable, y luego la fila solo consulta. */
function pruebaTexto(T, q) {
  const salida = [];
  for (const campo of ['device', 'appKey', 'ver', 'geo', 'user', 'cliente']) {
    const c = T.crudo(campo);
    if (!c.a) continue;
    const paso = new Uint8Array(c.vals.length);
    for (let k = 0; k < paso.length; k++) {
      const s = c.vals[k] || DEFECTO[campo] || '';
      paso[k] = s && s.toLowerCase().includes(q) ? 1 : 0;
    }
    salida.push({ paso, a: c.a });
  }
  return salida;
}

function filterRows(exceptDim) {
  const dims = activeDims().filter(d => d !== exceptDim);
  const q = S.q.trim().toLowerCase();
  if (!dims.length && !q) return M.rows;

  const T = M.tabla;
  const vacio = () => Filas(T, new Int32Array(0));
  const pruebas = [];
  const lentas = [];
  for (const d of dims) {
    const p = pruebaDim(T, d);
    if (!p) { lentas.push(d); continue; }
    // Sin columna, todas las filas valen lo mismo: o pasan todas o ninguna.
    if (!p.a) { if (!p.paso[0]) return vacio(); continue; }
    pruebas.push(p);
  }
  const textos = q ? pruebaTexto(T, q) : null;
  if (textos && !textos.length) return vacio();

  const idx = M.rows.idx, n = M.rows.length;
  const nd = pruebas.length, nt = textos ? textos.length : 0;
  const out = new Int32Array(n);
  let m = 0;
  fila:
  for (let k = 0; k < n; k++) {
    const i = idx ? idx[k] : k;
    for (let j = 0; j < nd; j++) { const p = pruebas[j]; if (!p.paso[p.a[i]]) continue fila; }
    if (nt) {
      let hay = false;
      for (let j = 0; j < nt; j++) { const p = textos[j]; if (p.paso[p.a[i]]) { hay = true; break; } }
      if (!hay) continue;
    }
    if (lentas.length) {
      const r = T.fila(i);
      for (const d of lentas) if (!S.f[d].has(val(r, d))) continue fila;
    }
    out[m++] = i;
  }
  return Filas(T, out.slice(0, m));
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
            alcance: 'gestionadas', agrupaVersion: true },
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
  REGLAS_V++;                       // las reglas mandan sobre el cumplimiento
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
  // appKey -> { dev: Map(equipo -> version), agg: Map(version -> peso) }
  const out = new Map();
  for (const r of rows) {
    let e = out.get(r.appKey);
    if (!e) out.set(r.appKey, e = { dev: new Map(), agg: new Map() });
    if (!r.device) {
      // Una fila agregada vale por r.w equipos, y hay que contarla como tal.
      // Indexada por equipo caia bajo la clave '' junto con todas las demas, se
      // pisaban entre si y la aplicacion entera contaba como UN equipo: el
      // percentil no llegaba nunca al 50 % y el estandar se sembraba en la
      // version mas antigua, con lo que todo el parque salia cumpliendo.
      if (!VER_UNK.test(r.ver)) e.agg.set(r.ver, (e.agg.get(r.ver) || 0) + (r.w || 1));
      continue;
    }
    const p = e.dev.get(r.device);
    if (p === undefined || (!VER_UNK.test(r.ver) && verCmp(r.ver, p) > 0)) e.dev.set(r.device, r.ver);
  }
  return out;
}
/** Reparto de equipos por version efectiva, de la mas nueva a la mas antigua. */
function verSpread(e) {
  if (!e) return [];
  const dev = e.dev || e, agg = e.agg;   // admite tambien un Map suelto
  const c = new Map();
  dev.forEach(v => { if (!VER_UNK.test(v)) c.set(v, (c.get(v) || 0) + 1); });
  if (agg) agg.forEach((n, v) => c.set(v, (c.get(v) || 0) + n));
  return Array.from(c.entries()).sort((a, b) => verCmp(b[0], a[0]));
}
/** Cuantos equipos representa un reparto. */
const spreadTotal = sp => sp.reduce((s, x) => s + x[1], 0);
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
    const spread = verSpread(eff.get(k));
    // El total tiene que salir del mismo reparto, no de otra cuenta: si no
    // coinciden, el percentil se desvia y el estandar sale mal sembrado.
    const { rec, min } = seedThresholds(spread, spreadTotal(spread) || devs.size);
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
const CMP = { rowState: new Uint8Array(0), dev: new Map(), app: new Map(), tot: null, stale: new Set() };
const EST_LAB = { ok: 'Cumple', warn: 'Requiere atención', bad: 'No cumple', na: 'No puntúa' };
// El estado de cada fila cabe en un byte; estas dos tablas lo traducen.
const EST_COD = { ok: 1, warn: 2, bad: 3, na: 4 };
const EST_ORD = ['', 'Cumple', 'Requiere atención', 'No cumple', 'No puntúa'];
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
  CMP.dev = new Map(); CMP.app = new Map(); CMP.stale = new Set();
  // Mapa anidado, no una clave de texto. Antes se construia una clave
  // «equipo + separador + appKey» por fila y luego se partia para recuperar las
  // dos mitades: con 280.000 filas es casi un millon de cadenas para nada.
  const best = new Map();                        // equipo -> Map(appKey -> version mas alta)
  const aggApp = new Map();                      // sin equipo: se pesan por recuento
  // Todo fuera del bucle, como en aggregate: leer un campo es indexar dos
  // arrays y no llamar a nada.
  const T = rows.tabla;
  const cD = T.crudo('device'), cK = T.crudo('appKey'), cV = T.crudo('ver');
  const aD = cD.a, vD = cD.vals, aK = cK.a, vK = cK.vals, aV = cV.a, vV = cV.vals;
  const dVUnk = T.derivado('ver', ES_VUNK);      // por version distinta, no por fila
  const pesosC = T.pesos, diasC = T.dias;
  const idxC = rows.idx, nC = rows.length;
  // Las dos condiciones son excluyentes, asi que una sola pasada basta.
  for (let k = 0; k < nC; k++) {
    const i = idxC ? idxC[k] : k;
    const device = aD ? vD[aD[i]] : '';
    const key = aK ? vK[aK[i]] : '';
    const ver = aV ? vV[aV[i]] : '';
    if (!device) {
      let a = aggApp.get(key);
      if (!a) aggApp.set(key, a = { ok: 0, warn: 0, bad: 0, na: 0 });
      a[evalVer(key, ver)] += pesosC[i];
      continue;
    }
    let m = best.get(device);
    if (!m) best.set(device, m = new Map());
    const p = m.get(key);
    if (p === undefined || (!dVUnk[aV ? aV[i] : 0] && verCmp(ver, p) > 0)) m.set(key, ver);
  }
  const pairApp = new Map();                     // appKey -> Map(equipo -> estado)
  best.forEach((m, dev) => {
    let dm = CMP.dev.get(dev);
    if (!dm) CMP.dev.set(dev, dm = { ok: 0, warn: 0, bad: 0, na: 0, noAuth: [], bad_: [], warn_: [], last: null });
    m.forEach((ver, k) => {
      const st = evalVer(k, ver);
      dm[st]++;
      if (st === 'bad') { const r = rule(k); (r && r.estado === 'no-permitida' ? dm.noAuth : dm.bad_).push(k); }
      else if (st === 'warn') dm.warn_.push(k);
      let am = pairApp.get(k); if (!am) pairApp.set(k, am = new Map());
      am.set(dev, st);
    });
  });
  // Estado por fila, para poder filtrar por cumplimiento. Va por INDICE de
  // fila y en un array de bytes: con la tabla columnar cada recorrido crea
  // objetos nuevos -una clave por objeto no se volveria a encontrar jamas- y
  // un Map de 281.634 entradas son once megas para guardar cuatro estados.
  CMP.rowState = new Uint8Array(T.length);
  const ultimoDia = new Map();                   // equipo -> dia mas reciente
  for (let k = 0; k < nC; k++) {
    const i = idxC ? idxC[k] : k;
    const device = aD ? vD[aD[i]] : '';
    const key = aK ? vK[aK[i]] : '';
    const am = pairApp.get(key);
    CMP.rowState[i] = device
      ? EST_COD[(am && am.get(device)) || 'na']
      : EST_COD[evalVer(key, aV ? vV[aV[i]] : '')];
    const dd = diasC[i];
    if (dd >= 0 && device) {
      const p = ultimoDia.get(device);
      if (p === undefined || dd > p) ultimoDia.set(device, dd);
    }
  }
  // La fecha se ha llevado como numero de dia y se convierte una vez por
  // equipo: 26.863 objetos Date en vez de uno por cada fila.
  ultimoDia.forEach((dd, dev) => { const o = CMP.dev.get(dev); if (o) o.last = new Date(dd * DAY_MS); });
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
