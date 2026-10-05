
/* ============================================================================
   23. CONSULTA LIBRE  ·  preguntar cualquier cosa, y llevarsela
   ---------------------------------------------------------------------------
   El resto del tablero responde preguntas que alguien decidio de antemano:
   cuantas aplicaciones, que equipos van atrasados, como va el cumplimiento.
   Sirven hasta que alguien pregunta otra cosa -«dame los equipos de Medellin
   con Chrome por debajo de la 140, con su usuario»- y entonces hay que salir a
   pedirla. Esta pantalla quita ese paso: eliges por que agrupar y que medir, y
   sale la tabla.

   Agrupar cuatro millones y medio de filas dentro del navegador se puede
   porque la tabla ya guarda cada valor como un entero. Agrupar es entonces
   leer arrays de enteros y componer una clave numerica; no se toca una sola
   cadena hasta el final, cuando ya solo quedan las filas del resultado.
   ========================================================================== */

/* Lo elegido. No se guarda entre sesiones a proposito: una consulta es una
   pregunta de ahora, no una configuracion. */
const CONS = { dims: ['appKey'], meds: ['equipos', 'inst'], res: null, firma: '' };

/* Por encima de esto la respuesta deja de ser una respuesta: son datos en
   crudo, y para eso esta la exportacion del archivo entero. Excel ademas se
   planta en 1.048.576 filas. */
const CONS_TOPE = 500000;
/* Contar valores distintos necesita un conjunto por grupo. Con pocos grupos no
   cuesta nada; con cientos de miles es memoria que no hay motivo para gastar. */
const CONS_TOPE_DIST = 60000;

/* ---------------------------------------------------------------------------
   Las dimensiones
   ---------------------------------------------------------------------------
   `campo`     columna de la tabla; se agrupa por su entero, sin mas.
   `porValor`  la etiqueta no es el valor guardado sino algo derivado de el.
               Se recalcula en cada consulta a proposito: la categoria y la
               administracion salen del estandar, y el estandar cambia.
   `et`        como se escribe al final, ya sobre las filas del resultado.
   ------------------------------------------------------------------------- */
const DIM_CONS = {
  appKey:  { l: 'Aplicación',   g: 'Aplicación', campo: 'appKey', et: k => appLabel(k) },
  app:     { l: 'Nombre del programa', g: 'Aplicación', campo: 'app', et: v => pretty(v) },
  vendor:  { l: 'Fabricante',   g: 'Aplicación', campo: 'vendor', et: v => pretty(v) },
  ver:     { l: 'Versión',      g: 'Aplicación', campo: 'ver' },
  cat:     { l: 'Categoría',    g: 'Aplicación', campo: 'appKey',
             porValor: v => v.map(k => (rule(k) || {}).cat || 'Otro') },
  gestK:   { l: 'Administración', g: 'Aplicación', campo: 'appKey',
             porValor: v => v.map(k => (rule(k) || {}).gest ? 'Administrada' : 'No administrada') },
  baseK:   { l: 'En la línea base', g: 'Aplicación', campo: 'appKey',
             porValor: v => { const s = clavesBase(); return v.map(k => s.has(k) ? 'Sí' : 'No'); } },

  device:  { l: 'Equipo',       g: 'Equipo', campo: 'device' },
  user:    { l: 'Usuario',      g: 'Equipo', campo: 'user' },
  os:      { l: 'Sistema operativo', g: 'Equipo', campo: 'os' },
  soRel:   { l: 'Versión de Windows', g: 'Equipo', campo: 'osver',
             porValor: v => v.map(soRelease) },
  osver:   { l: 'Compilación de Windows', g: 'Equipo', campo: 'osver' },
  domain:  { l: 'Dominio',      g: 'Equipo', campo: 'domain' },

  geo:     { l: 'Ubicación',    g: 'Organización', campo: 'geo' },
  cliente: { l: 'Cliente',      g: 'Organización', campo: 'cliente' },
  area:    { l: 'Área',         g: 'Organización', campo: 'area' },

  cumpl:   { l: 'Cumplimiento', g: 'Estado', estado: true },
  eos:     { l: 'Fin de soporte', g: 'Estado', campo: 'eos' },
  day:     { l: 'Fecha del dato', g: 'Estado', fecha: true },
  // La mas aburrida y la que mas malentendidos evita: ver 3,9 millones de
  // instalaciones junto a «1 equipo» parece una averia hasta que se sabe que
  // esas filas vienen del catalogo, que cuenta sin decir de quien.
  fuente:  { l: 'Fuente del dato', g: 'Estado', fuente: true }
};

const MED_CONS = {
  inst:    { l: 'Instalaciones', d: 'Filas del inventario, sumando el peso de las que vienen agregadas' },
  equipos: { l: 'Equipos',       d: 'Equipos distintos', dist: 'device' },
  apps:    { l: 'Aplicaciones',  d: 'Aplicaciones distintas', dist: 'appKey' },
  vers:    { l: 'Versiones',     d: 'Versiones distintas', dist: 'ver' },
  ok:      { l: 'Cumplen',       d: 'En la versión aprobada' },
  warn:    { l: 'Requieren atención', d: 'Por encima del mínimo pero por debajo de la aprobada' },
  bad:     { l: 'No cumplen',    d: 'Por debajo del mínimo' },
  na:      { l: 'Sin estándar',  d: 'Aplicaciones que no puntúan' },
  pctOk:   { l: '% al día',      d: 'Cumplen sobre lo que puntúa', pct: true }
};

/* Puntos de partida. Una pantalla en blanco con veinte casillas no invita a
   nada; estas cuatro ensenan de que va y se editan encima. */
const CONS_EJEMPLOS = [
  { l: 'Equipos por aplicación y versión', dims: ['appKey', 'ver'], meds: ['equipos', 'inst'] },
  { l: 'Qué tiene cada equipo',            dims: ['device', 'appKey', 'ver'], meds: ['inst'] },
  { l: 'Cumplimiento por área',            dims: ['area'], meds: ['equipos', 'ok', 'bad', 'pctOk'] },
  { l: 'Versiones de Windows del parque',  dims: ['soRel'], meds: ['equipos', 'apps'] }
];

/* ---------------------------------------------------------------------------
   El lector de una dimension
   ---------------------------------------------------------------------------
   Devuelve siempre lo mismo -un array de enteros por fila y la lista de
   etiquetas- venga de donde venga el dato. Asi el bucle de agrupacion no sabe
   ni le importa si la dimension es una columna, algo derivado o el estado de
   cumplimiento.
   ------------------------------------------------------------------------- */
/**
 * Si esa pregunta se puede hacer con lo que hay cargado.
 *
 * Ni Intune ni Defender traen las mismas columnas, y de un mismo informe de
 * Intune faltan la mitad: area, cliente, ubicacion y dominio no vienen. Sin
 * esto, agrupar por «Area» daria una sola fila con la etiqueta en blanco, que
 * parece una averia del tablero cuando es que el dato no existe.
 */
function dimDisponible(T, d) {
  const D = DIM_CONS[d];
  if (!D) return false;
  if (D.estado) return true;
  if (D.fuente) return !!(M.sources && M.sources.length > 1);
  if (D.fecha) { const a = T.dias; for (let i = 0; i < T.length; i++) if (a[i] >= 0) return true; return false; }
  return T.tiene(D.campo);
}

function lectorDim(T, d) {
  const D = DIM_CONS[d];
  if (!D) return null;

  if (D.estado) {
    // el estado ya es un entero por fila: es justo lo que hace falta
    const a = CMP.rowState.length >= T.length ? CMP.rowState : new Uint8Array(T.length);
    return { k: d, l: D.l, a, mapa: null, vals: CONS_EST, n: CONS_EST.length, et: null };
  }

  if (D.fuente) {
    // Que fila vino de donde. El modelo funde varias fuentes en una sola tabla
    // y no todas cuentan lo mismo: el detalle trae una fila por instalacion con
    // su equipo, el catalogo trae una por aplicacion con el recuento dentro.
    // Sumarlas juntas no esta mal; verlas sin poder separarlas, si.
    const n = T.length;
    const a = new Int32Array(n);
    const vals = ['(sin fuente)'];
    (M.sources || []).forEach((s, j) => {
      vals.push(s.name || ('fuente ' + (j + 1)));
      const si = s.rows.idx, m = s.rows.length;
      for (let k = 0; k < m; k++) a[si ? si[k] : k] = j + 1;
    });
    return { k: d, l: D.l, a, mapa: null, vals, n: vals.length, et: null };
  }

  if (D.fecha) {
    // los dias son numeros sueltos y hay unos pocos cientos distintos: se
    // reindexan a 0..n para que la clave numerica no se dispare
    const dias = T.dias, n = T.length;
    const a = new Int32Array(n);
    const vistos = new Map(), vals = ['(sin fecha)'];
    for (let i = 0; i < n; i++) {
      const v = dias[i];
      if (v < 0) { a[i] = 0; continue; }
      let g = vistos.get(v);
      if (g === undefined) { g = vals.length; vals.push(dayKey(new Date(v * DAY_MS))); vistos.set(v, g); }
      a[i] = g;
    }
    return { k: d, l: D.l, a, mapa: null, vals, n: vals.length, et: null };
  }

  const c = T.crudo(D.campo);
  if (!c.a) return { k: d, l: D.l, a: null, mapa: null, vals: [''], n: 1, et: D.et };

  if (D.porValor) {
    // Las etiquetas derivadas se colapsan: de doscientas compilaciones de
    // Windows salen once versiones, y agrupar por once en vez de por
    // doscientas es lo que hace que la tabla sea legible.
    const der = D.porValor(c.vals);
    const mapa = new Int32Array(der.length);
    const vistos = new Map(), vals = [];
    for (let i = 0; i < der.length; i++) {
      const s = der[i] == null ? '' : String(der[i]);
      let g = vistos.get(s);
      if (g === undefined) { g = vals.length; vals.push(s); vistos.set(s, g); }
      mapa[i] = g;
    }
    return { k: d, l: D.l, a: c.a, mapa, vals, n: vals.length, et: null };
  }

  return { k: d, l: D.l, a: c.a, mapa: null, vals: c.vals, n: c.vals.length,
           et: D.et, vacio: DEFECTO[D.campo] || '(vacío)' };
}

/* ---------------------------------------------------------------------------
   La consulta
   ------------------------------------------------------------------------- */
function calculaConsulta(rows) {
  const t0 = performance.now();
  const T = M.tabla;
  const lect = (CONS.dims.length ? CONS.dims : ['appKey']).map(d => lectorDim(T, d)).filter(Boolean);
  if (!lect.length) return null;

  const meds = CONS.meds.length ? CONS.meds : ['inst'];
  // «% al día» se calcula al final, pero necesita los tres estados contados
  const quiereEstado = meds.some(m => m === 'ok' || m === 'warn' || m === 'bad' || m === 'na' || m === 'pctOk');
  const distintos = meds.map(m => MED_CONS[m] && MED_CONS[m].dist).filter(Boolean);

  // Lectores de lo que se cuenta como distinto. Si se agrupa por esa misma
  // dimension la respuesta es 1 sin contar nada, y se ahorra el conjunto.
  const dims0 = CONS.dims.length ? CONS.dims : ['appKey'];
  const dist = distintos.map(campo => {
    const j = dims0.indexOf(campo);
    if (j >= 0) return { campo, trivial: true, j };
    const c = T.crudo(campo);
    return { campo, trivial: false, a: c.a };
  });

  const nd = lect.length;
  const card = lect.map(l => Math.max(1, l.n));
  let prod = 1, empaqueta = true;
  for (let j = 0; j < nd; j++) {
    prod *= card[j];
    // por encima del entero exacto de un double la clave dejaria de ser unica
    if (prod > 9007199254740991) { empaqueta = false; break; }
  }

  const pesos = T.pesos;
  const est = quiereEstado
    ? (CMP.rowState.length >= T.length ? CMP.rowState : new Uint8Array(T.length))
    : null;

  const grupos = new Map();
  const claves = [];                       // grupo -> [id por dimension]
  const sInst = [], sFilas = [];
  const sEst = quiereEstado ? [[], [], [], [], []] : null;
  let sDist = dist.map(x => x.trivial ? null : []);
  let distVivo = sDist.some(Boolean);

  const n = rows.length, idx = rows.idx;
  const ids = new Int32Array(nd);
  let pasado = 0;

  for (let k = 0; k < n; k++) {
    const i = idx ? idx[k] : k;

    let clave = empaqueta ? 0 : '';
    for (let j = 0; j < nd; j++) {
      const L = lect[j];
      const id = L.a ? (L.mapa ? L.mapa[L.a[i]] : L.a[i]) : 0;
      ids[j] = id;
      if (empaqueta) clave = clave * card[j] + id;
      else clave += (j ? '\u0001' : '') + id;
    }

    let g = grupos.get(clave);
    if (g === undefined) {
      if (grupos.size >= CONS_TOPE) { pasado++; continue; }
      g = claves.length;
      grupos.set(clave, g);
      claves.push(Int32Array.from(ids));
      sInst.push(0); sFilas.push(0);
      if (sEst) for (let e = 0; e < 5; e++) sEst[e].push(0);
      if (distVivo) for (let x = 0; x < sDist.length; x++) if (sDist[x]) sDist[x].push(null);
    }

    sInst[g] += pesos[i];
    sFilas[g]++;
    if (sEst) sEst[est[i]][g] += pesos[i];

    if (distVivo) {
      // Cuando los grupos se disparan, los conjuntos dejan de valer la pena:
      // se sueltan enteros y la consulta sigue sin ellos, dicho en la tabla.
      if (grupos.size > CONS_TOPE_DIST) { sDist = sDist.map(() => null); distVivo = false; }
      else for (let x = 0; x < sDist.length; x++) {
        const col = sDist[x];
        if (!col) continue;
        const a = dist[x].a;
        if (!a) continue;
        // El 0 del diccionario es la cadena vacia, y vacio no es un valor: las
        // filas agregadas -las que traen el recuento en vez del equipo- no
        // dicen QUE equipos son. Contarlas daria «1 equipo» para un grupo que
        // en realidad cubre el parque entero, que es peor que no decir nada.
        const v = a[i];
        if (!v) continue;
        let s = col[g];
        if (!s) col[g] = s = new Set();
        s.add(v);
      }
    }
  }

  // ---- de enteros a filas, ya solo sobre el resultado
  const filas = new Array(claves.length);
  for (let g = 0; g < claves.length; g++) {
    const o = { _g: g };
    for (let j = 0; j < nd; j++) {
      const L = lect[j];
      let v = L.vals[claves[g][j]];
      v = v == null ? '' : v;
      if (!v && L.vacio) v = L.vacio;
      o['d' + j] = L.et ? L.et(v) : v;
    }
    o.inst = sInst[g];
    o.filas = sFilas[g];
    if (sEst) {
      o.ok = sEst[1][g]; o.warn = sEst[2][g]; o.bad = sEst[3][g]; o.na = sEst[4][g];
      const punt = o.ok + o.warn + o.bad;
      o.pctOk = punt ? +(o.ok * 100 / punt).toFixed(1) : null;
    }
    for (let x = 0; x < dist.length; x++) {
      const clave = MEDIDA_DE_DIST[dist[x].campo];
      // agrupando por esa misma cosa la respuesta es uno... salvo en el grupo
      // de los que no la traen, que no es uno: es que no se sabe
      if (dist[x].trivial) o[clave] = claves[g][dist[x].j] ? 1 : null;
      else if (sDist[x] && sDist[x][g]) o[clave] = sDist[x][g].size;
      else o[clave] = null;
    }
    filas[g] = o;
  }

  return { lect, meds, filas, pasado, ms: Math.round(performance.now() - t0),
           sinDistintos: distintos.length > 0 && !distVivo && !dist.every(x => x.trivial) };
}

const CONS_EST = ['Sin estándar', 'Cumple', 'Requiere atención', 'No cumple', 'No puntúa'];
const MEDIDA_DE_DIST = { device: 'equipos', appKey: 'apps', ver: 'vers' };

/** Se recalcula solo cuando cambia algo: filtros, estándar o la propia consulta. */
function consultaActual(rows) {
  const firma = firmaRender() + '|' + CONS.dims.join(',') + '|' + CONS.meds.join(',');
  if (CONS.firma === firma && CONS.res) return CONS.res;
  CONS.firma = firma;
  return (CONS.res = calculaConsulta(rows));
}

/* ---------------------------------------------------------------------------
   La pantalla
   ------------------------------------------------------------------------- */
/* La disponibilidad se mira una vez por modelo: comprobar si hay fechas es un
   recorrido entero y esto se dibuja en cada pintada. */
function dimsDisponibles() {
  const T = M.tabla;
  const firma = (M.fileName || '') + '|' + T.length + '|' + (M.sources ? M.sources.length : 0);
  if (CONS.dispFirma === firma && CONS.disp) return CONS.disp;
  const d = {};
  for (const k in DIM_CONS) d[k] = dimDisponible(T, k);
  CONS.dispFirma = firma;
  return (CONS.disp = d);
}

function chipsDim(disp) {
  const grupos = {};
  for (const k in DIM_CONS) (grupos[DIM_CONS[k].g] = grupos[DIM_CONS[k].g] || []).push(k);
  return Object.keys(grupos).map(g => `<div class="cq-grp"><span class="cq-gl">${esc(g)}</span>` +
    grupos[g].map(k => {
      if (!disp[k]) return `<button class="cq-chip off" data-cd="${k}"` +
        ` title="Esta columna no viene en los datos que tienes cargados">${esc(DIM_CONS[k].l)}</button>`;
      const i = CONS.dims.indexOf(k);
      return `<button class="cq-chip${i >= 0 ? ' on' : ''}" data-cd="${k}">` +
        `${i >= 0 ? `<b>${i + 1}</b>` : ''}${esc(DIM_CONS[k].l)}</button>`;
    }).join('') + '</div>').join('');
}

function chipsMed() {
  return Object.keys(MED_CONS).map(k =>
    `<button class="cq-chip${CONS.meds.indexOf(k) >= 0 ? ' on' : ''}" data-cm="${k}"` +
    ` title="${esc(MED_CONS[k].d)}">${esc(MED_CONS[k].l)}</button>`).join('');
}

function vConsulta(A, rows) {
  const disp = dimsDisponibles();
  // Una dimension que estaba en la consulta y ya no esta en los datos -cambiaste
  // de archivo- se cae sola, en vez de devolver una tabla de una fila en blanco.
  const fuera = CONS.dims.filter(d => !disp[d]);
  if (fuera.length) { CONS.dims = CONS.dims.filter(d => disp[d]); CONS.firma = ''; }
  const res = consultaActual(rows);

  const cabecera = viewHead('Consulta libre',
    'Agrupa por lo que quieras, mide lo que quieras y llévatelo en Excel.') +
    `<div class="cq-panel">
      <div class="cq-row"><span class="cq-tit">Agrupar por</span>${chipsDim(disp)}</div>
      <div class="cq-row"><span class="cq-tit">Medir</span><div class="cq-grp">${chipsMed()}</div></div>
      <div class="cq-row"><span class="cq-tit">Ejemplos</span><div class="cq-grp">${
        CONS_EJEMPLOS.map((e, i) => `<button class="cq-chip" data-ce="${i}">${esc(e.l)}</button>`).join('')
      }</div></div>
    </div>`;

  if (!res || !res.filas.length) {
    return cabecera + `<div class="mt-wrap"><div class="empty" style="padding:34px;line-height:1.7">
      ${CONS.dims.length ? 'La combinación de filtros y dimensiones no deja ninguna fila.'
        : 'Elige al menos una cosa por la que agrupar.'}
    </div></div>`;
  }

  // Las columnas salen de lo elegido: las dimensiones primero, las medidas
  // detras, y en el orden en que se pulsaron.
  const cols = res.lect.map((L, j) => ({ k: 'd' + j, l: L.l, cls: j === 0 ? 'name' : '' }))
    .concat(res.meds.map(m => ({ k: m === 'pctOk' ? 'pctOk' : m, l: MED_CONS[m].l, n: true })));

  // Se ordena entero y se ensena la punta: pasarle medio millon de filas a la
  // tabla la deja inservible, y la exportacion se las lleva todas igual.
  const clave = res.meds.find(m => m !== 'pctOk') || 'inst';
  const todo = res.filas.slice().sort((a, b) => (b[clave] || 0) - (a[clave] || 0));
  const muestra = todo.slice(0, 5000);

  const totalInst = res.filas.reduce((s, r) => s + r.inst, 0);

  const avisos = (res.pasado ? `<div class="banner" style="margin:14px 0 0;border-color:rgba(214,158,46,.4)">${ico('alert')}<div>
      <b>La consulta pasa de ${fmt(CONS_TOPE)} filas y se cortó ahí.</b>
      Se quedaron fuera ${fmt(res.pasado)} filas del inventario. Quita una dimensión
      o filtra antes: agrupar por equipo y aplicación a la vez da casi una fila por instalación,
      y eso ya no es una respuesta, es el archivo entero.
    </div></div>` : '') +
    (res.sinDistintos ? `<div class="banner" style="margin:14px 0 0">${ico('info')}<div>
      <b>Los recuentos de valores distintos no se calcularon.</b>
      Hacen falta más de ${fmt(CONS_TOPE_DIST)} grupos y contar sin repetir exige guardar
      cada valor visto en cada grupo. Agrupa por menos cosas y vuelven.
    </div></div>` : '') +
    // Un «1 equipo» junto a tres millones de instalaciones no es un error de
    // cuenta: son filas de catalogo, que dicen cuantos equipos sin decir cuales.
    // Mejor explicarlo antes de que alguien lo lea como una averia.
    ((M.sources || []).length > 1 && CONS.dims.indexOf('fuente') < 0
      ? `<div class="banner" style="margin:14px 0 0">${ico('info')}<div>
      <b>Tienes ${fmt(M.sources.length)} fuentes cargadas y no todas cuentan igual.</b>
      El detalle trae una fila por instalación, con su equipo; el catálogo trae una por
      aplicación, con el recuento dentro y sin decir de qué equipos. Por eso un grupo puede
      salir con muchas instalaciones y pocos equipos: no está mal contado, es que esas filas
      no identifican máquinas.
      <button class="btn" data-cd="fuente" style="margin-top:10px">Separar por fuente</button>
    </div></div>` : '');

  return cabecera + avisos +
    `<div class="grid kpis" style="margin:14px 0 4px">
      ${kpi({ ic: 'chart', label: 'Filas del resultado', value: fmt(res.filas.length),
        sub: res.pasado ? 'cortado en el tope' : `agrupando <b>${fmt(rows.length)}</b> del inventario` })}
      ${kpi({ ic: 'layers', label: 'Instalaciones', value: fmt(totalInst),
        sub: 'suma de lo que cae en la tabla' })}
      ${kpi({ ic: 'clock', label: 'Calculado en', value: res.ms + ' ms',
        sub: 'sobre los datos ya cargados, sin salir a ningún sitio' })}
    </div>` +
    sec('Resultado', `Una fila por ${res.lect.map(L => L.l.toLowerCase()).join(' × ')}`) +
    mtable({
      id: 'consulta', title: 'Resultado', data: muestra, cols,
      sort: { k: clave, d: -1 },
      // Aqui no vale el boton generico: solo conoce las 5.000 filas que se
      // dibujan, y lo que se pide al exportar una consulta es el resultado.
      exportar: false,
      tools: `<button class="btn btn-p" data-cx="xlsx">Excel</button>` +
             `<button class="btn" data-cx="csv">CSV</button>`,
      foot: `<span style="margin-left:auto;color:var(--ink-4)">` +
        (todo.length > muestra.length
          ? `Se dibujan las ${fmt(muestra.length)} primeras de ${fmt(todo.length)}; la exportación las lleva todas`
          : 'La exportación lleva estas mismas filas') + `</span>`,
      cell: (r, c) => {
        const v = r[c.k];
        if (c.k === 'pctOk') return v == null ? '<span class="muted">—</span>'
          : `<span style="color:${v >= 95 ? 'var(--ok-ink)' : v >= 60 ? 'var(--warn-ink)' : 'var(--crit-ink)'}">${fmt1(v)} %</span>`;
        if (c.n) return v == null ? '<span class="muted">—</span>' : fmt(v);
        return esc(truncate(String(v == null ? '' : v), 60));
      }
    });
}

/* ---------------------------------------------------------------------------
   Llevarsela
   ---------------------------------------------------------------------------
   Sale el resultado entero, no lo que se ve. Lo que se ve es una muestra; lo
   que se pide al exportar es la respuesta.
   ------------------------------------------------------------------------- */
function hojaConsulta() {
  const res = CONS.res;
  if (!res || !res.filas.length) return null;
  const cabs = res.lect.map(L => L.l)
    .concat(res.meds.map(m => MED_CONS[m].l));
  const clave = res.meds.find(m => m !== 'pctOk') || 'inst';
  const filas = res.filas.slice().sort((a, b) => (b[clave] || 0) - (a[clave] || 0));
  const out = [cabs];
  for (const r of filas) {
    const linea = res.lect.map((L, j) => r['d' + j]);
    for (const m of res.meds) linea.push(r[m] == null ? '' : r[m]);
    out.push(linea);
  }
  return out;
}

async function exportaConsulta(kind) {
  const filas = hojaConsulta();
  if (!filas) { toast('No hay resultado que exportar'); return; }

  // El nombre dice que pregunta se hizo y cuando: un archivo suelto en la
  // carpeta de descargas, dentro de un mes, tiene que explicarse solo. No se
  // usa baseName() a proposito -arrastra el nombre compuesto de todas las
  // fuentes, «a.parquet - parque + a.parquet»- y aqui sobra.
  const limpia = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const trozo = limpia(CONS.dims.map(d => (DIM_CONS[d] || {}).l || d).join(' por ')).slice(0, 60);
  const hoy = new Date().toISOString().slice(0, 10);
  const nombre = (CFG.org ? limpia(CFG.org).slice(0, 20) + '_' : '') +
    'consulta_' + (trozo || 'resultado') + '_' + hoy;

  if (kind === 'csv') {
    const q = v => { const s = v == null ? '' : String(v);
      return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return saveFile(nombre + '.csv',
      '﻿' + filas.map(f => f.map(q).join(';')).join('\r\n'), 'text/csv;charset=utf-8;');
  }

  toast('Generando el libro de Excel…');
  const ctx = [['Consulta', CONS.dims.map(d => (DIM_CONS[d] || {}).l || d).join(' × ')],
               ['Medidas', CONS.meds.map(m => (MED_CONS[m] || {}).l || m).join(', ')],
               ['Filtros activos', activeDims().map(d => DIMS[d] + ': ' + Array.from(S.f[d]).join(', ')).join(' | ') || 'ninguno'],
               ['Búsqueda', S.q || 'ninguna'],
               ['Archivo', M.fileName || ''],
               ['Generado', new Date().toLocaleString('es-CO')],
               ['Filas del resultado', filas.length - 1]];
  const blob = await makeXlsx([{ name: 'Resultado', rows: filas }, { name: 'La consulta', rows: ctx }]);
  return saveFile(nombre + '.xlsx', blob);
}

/* ---- las pulsaciones de la pantalla ---- */
function consultaAction(el) {
  const d = el.getAttribute('data-cd');
  if (d) {
    const i = CONS.dims.indexOf(d);
    if (i >= 0) CONS.dims.splice(i, 1);
    else if (!(CONS.disp || {})[d]) {
      toast('«' + ((DIM_CONS[d] || {}).l || d) + '» no viene en los datos que tienes cargados');
      return true;
    }
    else if (CONS.dims.length >= 4) { toast('Cuatro dimensiones es el máximo: más allá la tabla deja de leerse'); return true; }
    else CONS.dims.push(d);
    CONS.firma = ''; S.limit = {}; render(); return true;
  }
  const m = el.getAttribute('data-cm');
  if (m) {
    const i = CONS.meds.indexOf(m);
    if (i >= 0) CONS.meds.splice(i, 1); else CONS.meds.push(m);
    if (!CONS.meds.length) CONS.meds = ['inst'];
    CONS.firma = ''; render(); return true;
  }
  const e = el.getAttribute('data-ce');
  if (e != null) {
    const ej = CONS_EJEMPLOS[+e];
    if (ej) {
      const disp = CONS.disp || {};
      const dims = ej.dims.filter(d => disp[d]);
      if (!dims.length) { toast('Ese ejemplo necesita columnas que tus datos no traen'); return true; }
      if (dims.length < ej.dims.length) {
        toast('Sin ' + ej.dims.filter(d => !disp[d]).map(d => (DIM_CONS[d] || {}).l).join(' ni ') +
              ': esa columna no viene en tus datos');
      }
      CONS.dims = dims; CONS.meds = ej.meds.slice(); CONS.firma = ''; S.limit = {}; render();
    }
    return true;
  }
  const x = el.getAttribute('data-cx');
  if (x) { exportaConsulta(x); return true; }
  return false;
}

/* Se registra aqui y no en la tabla de vistas: asi no hay que confiar en que el
   navegador haya izado esta funcion antes de evaluar aquel objeto. */
VIEWS.consulta = { l: 'Consulta libre', ic: 'chart', f: vConsulta };
