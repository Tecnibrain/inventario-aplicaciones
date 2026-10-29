
/* ============================================================================
   23b. PARCHES  ·  en que nivel va cada maquina
   ---------------------------------------------------------------------------
   Dos fuentes, y conviene saber cual contesta que.

   La COMPILACION viene en el inventario desde siempre y esta para todos los
   equipos: «10.0.26100.9445», y esos ultimos digitos son el parche del mes.
   Basta para saber quien va detras de quien, y no cuesta pedir nada.

   Lo que la compilacion no tiene es la FECHA. Saber que un equipo esta en la
   .1591 dice que va muy atras, pero no cuanto tiempo lleva asi, y «lleva ocho
   meses sin parchear» es la frase que mueve a alguien. Eso llega por la
   remediacion, que lee el KB y el dia en que entro.

   Lo que NO se hace aqui es traducir compilacion a fecha. Habria que mantener
   una tabla de cada compilacion con su dia de publicacion, que Microsoft
   cambia todos los meses, y una tabla que envejece sin avisar miente con mas
   confianza que no tener nada. Asi que el retraso se mide contra el propio
   parque: cuantas compilaciones mas nuevas que la tuya hay ahi fuera, en
   maquinas tuyas, hoy.
   ========================================================================== */

/* Los dos nombres que planta la remediacion. Van aqui y no en el script porque
   el que tiene que reconocerlos es este lado. */
const PAR_KB = 'parche de windows';
const PAR_FECHA = 'parche instalado';

/** La compilacion partida: «10.0.26100.9445» -> { rel, rev }. */
function compDe(osver) {
  const m = String(osver == null ? '' : osver).match(/^10\.0\.(\d{4,6})\.(\d+)$/);
  if (!m) return null;
  return { base: +m[1], rev: +m[2], rel: soRelease(osver) };
}

/**
 * El KB y la fecha que haya llegado por la remediacion, por equipo.
 *
 * Se busca por NOMBRE y no por la clave de aplicacion: la clave se construye
 * normalizando fabricante y nombre, y basta que el fabricante llegue distinto
 * para que no case. El nombre lo pone el script y no cambia.
 */
function parchesDeRemediacion() {
  const T = M.tabla;
  const ca = T.crudo('app'), cv = T.crudo('ver'), cd = T.crudo('device');
  const out = new Map();
  if (!ca.a || !cd.a) return out;

  // que ids del diccionario son los dos marcadores
  let idKb = -1, idFe = -1;
  for (let k = 0; k < ca.vals.length; k++) {
    const v = String(ca.vals[k] || '').trim().toLowerCase();
    if (v === PAR_KB) idKb = k;
    else if (v === PAR_FECHA) idFe = k;
  }
  if (idKb < 0 && idFe < 0) return out;

  const n = T.length;
  for (let i = 0; i < n; i++) {
    const a = ca.a[i];
    if (a !== idKb && a !== idFe) continue;
    const dev = cd.vals[cd.a[i]];
    if (!dev) continue;
    const val = cv.a ? cv.vals[cv.a[i]] : '';
    if (!val) continue;
    let o = out.get(dev);
    if (!o) out.set(dev, o = {});
    if (a === idKb) o.kb = val; else o.fecha = val;
  }
  return out;
}

/* Cuanto hace de esa fecha. La remediacion la escribe en ISO, que se compara
   y se resta sin depender del idioma del equipo que genero el CSV. */
function diasDesde(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return null;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
}

/* Los tramos de retraso. Cortados a ojo y a proposito: lo que importa no es si
   son tres o cuatro niveles, es distinguir «va una detras» de «lleva un ano». */
const PAR_TRAMOS = [
  { l: 'Al día', max: 0, c: 'var(--ok)' },
  { l: '1 o 2 por detrás', max: 2, c: 'var(--bar)' },
  { l: '3 a 5 por detrás', max: 5, c: 'var(--bar-hi)' },
  { l: '6 a 10 por detrás', max: 10, c: 'var(--warn)' },
  { l: 'Más de 10 por detrás', max: Infinity, c: 'var(--crit)' }
];
const tramoDe = n => PAR_TRAMOS.findIndex(t => n <= t.max);

/**
 * El estado de parches del parque.
 *
 * Una pasada por las fichas de equipo -no por el millon de filas-: el nivel de
 * parche es del EQUIPO, no de cada aplicacion que tenga instalada.
 */
function calculaParches() {
  const rem = parchesDeRemediacion();
  const porRel = new Map();        // release -> { revs:Map(rev->n), devs:[] }
  let sinComp = 0;

  M.devInfo.forEach((f, dev) => {
    const c = compDe(f.osver);
    if (!c) { sinComp++; return; }
    let o = porRel.get(c.rel);
    if (!o) porRel.set(c.rel, o = { revs: new Map(), devs: [], base: c.base });
    o.revs.set(c.rev, (o.revs.get(c.rev) || 0) + 1);
    o.devs.push({ dev, rev: c.rev, f });
  });

  // dentro de cada version de Windows, las compilaciones de mas nueva a mas
  // vieja; la posicion en esa lista es el retraso
  const releases = [];
  const filas = [];
  porRel.forEach((o, rel) => {
    const orden = Array.from(o.revs.keys()).sort((a, b) => b - a);
    const pos = new Map();
    orden.forEach((r, i) => pos.set(r, i));
    const top = orden[0];

    for (const d of o.devs) {
      const r = rem.get(d.dev) || {};
      const dias = diasDesde(r.fecha);
      filas.push({
        dev: d.dev, user: d.f.user || '', rel, comp: '10.0.' + o.base + '.' + d.rev,
        rev: d.rev, atras: pos.get(d.rev), tramo: tramoDe(pos.get(d.rev)),
        kb: r.kb || '', parcheado: r.fecha || '', dias: dias
      });
    }

    releases.push({ rel, equipos: o.devs.length, comps: orden.length,
      masNueva: '10.0.' + o.base + '.' + top, enLaNueva: o.revs.get(top) || 0,
      masVieja: '10.0.' + o.base + '.' + orden[orden.length - 1],
      orden, revs: o.revs, base: o.base });
  });

  releases.sort((a, b) => b.equipos - a.equipos);
  const tramos = PAR_TRAMOS.map(() => 0);
  for (const r of filas) tramos[r.tramo]++;

  const conFecha = filas.filter(r => r.dias != null);
  conFecha.sort((a, b) => a.dias - b.dias);
  const mediana = conFecha.length ? conFecha[Math.floor(conFecha.length / 2)].dias : null;

  return { filas, releases, tramos, sinComp, conFecha: conFecha.length,
           conKb: filas.filter(r => r.kb).length, mediana };
}

/* ---------------------------------------------------------------------------
   La pantalla
   ------------------------------------------------------------------------- */
function vParches(A, rows) {
  if (!M.devInfo.size) return viewHead('Parches',
      'En qué nivel de parche va cada máquina del parque.') +
    `<div class="mt-wrap"><div class="empty" style="padding:34px;line-height:1.7">
      <b>Este inventario no nombra equipos.</b><br>
      Viene de un catálogo agregado, que cuenta cuántas máquinas hay en cada versión
      pero no cuáles. Para el nivel de parche hace falta el detalle.
    </div></div>`;

  const P = calculaParches();
  const n = P.filas.length;

  if (!n) return viewHead('Parches', 'En qué nivel de parche va cada máquina del parque.') +
    `<div class="mt-wrap"><div class="empty" style="padding:34px;line-height:1.7">
      <b>Ningún equipo reporta compilación de Windows.</b><br>
      Es la columna <code>OSVersion</code> del inventario, y tiene que llegar entera
      —<span class="mono">10.0.26100.9445</span>—: los últimos dígitos son el parche.
    </div></div>`;

  const alDia = P.tramos[0];
  const muyAtras = P.tramos[4];
  const compsTotal = P.releases.reduce((s, r) => s + r.comps, 0);
  const cobertura = n ? P.conFecha * 100 / n : 0;

  const kpis = `<div class="grid kpis" style="margin:14px 0 4px">
    ${kpi({ ic: 'pc', label: 'Equipos con nivel conocido', value: fmt(n),
      sub: P.sinComp ? `<b>${fmt(P.sinComp)}</b> sin compilación reportada` : 'todo el parque' })}
    ${kpi({ ic: 'fork', label: 'Compilaciones conviviendo', value: fmt(compsTotal),
      sub: `repartidas en <b>${fmt(P.releases.length)}</b> versiones de Windows` })}
    ${kpi({ ic: 'check', label: 'En la más nueva de su versión', value: fmt(alDia),
      st: alDia * 2 > n ? 'ok' : 'warn', meter: n ? alDia * 100 / n : 0,
      sub: `${fmt1(n ? alDia * 100 / n : 0)} % del parque` })}
    ${P.mediana != null
      // Un numero grande calculado sobre cuarenta equipos de cuarenta mil se
      // lee como si fuera del parque. Asi que la cobertura va delante, y
      // mientras sea pobre el indicador no se pinta de rojo: no hay con que.
      ? kpi({ ic: 'clock', label: 'Días desde el último parche', value: fmt(P.mediana),
          st: cobertura < 20 ? '' : P.mediana <= 45 ? 'ok' : P.mediana <= 90 ? 'warn' : 'crit',
          sub: cobertura < 20
            ? `mediana de solo <b>${fmt(P.conFecha)}</b> equipos (${fmt1(cobertura)} % del parque): ` +
              `aún no es la foto del parque`
            : `la mediana de los <b>${fmt(P.conFecha)}</b> que reportan fecha, ${fmt1(cobertura)} % del parque` })
      : kpi({ ic: 'alert', label: 'Más de 10 niveles por detrás', value: fmt(muyAtras),
          st: muyAtras ? 'crit' : 'ok', sub: 'máquinas que llevan muchos meses igual' })}
  </div>`;

  // Lo primero que hay que decir, porque es lo que hace creible o no el numero.
  const comoSeMide = `<div class="banner" style="margin:14px 0 0">${ico('info')}<div>
    <b>«Por detrás» se mide contra tu propio parque, no contra el calendario.</b>
    Si un equipo sale con 7 por detrás, quiere decir que hay <b>siete compilaciones más
    nuevas que la suya</b> instaladas hoy en máquinas tuyas de esa misma versión de Windows.
    No se traduce a meses a propósito: haría falta una tabla de cada compilación con su día
    de publicación, Microsoft la cambia cada mes, y una tabla vieja miente con más aplomo
    que no tener ninguna.${P.conFecha ? '' : ` Para tener la fecha de verdad —y con ella
    «lleva ocho meses sin parchear»— hay que traer el KB desde una remediación.`}
  </div></div>`;

  const sinRem = !P.conKb ? `<div class="banner" style="margin:14px 0 0">${ico('alert')}<div>
    <b>No hay datos de KB.</b> La compilación dice quién va detrás de quién, pero no desde
    cuándo. Para traer el número de KB y la fecha en que entró, pon <code>$Parches = 1</code>
    en <code>2-deteccion.ps1</code> y carga el CSV que salga de la remediación: se funde con
    esto y aparecen las dos últimas columnas de la tabla.
  </div></div>` : '';

  // ---- reparto por tramo de retraso
  const datosTramo = PAR_TRAMOS.map((t, i) => [t.l, P.tramos[i], '', String(i)])
    .filter(d => d[1] > 0);

  // ---- las compilaciones con mas equipos detras, de todas las versiones
  const rezago = [];
  for (const r of P.releases) {
    r.orden.forEach((rev, i) => {
      if (i === 0) return;                       // la mas nueva no va por detras
      rezago.push({ etq: r.rel + '  ·  .' + rev, n: r.revs.get(rev), atras: i, rel: r.rel });
    });
  }
  rezago.sort((a, b) => b.n - a.n);
  const top = rezago.slice(0, 12);

  return viewHead('Parches', 'En qué nivel de parche va cada máquina, y cuánto lleva ahí.') +
    kpis + comoSeMide + sinRem +
    sec('Cómo está repartido el retraso', 'Cuántas máquinas van al día y cuántas se han quedado atrás') +
    `<div class="gwide">` +
      card({ title: 'Equipos por retraso', sub: 'Compilaciones más nuevas que la suya, dentro de su versión de Windows',
        body: barH(datosTramo, { unit: 'Equipos', W: 560, labelW: 210, trunc: 30, rowH: 27,
          color: d => PAR_TRAMOS[+d[3]].c, aria: 'Equipos por retraso de parche' }),
        table: twin(['Retraso', 'Equipos', '% del parque'],
          datosTramo.map(d => [d[0], fmt(d[1]), fmt1(d[1] * 100 / n) + ' %'])) }) +
      card({ title: 'Dónde se acumulan', sub: 'Las compilaciones viejas con más máquinas encima',
        body: barH(top.map(x => [x.etq, x.n, '', '']),
          { unit: 'Equipos', W: 560, labelW: 230, trunc: 34, rowH: 23, aria: 'Compilaciones con más equipos' }),
        table: twin(['Compilación', 'Equipos', 'Por detrás'],
          top.map(x => [x.etq, fmt(x.n), x.atras])) }) +
    `</div>` +

    sec('Por versión de Windows', 'Cada versión tiene su propia cadena de parches: solo se comparan entre sí') +
    mtable({ id: 'parRel', title: 'Versiones de Windows', data: P.releases,
      sort: { k: 'equipos', d: -1 },
      cols: [{ k: 'rel', l: 'Versión', cls: 'name' }, { k: 'equipos', l: 'Equipos', n: true },
        { k: 'comps', l: 'Compilaciones', n: true }, { k: 'masNueva', l: 'La más nueva' },
        { k: 'enLaNueva', l: 'En ella', n: true }, { k: 'masVieja', l: 'La más vieja' }],
      foot: '<span style="margin-left:auto;color:var(--ink-4)">Una fila por versión de Windows</span>',
      cell: (r, c) => {
        if (c.k === 'masNueva' || c.k === 'masVieja') return `<span class="mono mini">${esc(r[c.k])}</span>`;
        if (c.k === 'enLaNueva') return `${fmt(r.enLaNueva)}<div class="mini" style="color:var(--ink-4)">${
          fmt1(r.enLaNueva * 100 / r.equipos)} %</div>`;
        if (c.n) return fmt(r[c.k]);
        return esc(r[c.k]);
      } }) +

    sec('Equipo por equipo', 'Pulsa una fila para abrir el equipo. El botón de Excel se lleva la tabla entera') +
    mtable({ id: 'parDev', title: 'Nivel de parche por equipo', data: P.filas,
      sort: { k: 'atras', d: -1 },
      rowAttr: x => `data-godev="${esc(x.dev)}"`,
      cols: [{ k: 'dev', l: 'Equipo', cls: 'name' }, { k: 'user', l: 'Usuario' },
        { k: 'rel', l: 'Windows' }, { k: 'comp', l: 'Compilación' },
        { k: 'atras', l: 'Por detrás', n: true },
        { k: 'kb', l: 'Último KB' }, { k: 'parcheado', l: 'Parcheado el' },
        { k: 'dias', l: 'Días', n: true }],
      cell: (x, c) => {
        if (c.k === 'comp') return `<span class="mono mini">${esc(x.comp)}</span>`;
        if (c.k === 'atras') return x.atras === 0
          ? '<span class="sem sem-pill ok">Al día</span>'
          : `<span style="color:${PAR_TRAMOS[x.tramo].c}">${fmt(x.atras)}</span>`;
        if (c.k === 'kb') return x.kb ? `<span class="mono mini">${esc(x.kb)}</span>` : '<span class="muted">—</span>';
        if (c.k === 'parcheado') return x.parcheado || '<span class="muted">—</span>';
        if (c.k === 'dias') return x.dias == null ? '<span class="muted">—</span>'
          : `<span style="color:${x.dias <= 45 ? 'var(--ok-ink)' : x.dias <= 90 ? 'var(--warn-ink)' : 'var(--crit-ink)'}">${fmt(x.dias)}</span>`;
        if (c.n) return fmt(x[c.k]);
        return esc(x[c.k] == null ? '' : x[c.k]);
      } });
}

VIEWS.parches = { l: 'Parches', ic: 'win', f: vParches };
