
/* ============================================================================
   4. MODELO  ·  varias fuentes, detalle y agregado en el mismo tablero
   ----------------------------------------------------------------------------
   Un inventario completo (equipo x aplicacion x version) de un parque grande no
   cabe en el navegador: medido, 371.000 filas ya cuestan 18 s y 295 MB, y a los
   dos millones la pestana se cae. Por eso el modelo acepta tres formas de
   archivo y las fusiona:

     detalle    una fila por equipo y aplicacion        (lo clasico)
     agregado   una fila por aplicacion y version, con una columna de recuento
     parque     una fila por equipo, sin aplicaciones   (SO, usuario, fecha)

   Con «parque + agregado» se ve el 100 % del parque con unas decenas de miles
   de filas. El detalle se anade solo donde hace falta: las excepciones.
   ========================================================================== */
const M = {
  rows: [], devInfo: new Map(), sources: [], headers: [], cols: {},
  fileName: '', sheet: '', mode: 'detalle',
  hasGeo: false, hasCliente: false, hasArea: false, hasTime: false, hasUser: false,
  hasEos: false, hasDetalle: false, hasAgregado: false,
  deviceApps: new Map(), latestVer: new Map(), maxDate: null, minDate: null
};

/* Tramos del histograma de densidad de software por equipo. */
const BUCKETS = [[1,10,'1–10'],[11,25,'11–25'],[26,40,'26–40'],[41,55,'41–55'],
                 [56,70,'56–70'],[71,90,'71–90'],[91,Infinity,'91+']];
const bucketOf = n => (BUCKETS.find(b => n >= b[0] && n <= b[1]) || BUCKETS[BUCKETS.length - 1])[2];

/* Topes tipicos de exportacion de una consola: si el recuento cae justo encima,
   lo mas probable es que el archivo venga cortado. */
const TOPES = [1000, 5000, 10000, 30000, 50000, 100000, 200000, 500000];

/** Clasifica el archivo por las columnas que trae. */
function shapeOf(cols) {
  const conApp = cols.app != null || cols.vendor != null;
  const conDev = cols.device != null;
  const conCnt = cols.count != null;
  if (conApp && conCnt && !conDev) return 'agregado';
  if (conApp && conDev) return 'detalle';
  if (conApp && conCnt) return 'agregado';
  if (conDev && !conApp) return 'parque';
  if (conApp) return 'detalle';
  return null;
}

/**
 * Lee una cuadricula y la funde en el modelo. `reset` empieza de cero;
 * si no, acumula: asi se cargan parque + catalogo + excepciones por separado.
 */
function addSource(grid, fileName, sheet, reset) {
  const headers = (grid[0] || []).map(h => String(h == null ? '' : h).trim());
  const cols = detectColumns(headers);
  const shape = shapeOf(cols);
  if (!shape) throw new Error(
    'No se reconoció ninguna columna útil. Se necesita al menos una columna de ' +
    'aplicación o de equipo. Comprueba que la primera fila sean las cabeceras.');

  if (reset) {
    M.rows = []; M.devInfo = new Map(); M.sources = [];
    M.hasDetalle = false; M.hasAgregado = false;
  }

  const g = (r, k) => cols[k] == null ? '' : (r[cols[k]] == null ? '' : r[cols[k]]);
  const nuevas = [];
  let devs = 0;

  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r || !r.some(c => c !== null && c !== undefined && String(c).trim() !== '')) continue;
    const device = String(g(r, 'device')).trim();
    const ts = parseDate(g(r, 'ts'));

    // ficha de equipo: se guarda siempre que la fila traiga nombre de equipo
    if (device) {
      let d = M.devInfo.get(device);
      if (!d) { M.devInfo.set(device, d = { device }); devs++; }
      const set = (k, v) => { if (v !== '' && v != null && !d[k]) d[k] = v; };
      set('user', String(g(r, 'user')).trim());
      set('domain', String(g(r, 'domain')).trim());
      set('os', String(g(r, 'os')).trim());
      set('osver', String(g(r, 'osver')).trim());
      set('geo', String(g(r, 'geo')).trim());
      set('cliente', String(g(r, 'cliente')).trim());
      set('area', String(g(r, 'area')).trim());
      set('salud', String(g(r, 'salud')).trim());
      if (ts && (!d.ts || ts > d.ts)) d.ts = ts;
    }

    if (shape === 'parque') continue;              // sin aplicaciones que registrar

    const vendor = String(g(r, 'vendor')).trim();
    const app = String(g(r, 'app')).trim();
    if (!vendor && !app) continue;

    let w = 1;
    if (cols.count != null) {
      const n = parseFloat(String(g(r, 'count')).replace(/[^\d.,-]/g, '').replace(',', '.'));
      w = isFinite(n) && n > 0 ? Math.round(n) : 1;
    }
    const cpeRaw = String(g(r, 'cpe')).trim();
    const eos = String(g(r, 'eos')).trim();
    const o = {
      device, w,
      user:    device ? '' : '',
      vendor:  vendor || '(sin fabricante)',
      app:     app || '(sin nombre)',
      ver:     String(g(r, 'ver')).trim() || '(sin versión)',
      cpeRaw,
      cpe:     !!cpeRaw && !/^(not available|n\/?a|none|null|-|sin dato)$/i.test(cpeRaw),
      os:      String(g(r, 'os')).trim(),
      osver:   String(g(r, 'osver')).trim() || '(sin versión)',
      geo:     String(g(r, 'geo')).trim(),
      cliente: String(g(r, 'cliente')).trim(),
      area:    String(g(r, 'area')).trim(),
      eos, eosBad: /^(eos|endofsupport|fuera|expired|caducad|sin soporte|true|si|yes)/i.test(eos),
      aprob:   String(g(r, 'approved')).trim(),
      ts, day: dayKey(ts), _raw: r
    };
    o.appKey = o.vendor + ' / ' + o.app;
    nuevas.push(o);
  }

  if (!nuevas.length && shape !== 'parque')
    throw new Error('El archivo no contiene filas de datos por debajo de la cabecera.');

  M.rows = M.rows.concat(nuevas);
  if (shape === 'detalle') M.hasDetalle = true;
  if (shape === 'agregado') M.hasAgregado = true;

  const truncado = detectaCorte(shape, grid.length - 1, nuevas, devs);
  M.sources.push({ name: fileName, sheet, shape, filas: nuevas.length || (grid.length - 1),
                   equipos: devs, truncado, headers });
  if (!M.headers.length || shape === 'detalle') { M.headers = headers; M.cols = cols; }
  M.fileName = M.sources.map(s => s.name).join(' + ');
  M.sheet = sheet;
  recomputeModel();
  return M.sources[M.sources.length - 1];
}

/**
 * Detecta una exportacion cortada. La consola de Defender limita el numero de
 * filas; si ademas la consulta lleva `sort by`, el corte siempre cae en el mismo
 * tramo del alfabeto y el analisis sale sesgado sin avisar.
 */
function detectaCorte(shape, filas, nuevas, devs) {
  const señales = [];
  for (const t of TOPES) if (filas >= t * 0.995 && filas <= t) señales.push('el recuento (' + fmt(filas) + ') coincide con un tope de exportación habitual');
  if (shape === 'detalle' && nuevas.length > 200) {
    // si el corte cayo dentro de un equipo, el ultimo tendra muchas menos filas
    const porDev = new Map();
    for (const r of nuevas) if (r.device) porDev.set(r.device, (porDev.get(r.device) || 0) + 1);
    const lista = Array.from(porDev.values());
    if (lista.length > 20) {
      const ord = lista.slice().sort((a, b) => a - b);
      const mediana = ord[Math.floor(ord.length / 2)];
      const ultimo = lista[lista.length - 1];
      if (mediana > 4 && ultimo < mediana * 0.4)
        señales.push('el último equipo trae ' + fmt(ultimo) + ' aplicaciones frente a una mediana de ' + fmt(mediana));
    }
  }
  return señales;
}

/** Recalcula lo derivado despues de fusionar una fuente. */
function recomputeModel() {
  const rows = M.rows;
  M.mode = M.hasDetalle && M.hasAgregado ? 'mixto' : M.hasAgregado ? 'agregado' : 'detalle';

  // completar cada fila con la ficha del equipo, para que los filtros funcionen
  for (const r of rows) {
    if (!r.device) continue;
    const d = M.devInfo.get(r.device);
    if (!d) continue;
    if (!r.user && d.user) r.user = d.user;
    if ((!r.osver || r.osver === '(sin versión)') && d.osver) r.osver = d.osver;
    if (!r.os && d.os) r.os = d.os;
    if (!r.geo && d.geo) r.geo = d.geo;
    if (!r.cliente && d.cliente) r.cliente = d.cliente;
    if (!r.area && d.area) r.area = d.area;
    if (!r.ts && d.ts) { r.ts = d.ts; r.day = dayKey(d.ts); }
  }

  // recuento de apps por equipo -> bucket del histograma (solo con detalle)
  const dm = new Map();
  for (const r of rows) if (r.device) {
    let s = dm.get(r.device); if (!s) dm.set(r.device, s = new Set());
    s.add(r.appKey);
  }
  const counts = new Map();
  dm.forEach((s, d) => counts.set(d, s.size));
  for (const r of rows) r.bucket = r.device ? bucketOf(counts.get(r.device) || 0) : '(agregado)';

  // version de referencia: la mas alta vista en todas las fuentes
  const latestVer = new Map();
  for (const r of rows) {
    if (VER_UNK.test(r.ver)) continue;
    const cur = latestVer.get(r.appKey);
    if (cur === undefined || verCmp(r.ver, cur) > 0) latestVer.set(r.appKey, r.ver);
  }

  const fechas = [];
  for (const r of rows) if (r.ts) fechas.push(+r.ts);
  M.devInfo.forEach(d => { if (d.ts) fechas.push(+d.ts); });

  const tiene = k => rows.some(r => r[k]) || Array.from(M.devInfo.values()).some(d => d[k]);
  Object.assign(M, {
    deviceApps: counts, latestVer,
    hasGeo: tiene('geo'), hasCliente: tiene('cliente'), hasArea: tiene('area'),
    hasUser: tiene('user'), hasEos: rows.some(r => r.eos),
    hasTime: fechas.length > 0,
    minDate: fechas.length ? new Date(vMin(fechas)) : null,
    maxDate: fechas.length ? new Date(vMax(fechas)) : null
  });
  return M;
}

/** Compatibilidad: la carga inicial reemplaza, no acumula. */
function buildModel(grid, fileName, sheet) { return addSource(grid, fileName, sheet, true); }
