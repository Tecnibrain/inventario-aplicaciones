
/* ============================================================================
   18b. LECTURA EN STREAMING  ·  archivos que no caben en memoria
   ---------------------------------------------------------------------------
   El detalle crudo de un parque grande son gigabytes. Cargarlo entero es
   imposible, pero RECORRERLO no: el problema nunca fue leer el archivo, fue
   guardarlo. `file.arrayBuffer()` reserva el fichero completo y decodificarlo a
   texto lo duplica, porque las cadenas de JavaScript son UTF-16; ademas 1,7 GB
   de texto pasan del tamaño maximo de cadena de V8, asi que ni siquiera llega a
   fallar por memoria: falla antes.

   Aqui se lee por trozos y se suelta cada uno en cuanto se ha contado. Lo que
   queda en memoria es el resumen, unos pocos MB, y del archivo grande no queda
   nada. Es lo mismo que hace resumir-detalle.ps1, pero sin salir de la pagina.
   ========================================================================== */

/**
 * Analizador de CSV que sobrevive a los cortes entre trozos.
 *
 * Lo delicado es la comilla al final de un trozo: dentro de un campo
 * entrecomillado, un `"` puede cerrar el campo o ser la primera mitad de un `""`
 * escapado, y para saberlo hace falta el caracter siguiente, que todavia no ha
 * llegado. Se anota la duda y se resuelve al empezar el trozo de al lado.
 */
function lectorCsv(sep) {
  let campo = '', fila = [], comillas = false, duda = false;
  return {
    trozo(txt, cb) {
      let i = 0;
      if (duda) {                       // la comilla pendiente del trozo anterior
        duda = false;
        if (txt[0] === '"') { campo += '"'; i = 1; }
        else comillas = false;
      }
      for (; i < txt.length; i++) {
        const c = txt[i];
        if (comillas) {
          if (c !== '"') { campo += c; continue; }
          if (i === txt.length - 1) { duda = true; continue; }
          if (txt[i + 1] === '"') { campo += '"'; i++; }
          else comillas = false;
        } else if (c === '"') comillas = true;
        else if (c === sep) { fila.push(campo); campo = ''; }
        else if (c === '\n') { fila.push(campo); cb(fila); fila = []; campo = ''; }
        else if (c !== '\r') campo += c;
      }
    },
    fin(cb) {
      if (duda) comillas = false;
      if (campo !== '' || fila.length) { fila.push(campo); cb(fila); }
    }
  };
}

/**
 * Cabecera y separador, leyendo solo el principio del archivo.
 * Hace falta saberlos ANTES de recorrerlo: si no, habria que dar dos vueltas
 * enteras solo para descubrir en que columna esta cada cosa.
 */
async function cabeceraDe(file) {
  const trozo = await file.slice(0, 262144).arrayBuffer();
  const txt = decodeText(trozo);
  const corte = txt.indexOf('\n');
  const linea = corte < 0 ? txt : txt.slice(0, corte);
  const sep = sniffDelim(linea);
  let cab = [];
  lectorCsv(sep).trozo(linea + '\n', f => { if (!cab.length) cab = f; });
  return { sep, headers: cab.map(h => String(h).trim()) };
}

/**
 * Recorre un archivo entero llamando a `cb` por fila de datos, sin retenerlo.
 * `onProg` recibe la fraccion leida y el numero de filas.
 */
async function recorrerArchivo(file, sep, cb, onProg) {
  const lector = file.stream().getReader();
  const dec = new TextDecoder('utf-8');
  const csv = lectorCsv(sep);
  const total = file.size || 1;
  const CADA = 8 * 1048576;                 // avisa cada 8 MB, no en cada trozo
  let leidos = 0, n = 0, primera = true, ultimo = 0;

  const porFila = f => { if (primera) { primera = false; return; } n++; cb(f); };

  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    leidos += value.length;
    csv.trozo(dec.decode(value, { stream: true }), porFila);
    if (onProg && leidos - ultimo > CADA) {
      ultimo = leidos;
      onProg(leidos / total, n);
      await new Promise(r => setTimeout(r, 0));    // deja repintar la pagina
    }
  }
  const cola = dec.decode();
  if (cola) csv.trozo(cola, porFila);
  csv.fin(porFila);
  if (onProg) onProg(1, n);
  return n;
}

/** Indice de la primera cabecera que coincida, comparando como norm(). */
function idxDe(headers, nombres) {
  const H = headers.map(norm);
  for (const nom of nombres) {
    const i = H.indexOf(norm(nom));
    if (i >= 0) return i;
  }
  for (const nom of nombres) {
    const k = norm(nom);
    if (k.length > 3) { const i = H.findIndex(h => h.includes(k)); if (i >= 0) return i; }
  }
  return -1;
}

const SEP1 = String.fromCharCode(1);

/**
 * Importa un detalle enorme quedandose solo con lo que el tablero usa.
 *
 * Dos pasadas sobre el mismo archivo, que sale barato porque esta en disco:
 *
 *   1. cuenta instalaciones por aplicacion+version, guarda una ficha por equipo
 *      y anota la version mas alta de cada aplicacion. De aqui salen el catalogo
 *      agregado y el parque, y con ellos el tablero siembra el estandar.
 *   2. con ese estandar recien sembrado, saca QUE equipo va por detras. Solo eso:
 *      lo que ya esta al dia se cuenta pero no se nombra, y esa es justamente la
 *      diferencia entre unos pocos MB y varios GB.
 *
 * Las tres salidas son complementarias: cada instalacion cae en una y solo en
 * una, asi que al fundirlas no se cuenta nada dos veces.
 */
async function importarGrande(file, opts, onProg) {
  opts = opts || {};
  const completos = (opts.completo || []).filter(Boolean).map(s => s.toLowerCase());
  const esCompleto = app => completos.length > 0 &&
    completos.some(c => app.toLowerCase().indexOf(c) >= 0);
  const aviso = (frac, filas, fase) => onProg && onProg(frac, filas, fase);

  /**
   * El nombre agrupado, el MISMO que usa el modelo.
   *
   * Sin esto, «X - 1.2» y «X - 1.3» son dos aplicaciones distintas con una
   * version cada una, y entonces ninguna esta nunca por detras de si misma: no
   * se extraeria un solo nombre de equipo. Se cachea porque son decenas de
   * miles de nombres distintos y millones de filas.
   */
  const cacheGrupo = new Map();
  const grupo = a => {
    let x = cacheGrupo.get(a);
    if (x === undefined) cacheGrupo.set(a, x = (CFG.params.agrupaVersion === false ? a : baseApp(a)));
    return x;
  };

  /* Y la clave completa, por el mismo motivo: limpiar el fabricante y agrupar el
     nombre son media docena de expresiones regulares, y esto se llama una vez
     por INSTALACION -cuatro millones y medio-. Pares distintos hay unos miles. */
  const cacheClave = new Map();
  const claveDe = (v, a) => {
    const k = v + SEP1 + a;
    let x = cacheClave.get(k);
    if (x === undefined) cacheClave.set(k, x = claveApp(v, a));
    return x;
  };

  // El File es un puntero al archivo en disco, no una copia: guardarlo no cuesta
  // memoria y permite volver a recorrerlo despues para una aplicacion concreta.
  M.archivo = file;
  M.esParquet = false;      // con que lector se leyo, para poder repetirlo
  M.completo = completos.slice();

  const { sep, headers } = await cabeceraDe(file);
  const ix = {
    dev: idxDe(headers, ['DeviceName', 'Device', 'Equipo', 'NombreEquipo', 'ManagedDeviceName']),
    app: idxDe(headers, ['ApplicationName', 'SoftwareName', 'DisplayName', 'Aplicacion']),
    ven: idxDe(headers, ['ApplicationPublisher', 'SoftwareVendor', 'Publisher', 'Fabricante']),
    ver: idxDe(headers, ['ApplicationVersion', 'SoftwareVersion', 'Version']),
    usr: idxDe(headers, ['UserName', 'UPN', 'EmailAddress', 'Usuario']),
    os:  idxDe(headers, ['OSDescription', 'Platform', 'OS', 'OSDistribution']),
    osv: idxDe(headers, ['OSVersion', 'OSVersionInfo']),
    ts:  idxDe(headers, ['LastContact', 'Timestamp', 'Fecha'])
  };
  if (ix.app < 0 && ix.dev < 0)
    throw new Error('No se reconoció ninguna columna útil. Cabeceras leídas: ' +
      headers.slice(0, 14).map(h => '«' + truncate(h, 30) + '»').join(' · '));

  const g = (f, i) => i >= 0 && f[i] != null ? String(f[i]).trim() : '';

  /* ---- pasada 1: contar, sin guardar ninguna fila ------------------------ */
  const cuenta = new Map();     // vendor \x01 app \x01 ver -> instalaciones
  const alta = new Map();       // vendor \x01 app          -> version mas alta
  const fichas = new Map();     // equipo                   -> ficha
  // Todas las instalaciones, aparte del modelo: tres enteros por fila.
  const indice = Indice();

  const filas = await recorrerArchivo(file, sep, f => {
    const dev = g(f, ix.dev);
    if (dev && !fichas.has(dev))
      fichas.set(dev, [dev, g(f, ix.usr), g(f, ix.os), g(f, ix.osv), g(f, ix.ts)]);

    const app = g(f, ix.app);
    if (!app) return;
    const ven = g(f, ix.ven), ver = g(f, ix.ver);
    // Toda instalacion entra en el indice, la vea el modelo o no: son tres
    // enteros, y es lo que permite decir despues en que equipos esta una
    // aplicacion sin volver a leer el archivo.
    if (dev) indice.add(dev, claveDe(ven, app), ver);
    const k = ven + SEP1 + app + SEP1 + ver;
    cuenta.set(k, (cuenta.get(k) || 0) + 1);
    const ka = ven + SEP1 + grupo(app);
    const prev = alta.get(ka);
    if (prev === undefined || (!VER_UNK.test(ver) && verCmp(ver, prev) > 0)) alta.set(ka, ver);
  }, (frac, n) => aviso(frac * 0.5, n, 'Recorriendo el archivo'));

  /* ---- el estandar, sembrado con el catalogo completo --------------------- */
  aviso(0.52, filas, 'Construyendo el modelo');
  const nombre = truncate(file.name || 'detalle', 22);

  const parque = [['DeviceName', 'UserName', 'OSDistribution', 'OSVersionInfo', 'Timestamp']];
  fichas.forEach(v => parque.push(v));

  const todo = [['SoftwareVendor', 'SoftwareName', 'SoftwareVersion', 'Equipos']];
  cuenta.forEach((n, k) => { const p = k.split(SEP1); todo.push([p[0], p[1], p[2], String(n)]); });

  resetModel();
  if (parque.length > 1) addSource(parque, nombre + ' · parque', '', false);
  if (todo.length > 1) addSource(todo, nombre + ' · catálogo', '', false);
  M.aggFull = aggregate(M.rows);
  M.effVer = effVersions(M.rows);
  seedCatalog();

  /* ---- que se lleva cada archivo ----------------------------------------- */
  // El tope de cada aplicacion es su version aprobada; si no tiene regla, la mas
  // alta vista. Se resuelve una vez, no dentro del bucle.
  const tope = new Map();
  alta.forEach((v, ka) => {
    const p = ka.split(SEP1);
    const r = CFG.apps[p[0] + ' / ' + p[1]];
    tope.set(ka, (r && r.rec) || v || '');
  });
  const atrasada = (ven, app, ver) => {
    if (esCompleto(app)) return true;
    const t = tope.get(ven + SEP1 + grupo(app)) || '';
    return !!(t && !VER_UNK.test(ver) && verCmp(ver, t) < 0);
  };

  // Cuantas filas daria cada aplicacion. Se sabe ya, con las cuentas de la
  // primera pasada, asi que si hay que recortar se recorta por volumen y no por
  // donde caigan las filas en el archivo, que es como se sesga un analisis.
  const porApp = new Map();
  cuenta.forEach((n, k) => {
    const p = k.split(SEP1);
    if (!atrasada(p[0], p[1], p[2])) return;
    const ka = p[0] + SEP1 + grupo(p[1]);
    porApp.set(ka, (porApp.get(ka) || 0) + n);
  });

  const MAX = opts.maxExcep || TOPE_DETALLE;
  const orden = Array.from(porApp.entries()).sort((a, b) => b[1] - a[1]);
  const dentro = new Set();
  let acumulado = 0;
  const fuera = [];
  for (const [ka, n] of orden) {
    if (acumulado + n <= MAX) { dentro.add(ka); acumulado += n; }
    else fuera.push([ka.split(SEP1)[1], n]);
  }

  /* ---- el catalogo, ya sin lo que se llevan las excepciones --------------- */
  // Complementarios: cada instalacion cae en un archivo y solo en uno. Si las dos
  // se contaran, el reparto de versiones saldria inflado.
  const catalogo = [['SoftwareVendor', 'SoftwareName', 'SoftwareVersion', 'Equipos']];
  cuenta.forEach((n, k) => {
    const p = k.split(SEP1);
    if (dentro.has(p[0] + SEP1 + p[1]) && atrasada(p[0], p[1], p[2])) return;
    catalogo.push([p[0], p[1], p[2], String(n)]);
  });

  /* ---- pasada 2: quien va por detras ------------------------------------- */
  const excep = [['DeviceName', 'UserName', 'SoftwareVendor', 'SoftwareName',
                  'SoftwareVersion', 'Aprobada', 'OSVersionInfo']];
  await recorrerArchivo(file, sep, f => {
    const dev = g(f, ix.dev), app = g(f, ix.app);
    if (!dev || !app) return;
    const ven = g(f, ix.ven);
    if (!dentro.has(ven + SEP1 + grupo(app))) return;
    const ver = g(f, ix.ver);
    if (!atrasada(ven, app, ver)) return;
    excep.push([dev, g(f, ix.usr), ven, app, ver, tope.get(ven + SEP1 + grupo(app)) || '', g(f, ix.osv)]);
  }, (frac, n) => aviso(0.52 + frac * 0.46, n, 'Buscando equipos atrasados'));

  resetModel();
  if (parque.length > 1) addSource(parque, nombre + ' · parque', '', false);
  if (catalogo.length > 1) addSource(catalogo, nombre + ' · catálogo', '', false);
  if (excep.length > 1) addSource(excep, nombre + ' · atrasados', '', false);

  M.indice = indice;
  M.aggFull = aggregate(M.rows);
  M.effVer = effVersions(M.rows);
  seedCatalog();
  histSnapshot();
  aviso(1, filas, 'Listo');

  return { filas, equipos: fichas.size, versiones: cuenta.size,
           atrasados: excep.length - 1,
           fuera: fuera.length, fueraFilas: fuera.reduce((s, x) => s + x[1], 0),
           fueraApps: fuera.slice(0, 5).map(x => x[0]) };
}

/* ---------------------------------------------------------------------------
   Parquet: lo mismo, pero sesenta veces mas pequeno
   --------------------------------------------------------------------------- */

/** Los primeros y ultimos cuatro bytes de un Parquet son «PAR1». */
/**
 * Cuantas filas de detalle -las que llevan nombre de equipo- caben.
 *
 * El resto de aplicaciones se cuentan igual en el catalogo, pero sin nombres:
 * se ve cuantos equipos la tienen, no cuales. El boton «Traer los equipos de
 * esta aplicacion» recorre el archivo otra vez para una en concreto.
 *
 * El numero era 500.000 porque cada fila costaba 638 bytes como objeto y eso ya
 * eran 320 MB. Guardadas por columnas cuestan 105, asi que lo que manda ahora
 * no es la memoria sino el tiempo de dibujar: medido, agregar y calcular
 * cumplimiento salen a 2,5 microsegundos por fila, o sea unos 2,5 s para un
 * millon. Se paga una vez al cargar -despues queda en cache- y a cambio casi
 * ninguna aplicacion se queda sin nombres.
 */
const TOPE_DETALLE = 1000000;

function esParquet(buf) {
  const u = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  return u.length === 4 && u[0] === 0x50 && u[1] === 0x41 && u[2] === 0x52 && u[3] === 0x31;
}

/** El File como origen asincrono que entiende hyparquet: lee solo lo que pide. */
const bufferDe = file => ({
  byteLength: file.size,
  slice: (ini, fin) => file.slice(ini, fin === undefined ? file.size : fin).arrayBuffer()
});

/**
 * Importa un .parquet quedandose con lo que el tablero usa.
 *
 * Misma idea que con el CSV -dos pasadas, agregando sobre la marcha- pero aqui
 * cada pasada cuesta muchisimo menos: el archivo es sesenta veces mas pequeno,
 * viene por columnas y no hay texto que analizar. Y se piden SOLO las columnas
 * que hacen falta, asi que las que sobran ni se descomprimen.
 */
async function importarParquet(file, opts, onProg) {
  opts = opts || {};
  const completos = (opts.completo || []).filter(Boolean).map(s => s.toLowerCase());
  const esCompleto = app => completos.length > 0 &&
    completos.some(c => app.toLowerCase().indexOf(c) >= 0);
  const aviso = (frac, filas, fase) => onProg && onProg(frac, filas, fase);

  /**
   * El nombre agrupado, el MISMO que usa el modelo.
   *
   * Sin esto, «X - 1.2» y «X - 1.3» son dos aplicaciones distintas con una
   * version cada una, y entonces ninguna esta nunca por detras de si misma: no
   * se extraeria un solo nombre de equipo. Se cachea porque son decenas de
   * miles de nombres distintos y millones de filas.
   */
  const cacheGrupo = new Map();
  const grupo = a => {
    let x = cacheGrupo.get(a);
    if (x === undefined) cacheGrupo.set(a, x = (CFG.params.agrupaVersion === false ? a : baseApp(a)));
    return x;
  };

  /* Y la clave completa, por el mismo motivo: limpiar el fabricante y agrupar el
     nombre son media docena de expresiones regulares, y esto se llama una vez
     por INSTALACION -cuatro millones y medio-. Pares distintos hay unos miles. */
  const cacheClave = new Map();
  const claveDe = (v, a) => {
    const k = v + SEP1 + a;
    let x = cacheClave.get(k);
    if (x === undefined) cacheClave.set(k, x = claveApp(v, a));
    return x;
  };

  M.archivo = file;
  M.esParquet = true;       // con que lector se leyo, para poder repetirlo
  M.completo = completos.slice();

  const origen = bufferDe(file);
  let meta;
  try { meta = await HP.parquetMetadataAsync(origen); }
  catch (e) {
    throw new Error('No se pudo leer el Parquet: ' + e.message +
      '. Si lo generaste con otra herramienta, comprueba que use compresión ' +
      'snappy o ninguna: zstd y brotli no se leen aquí.');
  }
  const esquema = HP.parquetSchema(meta);
  const columnas = (esquema.children || []).map(c => c.element.name);

  const busca = nombres => {
    const N = columnas.map(norm);
    for (const nom of nombres) { const i = N.indexOf(norm(nom)); if (i >= 0) return columnas[i]; }
    for (const nom of nombres) {
      const k = norm(nom);
      if (k.length > 3) { const i = N.findIndex(x => x.includes(k)); if (i >= 0) return columnas[i]; }
    }
    return null;
  };
  const col = {
    dev: busca(['DeviceName', 'Device', 'Equipo', 'NombreEquipo', 'ManagedDeviceName']),
    app: busca(['ApplicationName', 'SoftwareName', 'DisplayName', 'Apps', 'Aplicacion']),
    ven: busca(['ApplicationPublisher', 'SoftwareVendor', 'Publisher', 'Fabricante']),
    ver: busca(['ApplicationVersion', 'SoftwareVersion', 'Installed Version', 'Version']),
    usr: busca(['UserName', 'UPN', 'EmailAddress', 'Last Signed-in User', 'Usuario']),
    os:  busca(['OSDescription', 'Platform', 'OS', 'OSDistribution']),
    osv: busca(['OSVersion', 'OSVersionInfo']),
    ts:  busca(['LastContact', 'Timestamp', 'Fecha'])
  };
  if (!col.app && !col.dev)
    throw new Error('El Parquet no trae ninguna columna útil. Columnas: ' +
      columnas.slice(0, 14).map(c => '«' + truncate(c, 28) + '»').join(' · '));

  const pedir = Array.from(new Set(Object.values(col).filter(Boolean)));
  const total = Number(meta.num_rows) || 0;
  const g = (o, c) => c && o[c] != null ? String(o[c]).trim() : '';

  // Se recorre por bloques: hyparquet devuelve filas materializadas, y con
  // millones de ellas hay que soltarlas segun se cuentan.
  const BLOQUE = 200000;
  async function recorrer(cb, base, peso) {
    let hechas = 0;
    for (let ini = 0; ini < total; ini += BLOQUE) {
      const fin = Math.min(total, ini + BLOQUE);
      await HP.parquetRead({
        file: origen, columns: pedir, rowStart: ini, rowEnd: fin, rowFormat: 'object',
        onComplete: filas => { for (const f of filas) cb(f); }
      });
      hechas = fin;
      aviso(base + (hechas / Math.max(1, total)) * peso, hechas, 'Leyendo el Parquet');
      await new Promise(r => setTimeout(r, 0));
    }
    return hechas;
  }

  /* ---- pasada 1 ---- */
  const cuenta = new Map(), alta = new Map(), fichas = new Map();
  // Todas las instalaciones, aparte del modelo: tres enteros por fila.
  const indice = Indice();
  const filas = await recorrer(o => {
    const dev = g(o, col.dev);
    if (dev && !fichas.has(dev))
      fichas.set(dev, [dev, g(o, col.usr), g(o, col.os), g(o, col.osv), g(o, col.ts)]);
    const app = g(o, col.app);
    if (!app) return;
    const ven = g(o, col.ven), ver = g(o, col.ver);
    // Toda instalacion entra en el indice, la vea el modelo o no: son tres
    // enteros, y es lo que permite decir despues en que equipos esta una
    // aplicacion sin volver a leer el archivo.
    if (dev) indice.add(dev, claveDe(ven, app), ver);
    const k = ven + SEP1 + app + SEP1 + ver;
    cuenta.set(k, (cuenta.get(k) || 0) + 1);
    const ka = ven + SEP1 + grupo(app);
    const prev = alta.get(ka);
    if (prev === undefined || (!VER_UNK.test(ver) && verCmp(ver, prev) > 0)) alta.set(ka, ver);
  }, 0, 0.5);

  /* ---- estandar, y despues quien va por detras ---- */
  aviso(0.52, filas, 'Construyendo el modelo');
  const nombre = truncate(file.name || 'parquet', 22);

  const parque = [['DeviceName', 'UserName', 'OSDistribution', 'OSVersionInfo', 'Timestamp']];
  fichas.forEach(v => parque.push(v));
  const todo = [['SoftwareVendor', 'SoftwareName', 'SoftwareVersion', 'Equipos']];
  cuenta.forEach((n, k) => { const p = k.split(SEP1); todo.push([p[0], p[1], p[2], String(n)]); });

  resetModel();
  if (parque.length > 1) addSource(parque, nombre + ' · parque', '', false);
  if (todo.length > 1) addSource(todo, nombre + ' · catálogo', '', false);
  M.aggFull = aggregate(M.rows);
  M.effVer = effVersions(M.rows);
  seedCatalog();

  const tope = new Map();
  alta.forEach((v, ka) => {
    const p = ka.split(SEP1);
    const r = CFG.apps[p[0] + ' / ' + p[1]];
    tope.set(ka, (r && r.rec) || v || '');
  });
  const atrasada = (ven, app, ver) => {
    if (esCompleto(app)) return true;
    const t = tope.get(ven + SEP1 + grupo(app)) || '';
    return !!(t && !VER_UNK.test(ver) && verCmp(ver, t) < 0);
  };

  const porApp = new Map();
  cuenta.forEach((n, k) => {
    const p = k.split(SEP1);
    if (!atrasada(p[0], p[1], p[2])) return;
    const ka = p[0] + SEP1 + grupo(p[1]);
    porApp.set(ka, (porApp.get(ka) || 0) + n);
  });
  const MAX = opts.maxExcep || TOPE_DETALLE;
  const orden = Array.from(porApp.entries()).sort((a, b) => b[1] - a[1]);
  const dentro = new Set();
  let acumulado = 0;
  const fuera = [];
  for (const [ka, n] of orden) {
    if (acumulado + n <= MAX) { dentro.add(ka); acumulado += n; }
    else fuera.push([ka.split(SEP1)[1], n]);
  }

  const catalogo = [['SoftwareVendor', 'SoftwareName', 'SoftwareVersion', 'Equipos']];
  cuenta.forEach((n, k) => {
    const p = k.split(SEP1);
    if (dentro.has(p[0] + SEP1 + p[1]) && atrasada(p[0], p[1], p[2])) return;
    catalogo.push([p[0], p[1], p[2], String(n)]);
  });

  /* ---- pasada 2 ---- */
  const excep = [['DeviceName', 'UserName', 'SoftwareVendor', 'SoftwareName',
                  'SoftwareVersion', 'Aprobada', 'OSVersionInfo']];
  await recorrer(o => {
    const dev = g(o, col.dev), app = g(o, col.app);
    if (!dev || !app) return;
    const ven = g(o, col.ven);
    if (!dentro.has(ven + SEP1 + grupo(app))) return;
    const ver = g(o, col.ver);
    if (!atrasada(ven, app, ver)) return;
    excep.push([dev, g(o, col.usr), ven, app, ver, tope.get(ven + SEP1 + grupo(app)) || '', g(o, col.osv)]);
  }, 0.52, 0.46);

  resetModel();
  if (parque.length > 1) addSource(parque, nombre + ' · parque', '', false);
  if (catalogo.length > 1) addSource(catalogo, nombre + ' · catálogo', '', false);
  if (excep.length > 1) addSource(excep, nombre + ' · atrasados', '', false);

  M.indice = indice;
  M.aggFull = aggregate(M.rows);
  M.effVer = effVersions(M.rows);
  seedCatalog();
  histSnapshot();
  aviso(1, filas, 'Listo');

  return { filas, equipos: fichas.size, versiones: cuenta.size,
           atrasados: excep.length - 1,
           fuera: fuera.length, fueraFilas: fuera.reduce((s, x) => s + x[1], 0),
           fueraApps: fuera.slice(0, 5).map(x => x[0]) };
}
