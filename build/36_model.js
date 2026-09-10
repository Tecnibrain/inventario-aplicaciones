
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
  tabla: null, rows: null, devInfo: new Map(), sources: [], headers: [], cols: {},
  fileName: '', sheet: '', mode: 'detalle',
  // El archivo de origen, para poder volver a recorrerlo. `esParquet` dice con
  // que lector se leyo: releer un Parquet como texto revienta. `archivoNombre`
  // es solo el nombre, que es lo que sobrevive a la copia guardada.
  archivo: null, esParquet: false, archivoNombre: '', completo: [],
  hasGeo: false, hasCliente: false, hasArea: false, hasTime: false, hasUser: false,
  hasEos: false, hasDetalle: false, hasAgregado: false,
  deviceApps: new Map(), latestVer: new Map(), maxDate: null, minDate: null
};

// El modelo arranca con una tabla vacia, no con un array suelto: asi todo lo que
// recorre filas encuentra siempre la misma forma y no hay que distinguir casos.
M.tabla = Tabla();
M.rows = Filas(M.tabla, new Int32Array(0));


/* Tramos del histograma de densidad de software por equipo. */
const BUCKETS = [[1,10,'1–10'],[11,25,'11–25'],[26,40,'26–40'],[41,55,'41–55'],
                 [56,70,'56–70'],[71,90,'71–90'],[91,Infinity,'91+']];
const bucketOf = n => (BUCKETS.find(b => n >= b[0] && n <= b[1]) || BUCKETS[BUCKETS.length - 1])[2];

/* Topes tipicos de exportacion de una consola: si el recuento cae justo encima,
   lo mas probable es que el archivo venga cortado. */
const TOPES = [1000, 5000, 10000, 30000, 50000, 100000, 200000, 500000];

/** Clasifica el archivo por las columnas que trae. */
function shapeOf(cols) {
  // Lo que define una fila de aplicacion es el NOMBRE de la aplicacion. Un
  // fabricante suelto no basta: en un parque de equipos, «Manufacturer» es
  // quien fabrico el portatil, no quien publica el software. Darlo por bueno
  // metia un equipo fantasma por fila en el catalogo.
  const conApp = cols.app != null;
  const conDev = cols.device != null;
  const conCnt = cols.count != null;
  if (conApp && conCnt && !conDev) return 'agregado';
  if (conApp && conDev) return 'detalle';
  if (conApp && conCnt) return 'agregado';
  if (conDev) return 'parque';
  if (conApp) return 'detalle';
  return null;
}

/** La cabecera llego entera en una columna: el separador no era el adivinado. */
function sinPartir(headers) {
  const vistas = headers.filter(h => h !== '');
  return vistas.length === 1 && /[,;\t|]/.test(vistas[0]);
}

/**
 * Por que no se reconocio el archivo. Sin ver las cabeceras que llegaron no hay
 * forma de saberlo, asi que el mensaje las enseña y separa los tres motivos que
 * lo causan de verdad: separador mal adivinado, cabeceras en otra fila, o
 * nombres de columna que el detector no conoce todavia.
 */
function explicaCabeceras(headers, grid) {
  const vistas = headers.filter(h => h !== '');
  const lista = vistas.slice(0, 14).map(h => '«' + truncate(h, 34) + '»').join(' · ') +
                (vistas.length > 14 ? ' … y ' + (vistas.length - 14) + ' más' : '');

  if (sinPartir(headers))
    return 'La cabecera no se partió en columnas: llegó entera como una sola. ' +
           'El archivo usa un separador que no se reconoció. Ábrelo y comprueba si separa ' +
           'con punto y coma, tabulador o barra vertical. Lo que llegó: ' + lista;

  if (!vistas.length)
    return 'La primera fila del archivo está vacía, así que no hay cabeceras que leer. ' +
           'Algunos exports meten filas de título antes de la tabla: bórralas y deja la ' +
           'fila de nombres de columna arriba del todo.';

  return 'No se reconoció ninguna columna útil. Hace falta al menos una de aplicación ' +
         '(SoftwareName, ApplicationName, Aplicación…) o de equipo (DeviceName, Equipo…). ' +
         'Cabeceras leídas' + (grid && grid.length > 1 ? ' (' + fmt(grid.length - 1) + ' filas debajo)' : '') +
         ': ' + lista;
}

/**
 * Lee una cuadricula y la funde en el modelo. `reset` empieza de cero;
 * si no, acumula: asi se cargan parque + catalogo + excepciones por separado.
 */
/**
 * Empieza de cero. Vaciar `M.sources` no basta: las filas viven en la tabla
 * columnar y se quedaban dentro aunque ya no las apuntase ninguna fuente, asi
 * que importar un segundo archivo sin recargar la pagina arrastraba el primero.
 */
function resetModel() {
  M.sources = [];
  M.tabla = Tabla();
  M.rows = Filas(M.tabla, new Int32Array(0));
  M.devInfo = new Map();
  // El archivo de origen NO se toca aqui: los importadores lo anotan antes de
  // empezar y llaman a esto a mitad de camino. Se limpia al quitar todo.
}

/** Olvida tambien de donde venia. Esto es «quitar todos los archivos». */
function resetOrigen() {
  M.archivo = null; M.archivoNombre = ''; M.esParquet = false; M.completo = [];
}

function addSource(grid, fileName, sheet, reset) {
  const headers = (grid[0] || []).map(h => String(h == null ? '' : h).trim());
  // Antes de detectar nada: si la cabecera llego entera en una sola columna, lo
  // que haya dentro puede encajar por casualidad («DeviceId;ApplicationName…»
  // contiene «device») y el archivo entraria como un parque de un solo equipo.
  if (sinPartir(headers)) throw new Error(explicaCabeceras(headers, grid));
  const cols = detectColumns(headers);
  const shape = shapeOf(cols);
  if (!shape) throw new Error(explicaCabeceras(headers, grid));

  if (reset) resetModel();

  if (!M.tabla) M.tabla = Tabla();
  const g = (r, k) => cols[k] == null ? '' : (r[cols[k]] == null ? '' : r[cols[k]]);
  const nuevas = [];                     // indices en la tabla, no objetos
  // Cada fuente guarda sus propias filas y fichas de equipo. Asi retirar un
  // archivo cargado por error es rehacer la mezcla sin el, no deshacerla.
  const fichas = new Map();

  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r || !r.some(c => c !== null && c !== undefined && String(c).trim() !== '')) continue;
    const device = String(g(r, 'device')).trim();
    const ts = parseDate(g(r, 'ts'));

    // ficha de equipo: se guarda siempre que la fila traiga nombre de equipo
    if (device) {
      let d = fichas.get(device);
      if (!d) fichas.set(device, d = { device });
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
    // El nombre tal cual se conserva: agrupar no es perder.
    const appRaw = app;
    const appGrp = CFG.params.agrupaVersion === false ? app : baseApp(app);
    // Una fila que resume una aplicacion entera trae cuantas versiones conviven.
    // Si son varias, la version de la fila es solo la mas alta y no representa a
    // los equipos que cuenta: darla por buena para todos inflaria el
    // cumplimiento justo hacia el lado que nadie revisa. Se cuenta la
    // instalacion y se deja la version en desconocida.
    const nVer = cols.nver == null ? 0
      : parseInt(String(g(r, 'nver')).replace(/[^\d]/g, ''), 10) || 0;
    const verFila = String(g(r, 'ver')).trim();
    const verUsable = nVer > 1 ? '' : verFila;
    const cpeRaw = String(g(r, 'cpe')).trim();
    const eos = String(g(r, 'eos')).trim();
    const o = {
      device, w,
      user:    device ? '' : '',
      vendor:  (!vendor || VEN_UNK.test(vendor)) ? '(sin fabricante)' : vendor,
      app:     appGrp || app || '(sin nombre)',
      appRaw:  appRaw || '(sin nombre)',
      ver:     verUsable || '(sin versión)',
      cpeRaw,
      os:      String(g(r, 'os')).trim(),
      osver:   String(g(r, 'osver')).trim() || '(sin versión)',
      geo:     String(g(r, 'geo')).trim(),
      cliente: String(g(r, 'cliente')).trim(),
      area:    String(g(r, 'area')).trim(),
      eos,
      aprob:   String(g(r, 'approved')).trim() || (nVer > 1 ? verFila : ''),
      ts
    };
    o.appKey = o.vendor + ' / ' + o.app;
    // El objeto es de usar y tirar: la tabla se queda con los enteros.
    nuevas.push(M.tabla.add(o));
  }

  if (!nuevas.length && shape !== 'parque')
    throw new Error('El archivo no contiene filas de datos por debajo de la cabecera.');

  const idx = Int32Array.from(nuevas);
  const vista = Filas(M.tabla, idx);
  const truncado = detectaCorte(shape, grid.length - 1, vista, fichas.size);
  M.sources.push({ name: fileName, sheet, shape, cols, headers, truncado,
                   filas: idx.length || (grid.length - 1), equipos: fichas.size,
                   rows: vista, idx, devs: fichas });
  mergeSources();
  return M.sources[M.sources.length - 1];
}

/**
 * Una instalacion contada dos veces. El modelo funde las fuentes sumando filas,
 * asi que si una fila agregada dice «Chrome 125: 243 equipos» y ademas llega el
 * detalle de esos mismos 243, la version cuenta 486. No se corrige solo: el
 * detalle puede ser un lote parcial, y descontarlo entonces dejaria la cuenta
 * corta, que es peor que verla larga. Se avisa y se deja decidir.
 */
function detectaSolape() {
  const agg = new Set(), det = new Set();
  for (const s of M.sources) {
    const donde = s.shape === 'agregado' ? agg : s.shape === 'detalle' ? det : null;
    if (!donde) continue;
    const gK = M.tabla.acceso('appKey'), gV = M.tabla.acceso('ver');
    s.rows.cada(i => donde.add(gK(i) + String.fromCharCode(1) + gV(i)));
  }
  let n = 0;
  agg.forEach(k => { if (det.has(k)) n++; });
  return n;
}

/**
 * Rellena el fabricante que falte usando el que si se conoce del mismo nombre.
 *
 * Una fuente puede traer el editor y otra no -el export de HP lo pone en la hoja
 * de catalogo y no en la de detalle- y entonces el mismo producto sale dos
 * veces, una con fabricante y otra sin el. Como la clave de aplicacion lleva el
 * fabricante dentro, para el modelo son dos aplicaciones distintas.
 *
 * Se elige el fabricante con mas peso, no el primero que aparezca: si dos
 * fuentes discrepan, manda la que cubre mas equipos.
 */
function rellenaFabricante() {
  const conocido = new Map();               // nombre -> Map(fabricante -> peso)
  const T = M.tabla;
  const gVen = T.acceso('vendor'), gApp = T.acceso('app');
  M.rows.cada(i => {
    const ven = gVen(i) || '(sin fabricante)';
    if (ven === '(sin fabricante)') return;
    const app = gApp(i);
    let m = conocido.get(app);
    if (!m) conocido.set(app, m = new Map());
    m.set(ven, (m.get(ven) || 0) + T.peso(i));
  });
  let n = 0;
  M.rows.cada(i => {
    if ((gVen(i) || '(sin fabricante)') !== '(sin fabricante)') return;
    const app = gApp(i);
    const m = conocido.get(app);
    if (!m) return;
    let mejor = '', peso = -1;
    m.forEach((w, v) => { if (w > peso) { peso = w; mejor = v; } });
    if (!mejor) return;
    T.poner('vendor', i, mejor);
    T.poner('appKey', i, mejor + ' / ' + app);
    n++;
  });
  return n;
}

/** Rehace el modelo a partir de las fuentes que queden. */
function mergeSources() {
  M.devInfo = new Map();
  M.hasDetalle = false;
  M.hasAgregado = false;
  M.headers = [];
  // Nada que copiar: se juntan los indices de cada fuente y ya.
  let n = 0;
  for (const s of M.sources) n += s.idx.length;
  const todos = new Int32Array(n);
  let k = 0;
  for (const s of M.sources) { todos.set(s.idx, k); k += s.idx.length; }
  M.rows = Filas(M.tabla || (M.tabla = Tabla()), todos);
  for (const s of M.sources) {
    s.devs.forEach((d, k) => {
      let t = M.devInfo.get(k);
      if (!t) M.devInfo.set(k, t = { device: k });
      for (const campo in d) if (d[campo] !== '' && d[campo] != null && !t[campo]) t[campo] = d[campo];
    });
    if (s.shape === 'detalle') M.hasDetalle = true;
    if (s.shape === 'agregado') M.hasAgregado = true;
    if (!M.headers.length || s.shape === 'detalle') { M.headers = s.headers; M.cols = s.cols; }
  }
  M.fileName = M.sources.map(s => s.name).join(' + ');
  M.rellenados = rellenaFabricante();
  M.solape = detectaSolape();
  MODELO_V++;
  recomputeModel();
  return M;
}

/** Retira una fuente cargada por error y rehace el modelo sin ella. */
function removeSource(i) {
  if (i < 0 || i >= M.sources.length) return null;
  const fuera = M.sources.splice(i, 1)[0];
  mergeSources();
  return fuera;
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
    // Por el ENTERO del equipo: materializar las filas como objetos solo para
    // contarlas costaba mas que todo lo demas junto de esta comprobacion. El
    // orden de insercion se respeta, que es de lo que depende «el ultimo».
    const porDev = new Map();
    const aD = nuevas.tabla.crudo('device').a;
    if (aD) nuevas.cada(i => { const dv = aD[i]; if (dv) porDev.set(dv, (porDev.get(dv) || 0) + 1); });
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

  // Completar cada fila con la ficha del equipo, para que los filtros
  // funcionen. La ficha se busca por el ENTERO del equipo: una vez por equipo
  // distinto -26.863- y no una por cada fila.
  const T = M.tabla;
  const idxR = rows.idx, nR = rows.length;
  const cDevR = T.crudo('device'), aDevR = cDevR.a, vDevR = cDevR.vals;

  if (M.devInfo.size && aDevR) {
    const ficha = new Array(vDevR.length);
    let alguna = false;
    for (let k = 1; k < vDevR.length; k++) {
      const f = M.devInfo.get(vDevR[k]);
      if (f) { ficha[k] = f; alguna = true; }
    }
    if (alguna) {
      const gUsrR = T.acceso('user'), gOsvR = T.acceso('osver'), gOsR = T.acceso('os');
      const gGeoR = T.acceso('geo'), gCliR = T.acceso('cliente'), gAreR = T.acceso('area');
      for (let k = 0; k < nR; k++) {
        const i = idxR ? idxR[k] : k;
        const d = ficha[aDevR[i]];
        if (!d) continue;
        if (!gUsrR(i) && d.user) T.poner('user', i, d.user);
        const ov = gOsvR(i);
        if ((!ov || ov === '(sin versión)') && d.osver) T.poner('osver', i, d.osver);
        if (!gOsR(i) && d.os) T.poner('os', i, d.os);
        if (!gGeoR(i) && d.geo) T.poner('geo', i, d.geo);
        if (!gCliR(i) && d.cliente) T.poner('cliente', i, d.cliente);
        if (!gAreR(i) && d.area) T.poner('area', i, d.area);
        if (T.diaDe(i) < 0 && d.ts) T.ponerFecha(i, d.ts);
      }
    }
  }

  // Recuento de apps por equipo -> bucket del histograma (solo con detalle).
  // Se cuenta por entero y el bucket se resuelve una vez por equipo, no por
  // fila: escribir la columna pasa a ser copiar un numero.
  const cKeyR = T.crudo('appKey'), aKeyR = cKeyR.a, vKeyR = cKeyR.vals;
  const porEquipo = new Map();
  if (aDevR) for (let k = 0; k < nR; k++) {
    const i = idxR ? idxR[k] : k;
    const dv = aDevR[i];
    if (!dv) continue;
    let s = porEquipo.get(dv); if (!s) porEquipo.set(dv, s = new Set());
    s.add(aKeyR ? aKeyR[i] : 0);
  }
  const counts = new Map();                       // por nombre: lo lee el resto
  const cuentaPorId = [];
  porEquipo.forEach((s, dv) => { cuentaPorId[dv] = s.size; counts.set(vDevR[dv], s.size); });

  const idAgregado = T.idPara('bucket', '(agregado)');
  const idBucket = [];                            // recuento -> entero del bucket
  const bucketDeId = aDevR ? new Int32Array(vDevR.length) : null;
  if (bucketDeId) for (let dv = 1; dv < vDevR.length; dv++) {
    const c = cuentaPorId[dv] || 0;
    let b = idBucket[c];
    if (b === undefined) b = idBucket[c] = T.idPara('bucket', bucketOf(c));
    bucketDeId[dv] = b;
  }
  const aBucR = T.crudo('bucket').a;
  for (let k = 0; k < nR; k++) {
    const i = idxR ? idxR[k] : k;
    const dv = aDevR ? aDevR[i] : 0;
    aBucR[i] = dv ? bucketDeId[dv] : idAgregado;
  }

  // Version de referencia: la mas alta vista en todas las fuentes. Solo depende
  // de los pares (aplicacion, version) DISTINTOS, que son unos cientos. Se
  // apuntan como un entero por fila -barato- y comparar versiones, que es lo
  // caro, se hace una vez por par y no una por fila.
  const cVerR = T.crudo('ver'), aVerR = cVerR.a, vVerR = cVerR.vals;
  const dUnkR = T.derivado('ver', ES_VUNK);
  const NK = Math.max(1, vKeyR.length);
  const pares = new Set();
  for (let k = 0; k < nR; k++) {
    const i = idxR ? idxR[k] : k;
    const vi = aVerR ? aVerR[i] : 0;
    if (dUnkR[vi]) continue;
    pares.add(vi * NK + (aKeyR ? aKeyR[i] : 0));
  }
  const latestVer = new Map();
  pares.forEach(par => {
    const ver = vVerR[(par / NK) | 0] || '', key = vKeyR[par % NK] || '';
    const cur = latestVer.get(key);
    if (cur === undefined || verCmp(ver, cur) > 0) latestVer.set(key, ver);
  });

  // De las fechas solo hacen falta la primera y la ultima: no hay que juntar
  // 281.634 en un array para luego mirar dos. Las filas se guardan por dia; las
  // fichas de equipo conservan la hora, asi que se comparan aparte.
  const diasR = T.dias;
  let diaMin = Infinity, diaMax = -Infinity;
  for (let k = 0; k < nR; k++) {
    const d = diasR[idxR ? idxR[k] : k];
    if (d < 0) continue;
    if (d < diaMin) diaMin = d;
    if (d > diaMax) diaMax = d;
  }
  let tMin = Infinity, tMax = -Infinity;
  M.devInfo.forEach(d => { if (d.ts) { const t = +d.ts; if (t < tMin) tMin = t; if (t > tMax) tMax = t; } });
  if (diaMax >= 0) { tMin = Math.min(tMin, diaMin * DAY_MS); tMax = Math.max(tMax, diaMax * DAY_MS); }
  const hayFecha = tMax > -Infinity;

  // Que una columna EXISTA ya significa que alguna fila trajo algo: la tabla no
  // crea columnas vacias. Preguntarlo asi cuesta nada; recorrer las filas para
  // averiguarlo costaba una pasada entera por cada campo.
  const enFichas = k => { for (const d of M.devInfo.values()) if (d[k]) return true; return false; };
  const tiene = k => T.tiene(k) || enFichas(k);
  Object.assign(M, {
    deviceApps: counts, latestVer,
    hasGeo: tiene('geo'), hasCliente: tiene('cliente'), hasArea: tiene('area'),
    hasUser: tiene('user'), hasEos: T.tiene('eos'),
    hasTime: hayFecha,
    minDate: hayFecha ? new Date(tMin) : null,
    maxDate: hayFecha ? new Date(tMax) : null
  });
  return M;
}

/** Compatibilidad: la carga inicial reemplaza, no acumula. */
function buildModel(grid, fileName, sheet) { return addSource(grid, fileName, sheet, true); }
