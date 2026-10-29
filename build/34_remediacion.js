
/* ============================================================================
   6b. REMEDIACIONES  ·  el export del portal, tal cual
   ---------------------------------------------------------------------------
   Intune guarda lo que el script de deteccion escribe por pantalla y lo deja
   exportar como CSV. Ese CSV no se parece a un inventario: trae una fila por
   equipo y, dentro de una columna, una cadena con todo apelmazado.

   Aqui se desdobla al vuelo, en el navegador, antes de que el modelo lo mire.
   Hay un `3-convertir.ps1` que hace lo mismo desde PowerShell y sigue siendo
   util -para dejar el archivo preparado, o para cruzarlo con otra cosa- pero
   no deberia hacer falta para la carga normal: arrastrar el archivo que te
   acabas de bajar es el camino corto, y el corto es el que se usa.

   Lo que entra en el modelo son nombres FIJOS, no uno por KB. Si cada numero
   de KB fuera una aplicacion distinta, el catalogo se llenaria de cientos de
   lineas que no son programas y dejaria de poder navegarse.
   ========================================================================== */

/* Los nombres con los que viaja cada dato. El tablero solo entiende
   «una aplicacion instalada en un equipo», asi que el nivel de parche entra
   disfrazado de eso: el nombre dice que es y la version lleva el dato. */
const REM_NOM = {
  kb:    'Parche de Windows',
  fecha: 'Parche instalado',
  prev:  'Parche anterior',
  upg:   'Upgrade de Windows',
  inst:  'Windows instalado',
  antes: 'Windows anterior',
  comp:  'Compilación de Windows'
};

/* El camino de vuelta, para la vista de Parches: de cada nombre, al campo.
   Las claves van normalizadas -sin acentos ni espacios- porque el mismo dato
   puede llegar escrito por aqui o por `3-convertir.ps1`, que es ASCII puro y
   escribe «Compilacion» sin tilde. «Parche anterior» no esta: trae varios
   valores por equipo y su sitio es la busqueda, no una columna. */
const PAR_MARCAS = {
  parchedewindows: 'kb',
  parcheinstalado: 'fecha',
  upgradedewindows: 'upg',
  windowsinstalado: 'inst',
  windowsanterior: 'antes',
  compilaciondewindows: 'soloComp'
};

const REM_MS = 'Microsoft Corporation';
const REM_CAB = ['DeviceName', 'SoftwareVendor', 'SoftwareName', 'SoftwareVersion',
                 'UserName', 'LastContact', 'OSVersion'];

/**
 * Las columnas que hacen falta, o null si esto no es un export de remediacion.
 *
 * Dos trampas de la cabecera real, y las dos dan cero equipos sin un solo
 * error: junto a PreRemediationDetectionScriptOutput viaja
 * PreRemediationDetectionScriptError, que va ANTES y contiene el mismo texto
 * en el nombre; y «Last run message» contiene «lastrun» y es un texto, no una
 * fecha. Por eso aqui se mira el nombre exacto primero.
 */
function remColumnas(headers) {
  const H = headers.map((h, i) => ({ i, n: norm(h) }));
  const uno = (exactas, contiene, excluye) => {
    for (const e of exactas) { const h = H.find(x => x.n === e); if (h) return h.i; }
    for (const c of contiene) {
      const h = H.find(x => x.n.includes(c) && !(excluye || []).some(m => x.n.includes(m)));
      if (h) return h.i;
    }
    return -1;
  };
  // Los patrones anchos -«output», «salida»- no son un riesgo: si la columna
  // elegida no fuera la buena, ninguna fila parsearia, esto devolveria null y
  // el archivo seguiria por el camino de siempre.
  const sal = uno(['preremediationdetectionscriptoutput', 'predetectionscriptoutput'],
                  ['preremediationdetection', 'detectionscriptoutput', 'detectionoutput',
                   'preremediation', 'salidadedeteccion', 'deteccionprevia', 'output', 'salida'],
                  ['error']);
  if (sal < 0) return null;
  const dev = uno(['devicename', 'nombrededispositivo', 'nombredispositivo', 'equipo'],
                  ['devicename', 'nombredispositivo', 'dispositivo', 'equipo', 'hostname'], ['id']);
  if (dev < 0) return null;
  return {
    sal, dev,
    usr:   uno(['username', 'upn', 'useremail', 'usuario'], ['username', 'upn', 'usuario'], ['id']),
    fecha: uno(['modifiedtime', 'lastsynctime', 'lastruntime'],
               ['lastrun', 'lastsync', 'modified', 'ejecucion', 'sincronizacion',
                'date', 'fecha', 'time', 'hora'],
               ['message', 'mensaje', 'error', 'next', 'proxima', 'agent']),
    os:    uno(['osversion'], ['osversion'], [])
  };
}

/**
 * Una linea legible de nivel de parche:
 *
 *   Win 24H2 build 26100.6899 | Upgrade: SI el 2026-03-10 (desde 23H2 build
 *   22631.4890) | Ultimos KB: KB5066835 2026-10-14; KB5065426 2026-09-10
 *
 * Cada dato se saca por su forma y no por su posicion: un KB parece un KB y
 * una fecha parece una fecha. Asi la linea puede cambiar de redaccion -o de
 * idioma- y esto sigue leyendola, que es lo que acaba pasando cuando el script
 * lo retoca otra persona y nadie avisa.
 */
function remParseWin(linea) {
  if (!linea) return null;
  const r = { comp: '', upg: '', inst: '', antes: '', kbs: [] };

  // la compilacion con su UBR: los ultimos digitos son el parche del mes
  let m = /\bbuild\s+(\d{4,6})\.(\d+)/i.exec(linea) || /\b(\d{5,6})\.(\d{1,5})\b/.exec(linea);
  if (m) r.comp = '10.0.' + m[1] + '.' + m[2];

  // upgrade de version. La fecha del tramo es la misma cosa en los dos casos
  // -el dia en que entro el Windows que hay puesto- se escriba «upgrade el
  // 2026-03-10» o «instalacion limpia 2026-07-28», asi que sale a su propio
  // campo. Se busca dentro del tramo -de ahi el [^|]- para no coger la de un KB.
  m = /upgrade[^a-z0-9]{0,4}([a-z]+)/i.exec(linea);
  if (m) {
    const t = m[1].toLowerCase();
    if (t[0] === 's' || t[0] === 'y') {
      r.upg = 'Si';
      const d = /\b(?:desde|from)\s+([^)|;]+)/i.exec(linea);
      if (d) r.antes = d[1].trim().replace(/\s+build\s+/i, ' ');
    } else if (t[0] === 'n') {
      r.upg = 'No';
    }
    const f = /upgrade[^|]*?(\d{4}-\d{2}-\d{2})/i.exec(linea);
    if (f) r.inst = f[1];
  }

  // los KB, con la fecha que venga pegada detras
  const vistos = {};
  const re = /\b(KB\d{5,})\b(?:\s*[(\[]?\s*(\d{4}-\d{2}-\d{2}))?/gi;
  let k;
  while ((k = re.exec(linea))) {
    const kb = k[1].toUpperCase();
    if (vistos[kb]) continue;
    vistos[kb] = 1;
    r.kbs.push({ kb, fecha: k[2] || '' });
  }
  // El script suele mandarlos del mas nuevo al mas viejo, pero eso es una
  // costumbre suya y no una garantia. Si todos traen fecha se reordena por
  // fecha, que es el unico criterio que no miente: en un export real de 681
  // equipos, en 320 de las 618 lineas con varios KB el numero mas alto NO era
  // el mas reciente. Ordenar por numero es acertar a cara o cruz.
  if (r.kbs.length > 1 && r.kbs.every(x => x.fecha))
    r.kbs.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

  if (!r.comp && !r.kbs.length && !r.upg) return null;
  return r;
}

/** La carga de `2-deteccion.ps1`: LB1;23;Netskope=132.0~Webex=46.5 */
function remParseLb1(carga) {
  const t = carga.split(';');
  if (t.length < 3) return null;
  let cuerpo = t[2];
  const cortado = cuerpo.indexOf('+CORTADO') >= 0;
  if (cortado) cuerpo = cuerpo.replace('~+CORTADO', '');
  const out = [];
  for (const par of cuerpo.split('~')) {
    const i = par.indexOf('=');
    if (i <= 0) continue;
    out.push([par.slice(0, i), par.slice(i + 1)]);
  }
  return out.length ? { pares: out, cortado } : null;
}

/**
 * El export entero, desdoblado: una fila por dato.
 *
 * Devuelve null si el archivo no es una remediacion, y entonces sigue el
 * camino de siempre.
 */
function expandeRemediacion(grid) {
  if (!grid || grid.length < 2) return null;
  const c = remColumnas((grid[0] || []).map(h => String(h == null ? '' : h)));
  if (!c) return null;

  // Un equipo puede venir varias veces si la remediacion lleva dias corriendo.
  // Se queda la ejecucion mas reciente; a falta de fecha, la ultima del archivo.
  const ultima = new Map();
  let cortados = 0;
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r) continue;
    const dev = String(r[c.dev] == null ? '' : r[c.dev]).trim();
    const carga = String(r[c.sal] == null ? '' : r[c.sal]).trim();
    if (!dev || !carga) continue;

    let tipo = '', win = null, lb = null;
    if (carga.slice(0, 4) === 'LB1;') { lb = remParseLb1(carga); if (lb) tipo = 'LB1'; }
    else { win = remParseWin(carga); if (win) tipo = 'WIN'; }
    if (!tipo) continue;
    if (lb && lb.cortado) cortados++;

    const cruda = c.fecha >= 0 ? r[c.fecha] : '';
    const fecha = parseDate(cruda);
    const prev = ultima.get(dev);
    if (prev) {
      if (fecha && prev.fecha && fecha <= prev.fecha) continue;
      if (!fecha && prev.fecha) continue;
    }
    ultima.set(dev, {
      tipo, win, lb, fecha, cruda: cruda == null ? '' : cruda,
      usr: c.usr >= 0 ? String(r[c.usr] == null ? '' : r[c.usr]).trim() : '',
      os:  c.os  >= 0 ? String(r[c.os]  == null ? '' : r[c.os]).trim()  : ''
    });
  }
  if (!ultima.size) return null;

  const out = [REM_CAB.slice()];
  ultima.forEach((d, dev) => {
    // La compilacion no va como fila: va en su columna, la misma que trae el
    // inventario de Intune. Asi el apartado Parches funciona aunque este
    // archivo sea lo unico que se haya cargado.
    const comp = (d.win && d.win.comp) || d.os || '';
    // Todo lo que planta la remediacion de parches es de Microsoft, y decirlo
    // hace que estas filas se fundan con las de Intune en vez de quedar como
    // aplicaciones de nadie.
    const pon = (nombre, valor) => {
      if (valor) out.push([dev, REM_MS, nombre, valor, d.usr, d.cruda, comp]);
    };

    if (d.tipo === 'WIN') {
      const w = d.win;
      if (w.kbs.length) {
        pon(REM_NOM.kb, w.kbs[0].kb);
        pon(REM_NOM.fecha, w.kbs[0].fecha);
        // Los demas, todos bajo el mismo nombre y con el KB y su dia en la
        // version: se buscan y se agrupan sin inflar el catalogo.
        for (let k = 1; k < w.kbs.length; k++) {
          pon(REM_NOM.prev, w.kbs[k].kb + (w.kbs[k].fecha ? ' (' + w.kbs[k].fecha + ')' : ''));
        }
      }
      pon(REM_NOM.upg, w.upg);
      pon(REM_NOM.inst, w.inst);
      pon(REM_NOM.antes, w.antes);
      // Un equipo que solo reporta compilacion tambien cuenta: sin una fila no
      // entra en el tablero y se perderia su nivel de parche.
      if (!w.kbs.length && !w.upg && !w.antes && comp) pon(REM_NOM.comp, comp);
      return;
    }

    // linea base por ruta: el fabricante no viaja por el canal estrecho de la
    // remediacion. Se queda vacio y el tablero lo rellena por mayoria si esa
    // misma aplicacion llega con fabricante desde el inventario.
    for (const [id, ver] of d.lb.pares) out.push([dev, '', id, ver, d.usr, d.cruda, '']);
  });

  if (out.length < 2) return null;
  return { grid: out, equipos: ultima.size, filas: out.length - 1, cortados };
}
