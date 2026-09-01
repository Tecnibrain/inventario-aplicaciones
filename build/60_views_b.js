
/* ============================================================================
   19. VISTA · VERSIONES
   ========================================================================== */
function vVersiones(A, rows) {
  const soloApp = S.f.appKey && S.f.appKey.size === 1 ? Array.from(S.f.appKey)[0] : null;
  let repTitle, repSub, repBody, repTable, repExtra = '';
  const ordScale = `<div class="scale ord"><span>más antigua</span><div class="scale-ramp">` +
    ORD.slice().reverse().map(c => `<i style="background:${c}"></i>`).join('') +
    `</div><span>más reciente</span><span style="margin-left:auto;display:inline-flex;align-items:center;gap:5px;color:var(--ink-3)">` +
    `<svg width="9" height="6" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6Z" fill="var(--brand)"/></svg>versión de referencia</span></div>`;

  if (soloApp) {
    const vm = A.appVerDev.get(soloApp) || new Map();
    const latest = M.latestVer.get(soloApp), r = rule(soloApp) || {};
    const vers = Array.from(vm.entries()).map(([v, set]) => [v, set.size]).sort((a,b) => verCmp(b[0], a[0]));
    repTitle = 'Versiones de ' + esc(appLabel(soloApp));
    repSub = `Aprobada <b class="mono">${esc(r.rec || latest || '—')}</b> · mínima <b class="mono">${esc(r.min || '—')}</b>. El color indica el estado frente al estándar.`;
    repBody = barH(vers.map(([v, n]) => [v + (v === r.rec ? '  · aprobada' : ''), n, 'ver', v]),
      { unit:'Equipos', W:560, labelW:200, trunc:30, rowH:25,
        color:(d) => { const st = evalVer(soloApp, d[3]); return st==='ok'?'var(--ok)':st==='warn'?'var(--warn)':st==='bad'?'var(--crit)':'var(--bar)'; },
        aria:'Versiones de la aplicación seleccionada' });
    repExtra = `<div class="rep-legend"><span class="sem ok">Cumple</span><span class="sem warn">Requiere atención</span><span class="sem bad">No cumple</span></div>`;
    repTable = twin(['Versión','Equipos','Estado'], vers.map(([v,n]) => [v, fmt(n), EST_LAB[evalVer(soloApp,v)]]));
  } else {
    const items = A.debt.slice(0, 9).map(d => {
      const vm = A.appVerDev.get(d.key) || new Map();
      const ord = Array.from(vm.entries()).map(([v, set]) => [v, set.size]).sort((a,b) => verCmp(b[0], a[0]));
      const keepSet = new Set(d.latest ? [d.latest] : []);
      for (const [v] of ord.slice().sort((a,b) => b[1]-a[1])) { if (keepSet.size >= 6) break; keepSet.add(v); }
      const keep = ord.filter(([v]) => keepSet.has(v)), rest = ord.filter(([v]) => !keepSet.has(v));
      const restN = rest.reduce((a,x) => a + x[1], 0);
      const segs = keep.map(([v,n], i) => ({ lab:v, v:n, rank:i, latest: v === d.latest }));
      if (restN) segs.push({ lab:'otras ' + rest.length + ' versiones más antiguas', v:restN, rank: ORD.length-1, latest:false });
      return { key:d.key, label: appLabel(d.key), total:d.total, ok:d.total-d.behind, segs };
    });
    repTitle = 'Reparto de versiones';
    repSub = 'Cada barra es una aplicación; cada segmento, una versión conviviendo. El segmento más brillante es la más reciente. Pulsa una barra para bajar al detalle.';
    repBody = versionBars(items, { dim:'appKey', aria:'Reparto de versiones por aplicación' });
    repExtra = ordScale;
    repTable = twin(['Aplicación','Versiones','Al día','Por detrás'], A.debt.slice(0,25).map(d =>
      [appLabel(d.key), fmt(d.nver), fmt(d.total-d.behind), fmt(d.behind)]));
  }

  const debtData = A.debt.slice(0,12).map(d => [appLabel(d.key), d.behind, 'appKey', d.key, ['Última versión', d.latest]]);
  const lagData = A.lagList.slice(0,12).map(([dev,n]) => [dev, n, 'device', dev]);
  const dPct = pct(A.debtTotal, A.pairs);

  return viewHead('Versiones', 'Qué versión debería tener cada equipo, cuántos van por detrás y dónde está el trabajo pendiente.') +
    `<div class="grid kpis" style="margin:14px 0 4px">
      ${kpi({ ic:'fork', label:'Deuda de actualización', value: fmt(A.debtTotal), meter: dPct,
        st: dPct<=5?'ok':dPct<=15?'warn':dPct<=30?'serious':'crit',
        sub:`actualizaciones pendientes · <b>${fmt(A.devLag.size)}</b> equipos afectados` })}
      ${kpi({ ic:'grid', label:'Apps con versiones mixtas', value: fmt(A.frag.length),
        sub:`<b>${fmt1(pct(A.frag.length, A.nApp))} %</b> del catálogo sin unificar` })}
      ${kpi({ ic:'layers', label:'Aplicaciones con retraso', value: fmt(A.debt.length),
        sub:'Con al menos un equipo por debajo de la última versión' })}
      ${kpi({ ic:'pc', label:'Equipo más rezagado', value: A.lagList.length ? fmt(A.lagList[0][1]) : '0',
        sub: A.lagList.length ? `apps desactualizadas en <b>${esc(truncate(A.lagList[0][0], 22))}</b>` : 'Ninguno' })}
    </div>` +
    `<div class="gwide" style="margin-top:16px">` +
      card({ title: repTitle, sub: repSub, body: repBody, extra: repExtra, table: repTable }) +
      card({ title:'Deuda de actualización por aplicación',
        sub:'Equipos que no tienen la versión más alta observada. Es el trabajo pendiente, no la simple variedad de versiones',
        body: barH(debtData, { unit:'Equipos por detrás', W:560, labelW:210, trunc:32, aria:'Equipos por detrás' }),
        table: twin(['Aplicación','Por detrás','Total','Última versión'], A.debt.slice(0,25).map(d =>
          [appLabel(d.key), fmt(d.behind), fmt(d.total), d.latest])) }) +
      card({ title:'Equipos más rezagados', sub:'Aplicaciones desactualizadas en cada equipo. Encabezan la cola de parcheo',
        body: barH(lagData, { unit:'Apps desactualizadas', W:560, labelW:230, trunc:34, aria:'Apps desactualizadas por equipo' }),
        table: twin(['Equipo','Apps desactualizadas'], A.lagList.slice(0,30).map(([d,n]) => [d, fmt(n)])) }) +
      card({ title:'Versiones conviviendo por aplicación', sub:'Recuento de versiones distintas presentes a la vez. Mide la dispersión, no el retraso',
        body: barH(A.frag.slice(0,12).map(([k,nv,nd]) => [appLabel(k), nv, 'appKey', k, ['Equipos', fmt(nd)]]),
          { unit:'Versiones', W:560, labelW:210, trunc:32, aria:'Versiones distintas por aplicación' }),
        table: twin(['Aplicación','Versiones','Equipos'], A.frag.slice(0,25).map(([k,nv,nd]) =>
          [appLabel(k), fmt(nv), fmt(nd)])) }) +
    `</div>`;
}

/* ============================================================================
   20. VISTA · TENDENCIAS E HISTORICO
   ========================================================================== */
function vTendencias(A, rows) {
  const hs = HIST.filter(h => (h.org || '') === (CFG.org || ''));
  const p = histPrev(), t = CMP.tot;
  const labels = hs.map(h => h.fecha.slice(5));
  const cmpTrend = hs.length > 1
    ? trendMulti(labels, [
        { n:'Cumplen', c:'var(--ok)', v: hs.map(h => h.k.ok), fill:true },
        { n:'Requieren atención', c:'var(--warn)', v: hs.map(h => h.k.warn) },
        { n:'No cumplen', c:'var(--crit)', v: hs.map(h => h.k.bad) }], { aria:'Evolución del cumplimiento' })
    : '<div class="empty">Carga inventarios de fechas distintas: cada carga guarda una lectura y aquí se dibuja la evolución</div>';
  const pctTrend = hs.length > 1
    ? trendMulti(labels, [{ n:'% de cumplimiento', c:'var(--bar)', v: hs.map(h => h.k.pctOk), fill:true }],
        { unit:' %', aria:'Porcentaje de cumplimiento en el tiempo' })
    : '<div class="empty">Aún no hay suficientes lecturas guardadas</div>';
  const deudaTrend = hs.length > 1
    ? trendMulti(labels, [{ n:'Actualizaciones pendientes', c:'var(--s3)', v: hs.map(h => h.k.deuda), fill:true }],
        { aria:'Deuda de actualización en el tiempo' })
    : '<div class="empty">Aún no hay suficientes lecturas guardadas</div>';

  const cmpRow = (lab, now, before, good, unit) =>
    `<tr><td class="name">${esc(lab)}</td><td class="n">${fmt1(now)}${unit || ''}</td>` +
    `<td class="n muted">${before == null ? '—' : fmt1(before) + (unit || '')}</td>` +
    `<td class="n">${delta(now, before, good, unit)}</td></tr>`;

  return viewHead('Tendencias',
    'Cada vez que cargas un inventario se guarda una lectura en este navegador. Aquí se comparan entre sí para demostrar la evolución de la gestión.') +
    `<div class="grid kpis" style="margin:14px 0 4px">
      ${kpi({ ic:'db', label:'Lecturas guardadas', value: fmt(hs.length),
        sub: hs.length ? `Desde <b>${hs[0].fecha}</b> hasta <b>${hs[hs.length-1].fecha}</b>` : 'Ninguna todavía' })}
      ${kpi({ ic:'shieldOk', label:'Cumplimiento actual', value: fmt1(t.pctOk)+' %',
        st: t.pctOk>=CFG.params.umbralOk?'ok':t.pctOk>=CFG.params.umbralWarn?'warn':'crit',
        sub: p ? `${delta(t.pctOk, p.k.pctOk, true, ' pts')} frente al ${p.fecha}` : 'Sin lectura anterior con la que comparar' })}
      ${kpi({ ic:'trend', label:'Equipos en rojo', value: fmt(t.bad), st: t.bad?'crit':'ok',
        sub: p ? `${delta(t.bad, p.k.bad, false)} frente al ${p.fecha}` : 'Sin comparación' })}
      ${kpi({ ic:'fork', label:'Deuda de actualización', value: fmt(A.debtTotal),
        sub: p ? `${delta(A.debtTotal, p.k.deuda, false)} frente al ${p.fecha}` : 'Sin comparación' })}
    </div>` +
    `<div class="gwide" style="margin-top:16px">` +
      card({ title:'Evolución del cumplimiento', sub:'Equipos en cada estado a lo largo de las lecturas guardadas', body: cmpTrend }) +
      card({ title:'Porcentaje de cumplimiento', sub:'La línea que se lleva a la reunión con el cliente', body: pctTrend }) +
      card({ title:'Deuda de actualización', sub:'Instalaciones por debajo de la versión aprobada; bajar es mejorar', body: deudaTrend }) +
      card({ title:'Este periodo frente al anterior',
        sub: p ? `Comparación con la lectura del <b>${p.fecha}</b>` : 'Se necesita al menos una lectura anterior',
        body: p ? `<div class="mt-wrap" style="border:none"><table class="mt">
          <thead><tr><th>Indicador</th><th class="n">Ahora</th><th class="n">${esc(p.fecha)}</th><th class="n">Variación</th></tr></thead>
          <tbody>
            ${cmpRow('Dispositivos', A.nDev, p.k.dev, true)}
            ${cmpRow('Aplicaciones detectadas', A.nApp, p.k.apps, false)}
            ${cmpRow('% de cumplimiento', t.pctOk, p.k.pctOk, true, ' %')}
            ${cmpRow('Equipos que cumplen', t.ok, p.k.ok, true)}
            ${cmpRow('Equipos en rojo', t.bad, p.k.bad, false)}
            ${cmpRow('Actualizaciones pendientes', A.debtTotal, p.k.deuda, false)}
            ${cmpRow('Equipos sin sincronizar', CMP.stale.size, p.k.stale, false)}
          </tbody></table></div>` : '<div class="empty">Carga un inventario de otra fecha para poder comparar</div>' }) +
    `</div>` +
    sec('Lecturas guardadas', 'Se conservan las 24 más recientes en este navegador') +
    mtable({ id:'hist', title:'Histórico', data: hs.slice().reverse().map(h => ({
        fecha:h.fecha, archivo:h.archivo || '—', dev:h.k.dev, apps:h.k.apps,
        pctOk:h.k.pctOk, bad:h.k.bad, deuda:h.k.deuda })),
      sort:{ k:'fecha', d:-1 }, rowAttr: () => '',
      cols:[{ k:'fecha', l:'Fecha', cls:'name' }, { k:'archivo', l:'Archivo' },
        { k:'dev', l:'Equipos', n:true }, { k:'apps', l:'Apps', n:true },
        { k:'pctOk', l:'% cumplimiento', n:true }, { k:'bad', l:'En rojo', n:true },
        { k:'deuda', l:'Deuda', n:true }],
      cell:(r,c) => c.k === 'pctOk' ? fmt1(r.pctOk) + ' %' : c.n ? fmt(r[c.k]) : esc(r[c.k]),
      foot:`<button class="btn" id="histClear" style="margin-left:auto">Borrar histórico</button>` });
}

/* ============================================================================
   21. VISTA · MAPAS  (portafolio, calor y geografía)
   ========================================================================== */
function vMapas(A, rows) {
  const vendorTop = A.topVendors.slice(0, 8).map(v => v[0]);
  const groups = [];
  for (const vn of vendorTop) {
    const items = A.topApps.filter(([k]) => vendorOfApp(k) === vn).slice(0, 26)
      .map(([k, v]) => ({ key:k, label: nameOfApp(k), v, color:(A.appVers.get(k) || new Set()).size }));
    if (items.length) groups.push({ name:vn, v: items.reduce((s,i) => s+i.v, 0), items });
  }
  const otros = A.topApps.filter(([k]) => !vendorTop.includes(vendorOfApp(k))).slice(0, 22)
    .map(([k, v]) => ({ key:k, label: nameOfApp(k), v, color:(A.appVers.get(k) || new Set()).size }));
  if (otros.length) groups.push({ name:'Otros fabricantes', v: otros.reduce((s,i)=>s+i.v,0), items: otros });
  const maxVer = Math.max(1, vMax(A.frag.map(f => f[1])));
  const tm = treemap(groups, { maxColor:maxVer, colorLabel:'Versiones distintas', aria:'Mapa de portafolio' });

  const hmCols = A.osList.slice(0, 6).map(([k, v]) => ({ label:k, n:v, key:k }));
  const hmRows = A.topApps.slice(0, 12).map(([k]) => ({ key:k, label: nameOfApp(k) }));
  const hmGet = (r, c) => {
    const m = A.verOsDev.get(r.key), a = m && m.get(c.key) ? m.get(c.key).size : 0;
    return { v: pct(a, c.n), a, b: c.n };
  };
  const hm = heatmap(hmRows, hmCols, hmGet, { max:100, aria:'Cobertura por build de SO' });

  let out = viewHead('Mapas', M.hasGeo
    ? 'Distribución geográfica, portafolio por área y concentración por calor.'
    : 'El archivo no trae columna de ubicación, así que se muestran el mapa de portafolio y el mapa de calor.');
  out += '<div class="gwide" style="margin-top:16px">';
  if (M.hasGeo) {
    const pts = A.geoList.map(([k, v]) => {
      const c = GEO[norm(k)];
      return c ? { key:k, label:k, lon:c[0], lat:c[1], v, rows: rows.filter(r => r.geo === k).length } : null;
    }).filter(Boolean);
    if (pts.length) {
      const gm = geoMap(pts, {});
      out += card({ title:'Mapa geográfico del parque', sub:'Equipos únicos por ubicación; el área del círculo es proporcional al número de equipos',
        body: gm.svg, extra: gm.legend, table: twin(['Ubicación','Equipos'], A.geoList.map(([k,v]) => [k, fmt(v)])) });
    }
  }
  out += card({ title:'Mapa de portafolio (treemap)',
    sub:'Área = equipos donde está instalada · Color = número de versiones distintas conviviendo. Grande y caliente = prioridad de estandarización',
    body: tm.svg, extra: tm.scale,
    table: twin(['Aplicación','Fabricante','Equipos','Versiones'], A.topApps.slice(0,30).map(([k,v]) =>
      [appLabel(k), pretty(vendorOfApp(k)), fmt(v), fmt((A.appVers.get(k) || new Set()).size)])) });
  out += card({ title:'Mapa de calor · cobertura por build de SO',
    sub:'Porcentaje de equipos de cada build que tienen la aplicación. Las celdas frías señalan huecos de despliegue',
    body: hm.svg, extra: hm.scale,
    table: twin(['Aplicación'].concat(hmCols.map(c => c.label)), hmRows.map(r =>
      [appLabel(r.key)].concat(hmCols.map(c => fmt1(hmGet(r,c).v) + ' %')))) });
  out += '</div>';
  out += sec('Densidad y actividad') + '<div class="gwide">';
  out += card({ title:'Densidad de software por equipo', sub:'Distribución de equipos según cuántas aplicaciones tienen inventariadas',
    body: barV(A.buckets.map(([lab,v]) => [lab, v, 'bucket', lab]),
      { unit:'Equipos', xTitle:'Aplicaciones por equipo', aria:'Histograma de aplicaciones por equipo' }),
    table: twin(['Rango','Equipos'], A.buckets.map(b => [b[0], fmt(b[1])])) });
  if (M.hasTime && A.days.length > 1) {
    out += card({ title:'Actividad de reporte', sub:'Equipos que enviaron inventario cada día del periodo',
      body: timeline(A.days.map(([k,v]) => [k, v, dayLabel(parseDate(k))]), { unit:'Equipos', aria:'Equipos que reportan por día' }),
      table: twin(['Fecha','Equipos'], A.days.map(([k,v]) => [k, fmt(v)])) });
  }
  out += '</div>';
  return out;
}

/* ============================================================================
   22. VISTA · INFORME PARA CLIENTE
   ========================================================================== */
function vInforme(A, rows) {
  const t = CMP.tot, p = histPrev();
  const nivel = t.pctOk >= CFG.params.umbralOk ? 'ok' : t.pctOk >= CFG.params.umbralWarn ? 'warn' : 'bad';
  const nivelTxt = { ok:'Saludable', warn:'Aceptable con puntos de mejora', bad:'Requiere intervención' }[nivel];
  const col = { ok:'var(--ok-ink)', warn:'var(--warn-ink)', bad:'var(--crit-ink)' }[nivel];
  const org = CFG.org || 'Su organización';
  const periodo = M.maxDate ? M.maxDate.toLocaleDateString('es-CO', { day:'numeric', month:'long', year:'numeric' })
                            : new Date().toLocaleDateString('es-CO', { day:'numeric', month:'long', year:'numeric' });

  /* riesgos en lenguaje llano */
  const riesgos = [];
  CMP.critApps.slice(0, 3).forEach(o => riesgos.push({
    t:`${pretty(nameOfApp(o.key))} necesita actualizarse`,
    d:`Es una aplicación considerada crítica y <b>${fmt(o.bad + o.warn)}</b> de ${fmt(o.total)} equipos no tienen la versión aprobada.`,
    n:o.bad + o.warn, lv:'crit' }));
  if (CMP.noAuthApps.length) {
    const eq = new Set(); CMP.dev.forEach((d, dev) => { if (d.noAuth.length) eq.add(dev); });
    riesgos.push({ t:'Se detectó software no autorizado',
      d:`<b>${fmt(CMP.noAuthApps.length)}</b> aplicaciones que no están en la lista aprobada aparecen en <b>${fmt(eq.size)}</b> equipos.`,
      n:eq.size, lv:'crit' });
  }
  if (CMP.stale.size) riesgos.push({ t:'Equipos sin contacto reciente',
    d:`<b>${fmt(CMP.stale.size)}</b> equipos llevan más de ${CFG.params.syncDias} días sin reportar su inventario, así que su información puede estar desactualizada.`,
    n:CMP.stale.size, lv:'warn' });
  CMP.appList.filter(o => o.bad > 0 && !(rule(o.key) || {}).crit).slice(0, 3).forEach(o => riesgos.push({
    t:`${pretty(nameOfApp(o.key))} por debajo del mínimo`,
    d:`<b>${fmt(o.bad)}</b> equipos tienen una versión anterior a la mínima aceptada.`, n:o.bad, lv:'warn' }));
  riesgos.sort((a,b) => (a.lv === b.lv ? b.n - a.n : a.lv === 'crit' ? -1 : 1));

  /* recomendaciones accionables */
  const recs = [];
  if (CMP.critApps.length) recs.push({ t:'Priorizar las aplicaciones críticas',
    d:`Desplegar la versión aprobada de <b>${CMP.critApps.slice(0,3).map(o => esc(pretty(nameOfApp(o.key)))).join('</b>, <b>')}</b>. ` +
      `Es el grupo con mayor impacto en la seguridad del parque.` });
  if (CMP.noAuthApps.length) recs.push({ t:'Retirar el software no autorizado',
    d:`Desinstalar las <b>${fmt(CMP.noAuthApps.length)}</b> aplicaciones fuera de la lista aprobada y revisar por qué se instalaron.` });
  if (CMP.stale.size) recs.push({ t:'Recuperar los equipos sin contacto',
    d:`Verificar la conectividad y el agente de inventario en <b>${fmt(CMP.stale.size)}</b> equipos que no reportan desde hace más de ${CFG.params.syncDias} días.` });
  if (A.debt.length) recs.push({ t:'Unificar versiones en las aplicaciones más dispersas',
    d:`<b>${fmt(A.debt.length)}</b> aplicaciones conviven en varias versiones. Estandarizar las ${Math.min(5, A.debt.length)} principales reduce el ` +
      `esfuerzo de soporte y la superficie de riesgo.` });
  if (t.warn) recs.push({ t:'Cerrar la brecha de los equipos en ámbar',
    d:`<b>${fmt(t.warn)}</b> equipos están cerca del objetivo: les falta una actualización para pasar a verde. ` +
      `Es la vía más rápida para subir el indicador general.` });
  if (!recs.length) recs.push({ t:'Mantener el ritmo actual',
    d:'El parque cumple con el estándar definido. Conviene revisar los umbrales para seguir elevando el nivel de exigencia.' });

  const hs = HIST.filter(h => (h.org || '') === (CFG.org || ''));
  const trend = hs.length > 1
    ? trendMulti(hs.map(h => h.fecha.slice(5)), [{ n:'% de cumplimiento', c:'var(--bar)', v: hs.map(h => h.k.pctOk), fill:true }],
        { unit:' %', aria:'Evolución del cumplimiento' })
    : '';

  return `<div class="rep">
    <div class="rep-cover">
      <div class="eyebrow">Informe de gestión de software</div>
      <h1>${esc(org)}</h1>
      <p>Estado del software instalado en los equipos de la organización a fecha de <b>${esc(periodo)}</b>.
         Este informe resume qué programas están al día, cuáles necesitan atención y qué conviene hacer a continuación.</p>
      <div class="rep-score">
        <div><div class="rep-score-n" style="color:${col}">${fmt1(t.pctOk)}%</div>
          <div class="mini" style="margin-top:4px">de los equipos al día</div></div>
        <div class="rep-score-b">
          <div class="row" style="margin-bottom:9px"><b style="color:${col};font-size:15px">${nivelTxt}</b>
            ${p ? `<span class="spacer"></span>${delta(t.pctOk, p.k.pctOk, true, ' pts')} <span class="mini">desde ${esc(p.fecha)}</span>` : ''}</div>
          ${cbar(t)}
          <div class="rep-legend">
            <span class="sem ok">${fmt(t.ok)} equipos al día</span>
            <span class="sem warn">${fmt(t.warn)} necesitan revisión</span>
            <span class="sem bad">${fmt(t.bad)} requieren acción</span>
          </div>
        </div>
      </div>
    </div>

    <div class="g3">
      ${kpi({ ic:'pc', label:'Equipos supervisados', value: fmt(A.nDev), sub:'Incluidos en esta revisión' })}
      ${kpi({ ic:'grid', label:'Programas distintos', value: fmt(A.nApp), sub:`De <b>${fmt(A.nVendor)}</b> proveedores` })}
      ${kpi({ ic:'layers', label:'Equipos con algo desactualizado', value: fmt(A.devLag.size),
        sub:`<b>${fmt1(pct(A.devLag.size, A.nDev))} %</b> del total`, st: pct(A.devLag.size,A.nDev)>50?'warn':undefined })}
      ${kpi({ ic:'star', label:'Programas prioritarios', value: fmt(Object.values(CFG.apps).filter(r => r.crit).length),
        sub: CMP.critApps.length ? `<b>${fmt(CMP.critApps.length)}</b> con incidencias` : 'Todos al día',
        st: CMP.critApps.length ? 'crit' : 'ok' })}
    </div>

    <div class="rep-sec">Principales puntos de atención<span></span></div>
    <div class="alerts">${riesgos.slice(0, 5).map(r =>
      `<div class="alert ${r.lv}"><div class="alert-ic">${ico(r.lv === 'crit' ? 'alert' : 'info')}</div>
        <div class="alert-b"><div class="alert-t">${esc(r.t)}</div><div class="alert-d">${r.d}</div></div></div>`).join('')
      || `<div class="alert ok"><div class="alert-ic">${ico('check')}</div><div class="alert-b">
        <div class="alert-t">Sin puntos de atención</div>
        <div class="alert-d">No se detectaron riesgos relevantes en esta revisión.</div></div></div>`}</div>

    ${trend ? `<div class="rep-sec">Cómo ha evolucionado<span></span></div>
      <div class="card">${trend}
      <p class="mini" style="margin-top:10px">Porcentaje de equipos que cumplen el estándar en cada revisión realizada.</p></div>` : ''}

    <div class="rep-sec">Qué recomendamos hacer<span></span></div>
    <div class="sheet">${recs.slice(0, 5).map((r, i) =>
      `<div class="rec"><div class="rec-n">${i+1}</div><div class="rec-b">
        <div class="rec-t">${esc(r.t)}</div><div class="rec-d">${r.d}</div></div></div>`).join('')}</div>

    <div class="rep-sec">Resumen de programas<span></span></div>
    <div class="mt-wrap"><div class="mt-scroll" style="max-height:460px"><table class="mt">
      <thead><tr><th>Programa</th><th>Proveedor</th><th class="n">Equipos</th>
        <th style="width:170px">Estado del parque</th><th class="n">Al día</th><th>Situación</th></tr></thead>
      <tbody>${CMP.appList.slice(0, 25).map(o => `<tr>
        <td class="name">${esc(appLabel(o.key))}</td>
        <td>${esc(pretty(vendorOfApp(o.key)))}</td>
        <td class="n">${fmt(o.total)}</td>
        <td>${cbar(o, true)}</td>
        <td class="n">${fmt1(o.pctOk)} %</td>
        <td>${semaforo(o.estado)}</td></tr>`).join('')}</tbody>
    </table></div></div>
    <p class="mini" style="margin-top:14px;text-align:center">
      Informe generado el ${new Date().toLocaleDateString('es-CO',{day:'numeric',month:'long',year:'numeric'})} ·
      ${fmt(A.n)} registros analizados · Datos procesados localmente
    </p>
  </div>`;
}

/* ============================================================================
   23. VISTA · ADMINISTRACION
   ========================================================================== */
function vAdmin(A, rows) {
  const autos = Object.values(CFG.apps).filter(r => r.auto).length;
  const total = Object.keys(CFG.apps).length;
  const data = A.topApps.map(([k, n]) => {
    const r = CFG.apps[k] || {};
    return { key:k, name: appLabel(k), vendor: pretty(vendorOfApp(k)), inst:n,
      cat:r.cat || 'Otro', min:r.min || '', rec:r.rec || '', crit:r.crit?1:0,
      gest:r.gest?1:0, estado:r.estado || 'permitida', auto:r.auto?1:0,
      detect: M.latestVer.get(k) || '' };
  });
  const P = CFG.params;

  return viewHead('Administración', 'Aquí se define el estándar contra el que se mide todo el tablero. Los cambios se guardan en este navegador y se aplican al recalcular.') +
    `<div class="banner" style="margin-top:16px">${ico('info')}<div>
      <b>Cómo funciona.</b> Al cargar un inventario el sistema <b>propone</b> un estándar por aplicación:
      la <b>versión aprobada</b> es la más nueva que ya tiene al menos la mitad del parque, y la <b>mínima</b> la que
      cubre el 90&nbsp;%. Se hace así a propósito: aprobar siempre la versión más alta detectada dejaría el parque
      entero en rojo el primer día, porque casi ningún equipo está al máximo en todas sus aplicaciones.
      Si prefieres el criterio estricto, usa «Aprobar la versión más alta detectada».
      Las propuestas se marcan con ◇ y se refrescan en cada carga; <b>en cuanto editas una fila deja de ser
      automática</b> y se respeta tal cual. Ahora mismo hay <b>${fmt(autos)}</b> de <b>${fmt(total)}</b> sin revisar.
    </div></div>` +
    `<div class="adm-grid">
      <div class="card"><div class="card-h"><div><h3>Organización y umbrales</h3>
        <p>Se usan en el informe para cliente y en los semáforos</p></div></div>
        <div style="margin-top:14px">
          <div class="fld"><label for="cfgOrg">Nombre del cliente u organización</label>
            <input id="cfgOrg" data-cfg="org" type="text" value="${esc(CFG.org)}" placeholder="Ej. Grupo Financiero XYZ">
            <span class="hint">Aparece en la portada del informe ejecutivo. El histórico se guarda por organización.</span></div>
          <div class="fld"><label for="cfgSync">Días sin reportar para marcar un equipo</label>
            <input id="cfgSync" data-cfg="params.syncDias" type="number" min="1" max="365" value="${P.syncDias}">
            <span class="hint">Un equipo que supere este umbral pasa a ámbar aunque su software esté al día.</span></div>
          <div class="fld"><label for="cfgOk">Cumplimiento mínimo para el verde (%)</label>
            <input id="cfgOk" data-cfg="params.umbralOk" type="number" min="1" max="100" value="${P.umbralOk}"></div>
          <div class="fld"><label for="cfgWarn">Cumplimiento mínimo para el ámbar (%)</label>
            <input id="cfgWarn" data-cfg="params.umbralWarn" type="number" min="1" max="100" value="${P.umbralWarn}"></div>
          <div class="fld"><label for="cfgAlcance">Alcance del cumplimiento</label>
            <select id="cfgAlcance" data-cfg="params.alcance">
              <option value="gestionadas"${P.alcance !== 'todas' ? ' selected' : ''}>Solo aplicaciones administradas, críticas y no permitidas</option>
              <option value="todas"${P.alcance === 'todas' ? ' selected' : ''}>Todo el catálogo detectado</option>
            </select>
            <span class="hint">Un equipo corporativo lleva decenas de librerías y controladores. Exigir que todos
            estén en la última versión convierte el indicador en ruido, así que por defecto solo puntúa lo que
            realmente gobiernas.</span></div>
          <div class="fld"><label for="cfgGest">Cobertura para proponer «administrada» (%)</label>
            <input id="cfgGest" data-cfg="params.coberturaGestionada" type="number" min="1" max="100" value="${P.coberturaGestionada}">
            <span class="hint">Una aplicación presente en al menos este porcentaje del parque se propone como administrada.</span></div>
        </div>
      </div>
      <div class="card"><div class="card-h"><div><h3>Acciones sobre el catálogo</h3>
        <p>Operaciones en bloque para no editar fila por fila</p></div></div>
        <div class="stack" style="margin-top:14px;gap:10px">
          <button class="btn" data-adm="reseed">Volver a proponer estándares desde los datos</button>
          <span class="hint">Recalcula versión aprobada y mínima <b>solo</b> en las reglas automáticas. No toca lo que hayas editado.</span>
          <button class="btn" data-adm="approve-latest">Aprobar la versión más alta detectada en todas</button>
          <span class="hint">Fija la versión aprobada al máximo observado en todo el catálogo, incluidas las reglas editadas.</span>
          <button class="btn" data-adm="mark-managed">Marcar como administradas las de cobertura ≥ ${P.coberturaGestionada}&nbsp;%</button>
          <div style="height:6px"></div>
          <button class="btn" data-adm="export">Exportar configuración (JSON)</button>
          <button class="btn" data-adm="import">Importar configuración</button>
          <span class="hint">Lleva el mismo estándar a otro equipo o guárdalo con el proyecto.</span>
          <div style="height:6px"></div>
          <button class="btn" data-adm="reset" style="border-color:rgba(208,59,59,.45);color:var(--crit-ink)">Borrar todas las reglas</button>
        </div>
      </div>
      <div class="card"><div class="card-h"><div><h3>Integración con Microsoft Intune</h3>
        <p>Estado de la arquitectura de datos</p></div></div>
        <div style="margin-top:14px;font-size:12.5px;color:var(--ink-3);line-height:1.65">
          <p style="margin:0 0 10px">Ahora mismo la fuente de datos es un <b>archivo exportado</b> (Excel o CSV) que se
          procesa íntegramente en el navegador. La capa de lectura está aislada del resto: el modelo interno
          (equipos, aplicaciones, versiones, fechas) es el mismo que produciría Microsoft Graph.</p>
          <p style="margin:0 0 10px">Para conectar con Intune en vivo hace falta un <b>backend</b>: Graph exige un
          <i>client secret</i> o un certificado, y eso no puede vivir en una página. El backend autentica contra
          Entra ID, consulta <code>deviceManagement/detectedApps</code> y <code>managedDevices</code>, y entrega el
          mismo modelo que hoy produce el lector de archivos.</p>
          <p style="margin:0"><b>Lo que ya está preparado:</b> el estándar, el motor de cumplimiento, el histórico y
          todas las vistas son independientes del origen de los datos. Al conectar Graph no cambia nada de esto.</p>
        </div>
      </div>
    </div>` +
    sec('Estándar por aplicación', 'Versión aprobada, versión mínima, criticidad y permisos. Edita directamente en la tabla.') +
    mtable({ id:'adm', title:'Catálogo de estándares',
      sub:'Los cambios se guardan al salir de cada campo',
      data, sort:{ k:'inst', d:-1 }, rowAttr: () => '',
      cols:[{ k:'name', l:'Aplicación', cls:'name' }, { k:'vendor', l:'Fabricante' },
        { k:'inst', l:'Equipos', n:true }, { k:'detect', l:'Máx. detectada' },
        { k:'rec', l:'Versión aprobada', w:'150px' }, { k:'min', l:'Versión mínima', w:'150px' },
        { k:'cat', l:'Categoría' }, { k:'crit', l:'Crítica' },
        { k:'gest', l:'Administrada' }, { k:'estado', l:'Permitida' }],
      cell:(r,c) => {
        const K = esc(r.key);
        switch (c.k) {
          case 'name': return (r.auto ? '<span title="Regla propuesta automáticamente" class="muted">◇ </span>' : '') + esc(r.name);
          case 'detect': return `<span class="mono mini">${esc(r.detect || '—')}</span>`;
          case 'rec': case 'min':
            return `<input class="cell mono" data-rule="${K}|${c.k}" value="${esc(r[c.k])}" placeholder="—" aria-label="${c.l}">`;
          case 'cat':
            return `<select class="cell" data-rule="${K}|cat" aria-label="Categoría">` +
              CATS.map(x => `<option${x === r.cat ? ' selected' : ''}>${esc(x)}</option>`).join('') + '</select>';
          case 'crit':
            return `<label class="chk"><input type="checkbox" data-rule="${K}|crit"${r.crit ? ' checked' : ''} aria-label="Aplicación crítica"></label>`;
          case 'gest':
            return `<label class="chk"><input type="checkbox" data-rule="${K}|gest"${r.gest ? ' checked' : ''} aria-label="Administrada"></label>`;
          case 'estado':
            return `<select class="cell" data-rule="${K}|estado" aria-label="Permitida">` +
              `<option value="permitida"${r.estado === 'permitida' ? ' selected' : ''}>Permitida</option>` +
              `<option value="no-permitida"${r.estado === 'no-permitida' ? ' selected' : ''}>No permitida</option></select>`;
          default: return c.n ? fmt(r[c.k]) : esc(r[c.k]);
        }
      },
      foot:`<span style="margin-left:auto;color:var(--ink-4)">◇ = propuesta automática · al editar pasa a ser tuya</span>` });
}

/* ---- registro de vistas ---- */
const VIEWS = {
  resumen:      { l:'Resumen',       ic:'home',    f:vResumen,      cli:true },
  cumplimiento: { l:'Cumplimiento',  ic:'shieldOk',f:vCumplimiento },
  aplicaciones: { l:'Aplicaciones',  ic:'grid',    f:vAplicaciones },
  equipos:      { l:'Equipos',       ic:'pc',      f:vEquipos },
  versiones:    { l:'Versiones',     ic:'fork',    f:vVersiones },
  tendencias:   { l:'Tendencias',    ic:'trend',   f:vTendencias,   cli:true },
  mapas:        { l:'Mapas',         ic:'map',     f:vMapas },
  informe:      { l:'Informe cliente', ic:'file',  f:vInforme,      cli:true },
  admin:        { l:'Administración',ic:'cog',     f:vAdmin }
};
