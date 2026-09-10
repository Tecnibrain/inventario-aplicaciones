/* ============================================================================
   17c. LO CARGADO SE QUEDA  ·  el inventario, guardado en el navegador
   ---------------------------------------------------------------------------
   Recorrer un Parquet de 300 MB tarda medio minuto, y el resultado es siempre
   el mismo. Volver a hacerlo cada vez que se abre la pagina no tiene sentido:
   al terminar se guarda el modelo YA MONTADO -las columnas de enteros y los
   diccionarios, tal cual estan en memoria- y la siguiente vez el tablero abre
   con los datos puestos, sin archivo y sin espera.

   Donde se guarda importa, y es la razon de que se haga asi:

     · En IndexedDB, que es del navegador y de ESTE equipo. No viaja a ningun
       servidor, no se sube a ningun sitio y no se publica con la pagina. El
       archivo index.html que esta en GitHub sigue sin contener un solo dato.
     · Se borra de un clic desde «Origen de datos», y tambien al quitar todos
       los archivos.

   Se escribe con el clonado estructurado, que es lo que IndexedDB usa por
   dentro: los Int32Array, los Map y las fechas se guardan tal cual. Pasarlo por
   JSON multiplicaria por cuatro el tamano y por mucho mas el tiempo, y ademas
   habria que volver a interpretarlo al abrir, que es justo lo que se quiere
   evitar.

   La ficha de que hay guardado va en una clave aparte: preguntar «¿que tienes?»
   no tiene por que arrastrar cincuenta megas.
   ========================================================================== */
const BD_NOMBRE = 'inventario-aplicaciones';
const BD_ALMACEN = 'modelo';
const BD_MODELO = 'ultimo';            // el paquete gordo
const BD_FICHA = 'ficha';              // solo el resumen de que hay

/* Lo que hay guardado ahora mismo, para poder pintarlo sin ir al disco cada vez
   que se redibuja la vista. null = no hay copia. */
let GUARDADO = null;

function abrirBD() {
  return new Promise((ok, mal) => {
    if (typeof indexedDB === 'undefined') return mal(new Error('este navegador no guarda datos'));
    let p;
    try { p = indexedDB.open(BD_NOMBRE, 1); } catch (e) { return mal(e); }
    p.onupgradeneeded = () => {
      const db = p.result;
      if (!db.objectStoreNames.contains(BD_ALMACEN)) db.createObjectStore(BD_ALMACEN);
    };
    p.onsuccess = () => ok(p.result);
    p.onerror = () => mal(p.error || new Error('no se pudo abrir el almacén'));
    p.onblocked = () => mal(new Error('hay otra pestaña con el inventario abierto'));
  });
}

/** Una transaccion, con la base cerrada al salir pase lo que pase. */
function operaBD(modo, fn) {
  return abrirBD().then(db => new Promise((ok, mal) => {
    let pet;
    try { pet = fn(db.transaction(BD_ALMACEN, modo).objectStore(BD_ALMACEN)); }
    catch (e) { db.close(); return mal(e); }
    pet.transaction.oncomplete = () => { db.close(); ok(pet.result); };
    pet.transaction.onerror = () => { db.close(); mal(pet.transaction.error); };
    pet.transaction.onabort = () => { db.close(); mal(pet.transaction.error || new Error('escritura cancelada')); };
  }));
}

/** Lo que hace falta para volver a montar el modelo, y nada mas. */
function paqueteModelo() {
  return {
    v: 1,
    guardado: new Date(),
    archivo: (M.archivo && M.archivo.name) || M.fileName || '',
    esParquet: !!M.esParquet,
    completo: M.completo || [],
    tabla: M.tabla.volcado(),
    // El indice va con la copia: sin el habria que releer el archivo entero
    // para volver a saber en que equipos esta cada aplicacion.
    indice: M.indice ? M.indice.volcado() : null,
    // El archivo original NO se guarda: son los mismos cientos de megas otra
    // vez, y para abrir el tablero no hace falta.
    fuentes: M.sources.map(s => ({
      name: s.name, sheet: s.sheet, shape: s.shape, cols: s.cols, headers: s.headers,
      truncado: s.truncado, filas: s.filas, equipos: s.equipos, idx: s.idx, devs: s.devs
    }))
  };
}

/** Guarda lo cargado. Si el navegador no deja, se dice y se sigue. */
async function guardarModelo() {
  if (!M.sources.length || !M.tabla || !M.tabla.length) return null;
  const p = paqueteModelo();
  const ficha = {
    archivo: p.archivo, guardado: p.guardado, filas: p.tabla.n,
    equipos: M.devInfo ? M.devInfo.size : 0,
    instalaciones: M.indice ? M.indice.length : 0,
    fuentes: p.fuentes.map(f => f.name),
    bytes: M.tabla.bytes() + (M.indice ? M.indice.bytes() : 0)
  };
  await operaBD('readwrite', st => { st.put(p, BD_MODELO); return st.put(ficha, BD_FICHA); });
  GUARDADO = ficha;
  return ficha;
}

/** Vuelve a montar lo guardado. Devuelve la ficha, o null si no hay nada. */
async function restaurarModelo() {
  const p = await operaBD('readonly', st => st.get(BD_MODELO));
  if (!p || !p.tabla || !p.fuentes || !p.fuentes.length) return null;
  // Una copia de un formato anterior no se intenta montar: se tira y se pide el
  // archivo, que es mucho mejor que enseñar numeros a medias.
  if (p.v !== 1) { await olvidarModelo(); return null; }
  M.tabla = Tabla(p.tabla);
  M.indice = p.indice ? Indice(p.indice) : null;
  M.sources = p.fuentes.map(s => Object.assign({}, s, { rows: Filas(M.tabla, s.idx) }));
  M.completo = p.completo || [];
  M.esParquet = !!p.esParquet;
  M.archivo = null;                    // el archivo no se guardo; se dice cual era
  M.archivoNombre = p.archivo || '';
  mergeSources();
  M.aggFull = aggregate(M.rows);
  M.effVer = effVersions(M.rows);
  GUARDADO = { archivo: p.archivo, guardado: p.guardado, filas: p.tabla.n,
               equipos: M.devInfo.size, fuentes: p.fuentes.map(f => f.name),
               instalaciones: M.indice ? M.indice.length : 0,
               bytes: M.tabla.bytes() + (M.indice ? M.indice.bytes() : 0) };
  return GUARDADO;
}

/** Que hay guardado, sin montarlo: esto lee unos cientos de bytes. */
async function infoGuardado() {
  try { return (await operaBD('readonly', st => st.get(BD_FICHA))) || null; }
  catch (e) { return null; }
}

/** Borra la copia. Lo que se cargo deja de estar en este equipo. */
async function olvidarModelo() {
  try {
    await operaBD('readwrite', st => { st.delete(BD_MODELO); return st.delete(BD_FICHA); });
    GUARDADO = null;
    return true;
  } catch (e) { return false; }
}

/**
 * Guarda sin hacer esperar a nadie ni romper nada si falla.
 *
 * Que no quepa en el disco, o que el navegador este en modo privado, no puede
 * tumbar una importacion que ya salio bien: se avisa y se sigue con los datos
 * en memoria, como se ha hecho siempre.
 */
function guardarModeloEnDiferido() {
  setTimeout(async () => {
    try {
      const f = await guardarModelo();
      if (f) toast('Guardado en este equipo: la próxima vez abre directo. ' +
                   'Se borra desde Origen de datos.');
    } catch (e) {
      console.warn('no se pudo guardar: ' + (e && e.message));
      toast('No se pudo guardar en el navegador (' + ((e && e.message) || 'sin espacio') +
            '). Los datos siguen cargados, pero habrá que volver a traer el archivo.');
    }
  }, 60);
}
