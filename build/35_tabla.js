
/* ============================================================================
   17b. ALMACEN COLUMNAR  ·  las filas como enteros, no como objetos
   ---------------------------------------------------------------------------
   Medido sobre 281.634 filas del inventario real: 638 bytes por fila como
   objetos, 71 como columnas. Nueve veces menos. Con un parque de cinco millones
   de instalaciones eso es la diferencia entre 3,2 GB -imposible- y unos 300 MB.

   La idea es la de cualquier base columnar: cada valor distinto se guarda UNA
   vez en un diccionario, y la fila pasa a ser un entero que apunta ahi. En este
   dato la ganancia es enorme porque son nombres repetidos hasta el infinito:
   26.864 equipos y 160 aplicaciones para 281.634 filas.

   Dos ventajas que no son de memoria y pesan casi tanto:

     · Agrupar por entero es mucho mas rapido que por cadena, y agregar era el
       99 % del coste de cada render.
     · Lo que solo depende del VALOR -si una version es desconocida, si un
       estado de soporte cuenta como vencido- se calcula una vez por valor
       distinto y no una vez por fila. De 281.634 comprobaciones a 229.

   Las columnas vacias no se reservan: en el export de Intune, geo, cliente,
   area y eos vienen sin nada, y son dieciseis bytes por fila que no se pagan.
   ========================================================================== */

/** Diccionario de valores: da un entero por valor, y el valor por su entero.
 *  Con una lista ya hecha se vuelve a montar sin recorrer ningun dato. */
function Interno(guardados) {
  const map = new Map();
  const vals = guardados || [];
  for (let k = 0; k < vals.length; k++) map.set(vals[k], k);
  return {
    vals,
    id(v) {
      const s = v == null ? '' : String(v);
      let k = map.get(s);
      if (k === undefined) { k = vals.length; vals.push(s); map.set(s, k); }
      return k;
    },
    val: k => vals[k] || '',
    /** El entero de un valor, o -1 si no esta. A diferencia de `id`, no lo crea. */
    idDe(v) { const k = map.get(v == null ? '' : String(v)); return k === undefined ? -1 : k; },
    get size() { return vals.length; }
  };
}

/** Columna de enteros que crece sola, doblando como cualquier array dinamico. */
function Columna(cap, datos, largo) {
  let a = datos || new Int32Array(cap || 4096);
  let n = largo || 0;
  return {
    push(v) {
      if (n === a.length) { const b = new Int32Array(a.length * 2); b.set(a); a = b; }
      a[n++] = v;
    },
    get(i) { return a[i]; },
    set(i, v) { a[i] = v; },
    get array() { return a; },
    get length() { return n; },
    get bytes() { return a.length * 4; }
  };
}

/**
 * Indice de instalaciones: quien tiene que, y en que version.
 *
 * Aparte del modelo y a proposito. El modelo solo lleva con nombre de equipo lo
 * que va por detras del estandar, porque agregar millones de filas en cada
 * dibujo es lo que vuelve lento un tablero. Pero responder «que equipos tienen
 * esta aplicacion» no necesita agregar nada: es recorrer una columna.
 *
 * Tres enteros por instalacion y ni un campo mas: 12 bytes por fila, unos 54 MB
 * para los cuatro millones y medio del parque real.
 */
function Indice(guardado) {
  let dDev = Interno(), dApp = Interno(), dVer = Interno();
  let cDev = Columna(), cApp = Columna(), cVer = Columna();
  let n = 0;
  if (guardado) {
    n = guardado.n;
    dDev = Interno(guardado.dev); dApp = Interno(guardado.app); dVer = Interno(guardado.ver);
    cDev = Columna(0, guardado.cDev, n);
    cApp = Columna(0, guardado.cApp, n);
    cVer = Columna(0, guardado.cVer, n);
  }
  return {
    get length() { return n; },
    add(dev, app, ver) {
      cDev.push(dDev.id(dev)); cApp.push(dApp.id(app)); cVer.push(dVer.id(ver)); n++;
    },

    /**
     * Los equipos que tienen una aplicacion, con la version mas alta de cada uno.
     *
     * Un recorrido de enteros comparando uno: con cuatro millones y medio de
     * filas son unos milisegundos, que para un clic no se nota.
     */
    equiposDe(app) {
      const ai = dApp.idDe(app);
      const salida = new Map();
      if (ai < 0) return salida;
      const aA = cApp.array, aD = cDev.array, aV = cVer.array;
      const vD = dDev.vals, vV = dVer.vals;
      for (let i = 0; i < n; i++) {
        if (aA[i] !== ai) continue;
        const d = vD[aD[i]];
        if (!d) continue;
        const v = vV[aV[i]] || '(sin versión)';
        const p = salida.get(d);
        if (p === undefined || (!VER_UNK.test(v) && verCmp(v, p) > 0)) salida.set(d, v);
      }
      return salida;
    },

    /** Si sabe algo de esta aplicacion. Barato: no recorre nada. */
    conoce(app) { return dApp.idDe(app) >= 0; },

    volcado() {
      return { n, dev: dDev.vals, app: dApp.vals, ver: dVer.vals,
               cDev: cDev.array.slice(0, n), cApp: cApp.array.slice(0, n), cVer: cVer.array.slice(0, n) };
    },
    bytes() {
      let b = cDev.bytes + cApp.bytes + cVer.bytes;
      for (const vals of [dDev.vals, dApp.vals, dVer.vals])
        for (const s of vals) b += s.length * 2 + 24;
      return b;
    }
  };
}

/* Los campos de texto que se guardan por diccionario. `appKey` va aparte
   porque es la clave por la que agrupa medio tablero, y como entero eso deja
   de costar. */
const CAMPOS_TXT = ['device', 'user', 'domain', 'vendor', 'app', 'appRaw', 'ver',
                    'os', 'osver', 'geo', 'cliente', 'area', 'eos', 'aprob',
                    'cpeRaw', 'salud', 'appKey', 'bucket'];

/* Lo que solo depende del VALOR vive aqui, en un sitio: lo usan tanto la
   lectura por fila como las tablas auxiliares que se pasan a los bucles. */
/* Lo que se ensena cuando un campo viene vacio. Vive aqui porque lo aplican
   tanto `fila()` como el filtro, y tienen que coincidir. */
const DEFECTO = { vendor: '(sin fabricante)', app: '(sin nombre)',
                  ver: '(sin versión)', osver: '(sin versión)' };

const ES_EOS  = s => /^(eos|endofsupport|fuera|expired|caducad|sin soporte|true|si|yes)/i.test(s);
const ES_CPE  = s => !!s && !/^(not available|n\/?a|none|null|-|sin dato)$/i.test(s);
const ES_VUNK = s => VER_UNK.test(s || '(sin versión)');

function Tabla(guardado) {
  const dic = {}, col = {};
  for (const c of CAMPOS_TXT) { dic[c] = Interno(); col[c] = null; }
  let w = Columna(), dia = Columna();
  let n = 0;

  // Volver a montar una tabla guardada no cuesta nada: los enteros ya estan
  // calculados y las columnas son los mismos arrays que se escribieron.
  if (guardado) {
    n = guardado.n;
    for (const c of CAMPOS_TXT) {
      const g = guardado.campos[c];
      if (!g) continue;
      dic[c] = Interno(g.vals);
      col[c] = Columna(0, g.a, n);
    }
    w = Columna(0, guardado.w, n);
    dia = Columna(0, guardado.dia, n);
  }

  // Lo que solo depende del valor se resuelve una vez por valor distinto, no
  // por fila. Se cachea junto al diccionario.
  const derivados = {};

  const T = {
    dic, get length() { return n; },

    /** Anade una fila. Las columnas que nunca traen nada no se crean. */
    add(o) {
      for (const c of CAMPOS_TXT) {
        const v = o[c];
        if (v == null || v === '') { if (col[c]) col[c].push(0); continue; }
        if (!col[c]) {
          // primera vez que este campo trae algo: se crea con ceros detras
          col[c] = Columna(Math.max(4096, n + 1));
          dic[c].id('');                       // el 0 es siempre la cadena vacia
          for (let i = 0; i < n; i++) col[c].push(0);
        }
        col[c].push(dic[c].id(v));
      }
      // Un peso que no sea un numero positivo cuenta como uno. Antes cada
      // lector lo arreglaba por su cuenta con `r.w || 1`; asi lo hace la tabla
      // una vez y todos leen lo mismo.
      w.push(o.w > 0 ? o.w : 1);
      dia.push(o.ts instanceof Date && !isNaN(o.ts) ? Math.floor(o.ts.getTime() / DAY_MS) : -1);
      return n++;                          // el indice de la fila recien anadida
    },

    txt(campo, i) { const c = col[campo]; return c ? dic[campo].val(c.get(i)) : ''; },
    get pesos() { return w.array; },
    get dias() { return dia.array; },

    /**
     * Un lector de un solo campo, para sacarlo FUERA del bucle.
     *
     * Dentro de un recorrido de millones de vueltas, resolver col[campo] y
     * dic[campo] en cada una cuesta mas que la lectura misma. Asi se resuelven
     * una vez y queda una funcion que solo indexa dos arrays.
     */
    acceso(campo) {
      const c = col[campo];
      if (!c) return () => '';
      const vals = dic[campo].vals;
      return i => vals[c.get(i)] || '';
    },
    /**
     * El array de la columna y la lista de valores, sin envoltorio.
     *
     * `acceso()` devuelve una funcion, y una llamada por campo y por fila son
     * decenas de millones en un inventario grande. Con esto el bucle indexa dos
     * arrays y no llama a nada.
     */
    crudo(campo) {
      const c = col[campo];
      return { a: c ? c.array : null, vals: dic[campo].vals };
    },

    /** Igual, pero devuelve el entero: para agrupar sin tocar cadenas. */
    accesoId(campo) {
      const c = col[campo];
      return c ? (i => c.get(i)) : (() => 0);
    },
    /** La etiqueta del dia, cacheada: son unos cientos de valores distintos. */
    diaTxt: (() => {
      const cache = new Map();
      return i => {
        const d = dia.get(i);
        if (d < 0) return '';
        let s = cache.get(d);
        if (s === undefined) cache.set(d, s = dayKey(new Date(d * DAY_MS)));
        return s;
      };
    })(),
    idDe(campo, i) { const c = col[campo]; return c ? c.get(i) : 0; },
    tiene: campo => !!col[campo],
    peso: i => w.get(i),
    fecha(i) { const d = dia.get(i); return d < 0 ? null : new Date(d * DAY_MS); },
    diaDe: i => dia.get(i),

    /** Reescribe una columna entera: lo usa el relleno de fabricante. */
    poner(campo, i, valor) {
      if (!col[campo]) { col[campo] = Columna(Math.max(4096, n)); dic[campo].id(''); for (let k = 0; k < n; k++) col[campo].push(0); }
      col[campo].set(i, dic[campo].id(valor));
    },

    /**
     * El entero de un valor, para poder escribir una columna entera sin pasar
     * por el diccionario en cada fila. Crea la columna si aun no existe.
     */
    idPara(campo, valor) {
      if (!col[campo]) { col[campo] = Columna(Math.max(4096, n)); dic[campo].id(''); for (let k = 0; k < n; k++) col[campo].push(0); }
      return dic[campo].id(valor);
    },

    ponerFecha(i, fecha) {
      dia.set(i, fecha instanceof Date && !isNaN(fecha) ? Math.floor(fecha.getTime() / DAY_MS) : -1);
    },

    /* ---- lo precalculado por valor distinto ---- */

    /**
     * Una tabla auxiliar indexada por el entero del diccionario.
     *
     * Se calcula una vez por valor DISTINTO -229 veces en este inventario, no
     * 281.634- y leerla despues es indexar un array. Eso es lo que permite
     * sacar del bucle caliente todo lo que solo depende del valor. Se amplia
     * sola si llegan valores nuevos mas tarde.
     */
    derivado(campo, fn) {
      let t = derivados[campo];
      // El 0 es siempre la cadena vacia, tambien en una columna que nunca
      // llego a crearse: asi quien lea t[0] no se encuentra un hueco.
      if (!t) { t = derivados[campo] = []; t[0] = fn(''); }
      const vals = dic[campo].vals;
      for (let k = t.length; k < vals.length; k++) t[k] = fn(vals[k]);
      return t;
    },

    verUnk(i) { return T.derivado('ver', ES_VUNK)[col.ver ? col.ver.get(i) : 0]; },
    eosBad(i) { return T.derivado('eos', ES_EOS)[col.eos ? col.eos.get(i) : 0]; },
    cpe(i)    { return T.derivado('cpeRaw', ES_CPE)[col.cpeRaw ? col.cpeRaw.get(i) : 0]; },

    /** Materializa la fila i como el objeto que las vistas esperan. */
    fila(i) {
      const o = { _i: i, w: w.get(i) };
      for (const c of CAMPOS_TXT) o[c] = T.txt(c, i);
      for (const c in DEFECTO) if (!o[c]) o[c] = DEFECTO[c];
      o.cpe = T.cpe(i);
      o.eosBad = T.eosBad(i);
      o.ts = T.fecha(i);
      o.day = o.ts ? dayKey(o.ts) : '';
      return o;
    },

    /**
     * Todo lo que hace falta para volver a montarla igual.
     *
     * Son arrays de enteros y listas de cadenas, que es lo que el navegador
     * sabe guardar tal cual. Pasarlo por JSON multiplicaria por cuatro el
     * tamano y por mucho mas el tiempo, y no haria falta para nada.
     */
    volcado() {
      const campos = {};
      for (const c of CAMPOS_TXT)
        if (col[c]) campos[c] = { vals: dic[c].vals, a: col[c].array.slice(0, n) };
      return { n, campos, w: w.array.slice(0, n), dia: dia.array.slice(0, n) };
    },

    /** Cuanto ocupa, para poder decirlo sin estimar. */
    bytes() {
      let b = (w.bytes + dia.bytes);
      for (const c of CAMPOS_TXT) {
        if (col[c]) b += col[c].bytes;
        for (const s of dic[c].vals) b += 40 + s.length * 2;
      }
      return b;
    }
  };
  return T;
}

/**
 * Un conjunto de filas: la tabla mas, opcionalmente, que indices.
 *
 * Se comporta como el array de objetos que habia antes -length, recorrido,
 * filter, map, some, find- para que las vistas no se enteren del cambio. La
 * diferencia esta en filter: en vez de copiar objetos devuelve otra vista con
 * una lista de indices, que son cuatro bytes por fila en lugar de seiscientos.
 */
function Filas(tabla, idx) {
  return {
    tabla, idx,
    get length() { return idx ? idx.length : tabla.length; },
    en(k) { return tabla.fila(idx ? idx[k] : k); },
    fisico(k) { return idx ? idx[k] : k; },

    [Symbol.iterator]() {
      const n = idx ? idx.length : tabla.length;
      let k = 0;
      return { next: () => k < n ? { value: tabla.fila(idx ? idx[k++] : k++), done: false }
                                  : { value: undefined, done: true } };
    },

    filter(fn) {
      const n = idx ? idx.length : tabla.length;
      const out = [];
      for (let k = 0; k < n; k++) {
        const i = idx ? idx[k] : k;
        if (fn(tabla.fila(i), k)) out.push(i);
      }
      return Filas(tabla, Int32Array.from(out));
    },
    map(fn) {
      const n = idx ? idx.length : tabla.length;
      const out = new Array(n);
      for (let k = 0; k < n; k++) out[k] = fn(tabla.fila(idx ? idx[k] : k), k);
      return out;
    },
    some(fn) {
      const n = idx ? idx.length : tabla.length;
      for (let k = 0; k < n; k++) if (fn(tabla.fila(idx ? idx[k] : k), k)) return true;
      return false;
    },
    find(fn) {
      const n = idx ? idx.length : tabla.length;
      for (let k = 0; k < n; k++) { const o = tabla.fila(idx ? idx[k] : k); if (fn(o, k)) return o; }
      return undefined;
    },
    /** Recorre dando el indice fisico: para los bucles que leen columnas. */
    cada(fn) {
      const n = idx ? idx.length : tabla.length;
      for (let k = 0; k < n; k++) fn(idx ? idx[k] : k, k);
    },
    forEach(fn) {
      const n = idx ? idx.length : tabla.length;
      for (let k = 0; k < n; k++) fn(tabla.fila(idx ? idx[k] : k), k);
    },
    slice(a, b) {
      const n = idx ? idx.length : tabla.length;
      const ini = a == null ? 0 : (a < 0 ? Math.max(0, n + a) : Math.min(a, n));
      const fin = b == null ? n : (b < 0 ? Math.max(0, n + b) : Math.min(b, n));
      const out = new Int32Array(Math.max(0, fin - ini));
      for (let k = ini; k < fin; k++) out[k - ini] = idx ? idx[k] : k;
      return Filas(tabla, out);
    }
  };
}
