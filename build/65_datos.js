
/* ============================================================================
   24. ORIGEN DE DATOS  ·  consultas KQL y conexion con Microsoft Defender
   ----------------------------------------------------------------------------
   La consola limita las filas por exportacion, asi que un parque grande no cabe
   en una descarga. Aqui se generan las consultas que si caben y, si se registra
   una aplicacion en Entra ID, se ejecutan directamente contra Advanced Hunting.

   La autenticacion es flujo de codigo con PKCE: la pagina nunca guarda un
   secreto, el token se emite al usuario que inicia sesion y vive en
   sessionStorage. El identificador de aplicacion y el de directorio NO son
   secretos: van en el codigo de cualquier aplicacion de pagina unica.
   ========================================================================== */
const GRAPH_SCOPES = 'https://graph.microsoft.com/ThreatHunting.Read.All offline_access openid profile';
const TOK_KEY = 'invapp.tok', PKCE_KEY = 'invapp.pkce';

/* ---- 24.1 generacion de KQL -------------------------------------------- */
const kqlEsc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Filtro de equipos comun a las tres consultas, editable por el administrador. */
function kqlFiltro() {
  const f = (CFG.kql && CFG.kql.filtro) != null ? CFG.kql.filtro : '| where DeviceType == "Workstation"';
  return f.trim();
}
/** Numero de lotes y lote actual, compartidos por las tres consultas. */
const loteN = () => Math.max(1, Math.min(64, (CFG.kql && +CFG.kql.lotes) || 1));
const loteI = () => Math.max(0, Math.min(loteN() - 1, (CFG.kql && +CFG.kql.lote) || 0));
/**
 * El troceado va dentro del bloque de equipos, no de la tabla de software: asi
 * las tres consultas parten el parque por el mismo criterio y el lote 3 del
 * catalogo cubre exactamente los mismos equipos que el lote 3 del parque.
 */
const kqlTrozo = () => loteN() > 1 ? `\n    | where hash(DeviceId, ${loteN()}) == ${loteI()}` : '';

const KQL_EQUIPOS = () =>
`let Equipos = DeviceInfo
    | summarize arg_max(Timestamp, *) by DeviceId
    | extend UserName   = tostring(parse_json(LoggedOnUsers)[0].UserName),
             DomainName = tostring(parse_json(LoggedOnUsers)[0].DomainName)
    | where isnotempty(DeviceName)
    ${kqlFiltro()}${kqlTrozo()}
    | project DeviceId, DeviceName, UserName, DomainName, OSDistribution, OSVersionInfo, SensorHealthState, Timestamp;`;

function kqlParque() {
  return KQL_EQUIPOS() + `
Equipos
| project DeviceName, UserName, DomainName, OSDistribution, OSVersionInfo, SensorHealthState, Timestamp`;
}

function kqlCatalogo() {
  return KQL_EQUIPOS() + `
DeviceTvmSoftwareInventory
| where isnotempty(SoftwareName)
| join kind=inner Equipos on DeviceId
| summarize Equipos = dcount(DeviceId)
  by SoftwareVendor, SoftwareName, SoftwareVersion, EndOfSupportStatus`;
}

/**
 * Instalaciones por debajo de la version aprobada. Tres alcances:
 *
 *   estandar  solo las aplicaciones que gobiernas (administradas y criticas)
 *   catalogo  todas las que tienen version aprobada en tu catalogo
 *   todas     todas las del inventario, calculando la version mas alta en KQL
 *
 * El tercero no lleva `datatable`: con miles de aplicaciones el literal haria
 * la consulta impracticable, asi que la referencia se calcula en el servidor.
 * A cambio es el criterio mas estricto y el que mas filas devuelve.
 */
const excAlcance = () => (CFG.kql && CFG.kql.alcanceExc) || 'estandar';

function excDatatable(soloEnAlcance) {
  const filas = [];
  Object.keys(CFG.apps || {}).forEach(k => {
    const r = CFG.apps[k];
    if (!r || !r.rec) return;
    if (soloEnAlcance && !inScope(k)) return;
    const nombre = k.indexOf(' / ') >= 0 ? k.slice(k.indexOf(' / ') + 3) : k;
    if (!nombre) return;
    filas.push(`  "${kqlEsc(nombre)}", "${kqlEsc(r.rec)}"`);
  });
  return filas;
}

function kqlExcepciones() {
  const modo = excAlcance();

  if (modo === 'todas') {
    // Version conservadora: sin arg_max sobre un valor de version, sin reusar un
    // `let` tabular sin materializar y sin columna Aprobada. El tablero calcula
    // igualmente la version de referencia, asi que esa columna no hacia falta.
    return KQL_EQUIPOS() + `
// La referencia es la version mas alta observada de cada aplicacion, calculada aqui.
// Es el criterio estricto: devuelve todo lo que no este al maximo.
let Instalado = materialize(
    DeviceTvmSoftwareInventory
    | where isnotempty(SoftwareName)
    | join kind=inner Equipos on DeviceId
    | extend V = parse_version(SoftwareVersion)
);
let MaxPorApp = Instalado
    | summarize MaxV = max(V) by SoftwareVendor, SoftwareName;
Instalado
| join kind=inner MaxPorApp on SoftwareVendor, SoftwareName
| where V < MaxV
| project DeviceName, UserName, SoftwareVendor, SoftwareName, SoftwareVersion,
          EndOfSupportStatus, OSVersionInfo, Timestamp`;
  }

  const filas = excDatatable(modo === 'estandar');
  if (!filas.length) return modo === 'estandar'
    ? '// Marca alguna aplicación como administrada o crítica en Administración\n' +
      '// y aquí aparecerá la consulta con tu estándar.\n' +
      '// O cambia el alcance a «todas las aplicaciones».'
    : '// Todavía no hay ninguna versión aprobada en el catálogo.\n' +
      '// Carga primero el catálogo agregado, o usa el alcance «todas».';
  return `let Estandar = datatable(SoftwareName:string, Aprobada:string) [
${filas.join(',\n')}
];
` + KQL_EQUIPOS() + `
DeviceTvmSoftwareInventory
| join kind=inner Equipos on DeviceId
| join kind=inner Estandar on SoftwareName
| extend V = parse_version(SoftwareVersion), A = parse_version(Aprobada)
| where V < A
| project DeviceName, UserName, SoftwareVendor, SoftwareName, SoftwareVersion, Aprobada,
          EndOfSupportStatus, OSVersionInfo, Timestamp`;
}

/** Detalle completo. El troceado lo pone el bloque de equipos. */
function kqlDetalle(lote, total) {
  const prev = CFG.kql && { lotes: CFG.kql.lotes, lote: CFG.kql.lote };
  CFG.kql = CFG.kql || {}; CFG.kql.lotes = total; CFG.kql.lote = lote;
  const q = KQL_EQUIPOS() + `
DeviceTvmSoftwareInventory
| where isnotempty(SoftwareName)
| join kind=inner Equipos on DeviceId
| project DeviceName, UserName, SoftwareVendor, SoftwareName, SoftwareVersion,
          EndOfSupportStatus, ProductCodeCpe, OSDistribution, OSVersionInfo, Timestamp`;
  if (prev) { CFG.kql.lotes = prev.lotes; CFG.kql.lote = prev.lote; }
  return q;
}

/**
 * Trocea una consulta en sus pasos para localizar cual falla. Se pega cada
 * bloque por separado en Advanced Hunting hasta dar con el que da error.
 */
function kqlDiagnostico() {
  const eq = KQL_EQUIPOS();
  return `// ============================================================
// PASO 1  ·  ¿funciona el bloque de equipos?
// ============================================================
${eq}
Equipos
| take 5

// ============================================================
// PASO 2  ·  ¿existe parse_version en tu entorno?
// ============================================================
print Prueba = parse_version("1.10.0") > parse_version("1.9.0")

// ============================================================
// PASO 3  ·  ¿funciona el cruce con el inventario?
// ============================================================
${eq}
DeviceTvmSoftwareInventory
| where isnotempty(SoftwareName)
| join kind=inner Equipos on DeviceId
| take 5

// ============================================================
// PASO 4  ·  ¿funciona el calculo de la version mas alta?
// ============================================================
${eq}
DeviceTvmSoftwareInventory
| where isnotempty(SoftwareName)
| join kind=inner Equipos on DeviceId
| extend V = parse_version(SoftwareVersion)
| summarize MaxV = max(V) by SoftwareVendor, SoftwareName
| take 5

// Pega los bloques de uno en uno. El primero que falle es el culpable.`;
}

/** Cuenta las filas que devolveria una consulta, sin exportarla. */
function kqlContar(q) {
  return String(q).replace(/\s+$/, '') + '\n| summarize Filas = count()';
}

const KQL = {
  parque:      { l: 'Parque de equipos', d: 'Una fila por equipo. Da el censo real, el usuario y la última sincronización.', f: kqlParque },
  catalogo:    { l: 'Catálogo agregado',  d: 'Una fila por aplicación y versión con el recuento de equipos. Cubre el 100 % del parque sin traer el detalle.', f: kqlCatalogo },
  excepciones: { l: 'Excepciones',        d: 'Las instalaciones por debajo de la versión aprobada. Es la lista de trabajo: qué equipo, qué aplicación y qué versión tiene.', f: kqlExcepciones }
};

/* ---- 24.2 autenticacion PKCE ------------------------------------------- */
const b64url = buf => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function randStr(n) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return b64url(a.buffer).slice(0, n);
}
const redirectUri = () => location.origin + location.pathname;

async function conectar() {
  const g = CFG.graph || {};
  if (!g.clientId || !g.tenantId) { toast('Faltan los identificadores de la aplicación'); return; }
  const verifier = randStr(64);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randStr(16);
  try { sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, vista: S.view })); }
  catch (e) { toast('El navegador bloquea el almacenamiento de sesión: no se puede iniciar sesión'); return; }
  const p = new URLSearchParams({
    client_id: g.clientId, response_type: 'code', redirect_uri: redirectUri(),
    response_mode: 'query', scope: GRAPH_SCOPES, state,
    code_challenge: challenge, code_challenge_method: 'S256'
  });
  location.href = `https://login.microsoftonline.com/${encodeURIComponent(g.tenantId)}/oauth2/v2.0/authorize?` + p;
}

/** Cierra el ciclo al volver del inicio de sesión. Devuelve un mensaje o null. */
async function completarLogin() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code'), err = q.get('error');
  if (!code && !err) return null;
  const limpio = () => history.replaceState(null, '', redirectUri() + location.hash);
  if (err) { limpio(); return 'Entra ID rechazó el inicio de sesión: ' + (q.get('error_description') || err); }
  let pk = null;
  try { pk = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null'); } catch (e) {}
  sessionStorage.removeItem(PKCE_KEY);
  if (!pk || pk.state !== q.get('state')) { limpio(); return 'La respuesta no coincide con la petición (state). Vuelve a intentarlo.'; }
  const g = CFG.graph || {};
  try {
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(g.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: g.clientId, grant_type: 'authorization_code', code,
        redirect_uri: redirectUri(), code_verifier: pk.verifier, scope: GRAPH_SCOPES })
    });
    const j = await res.json();
    limpio();
    if (!res.ok || !j.access_token)
      return 'No se pudo obtener el token: ' + (j.error_description || j.error || res.status);
    guardaToken(j);
    return null;
  } catch (e) { limpio(); return 'Error de red al pedir el token: ' + e.message; }
}
function guardaToken(j) {
  const t = { access: j.access_token, refresh: j.refresh_token || '',
              exp: Date.now() + ((+j.expires_in || 3600) - 120) * 1000 };
  try { sessionStorage.setItem(TOK_KEY, JSON.stringify(t)); } catch (e) {}
  return t;
}
function leeToken() {
  try { return JSON.parse(sessionStorage.getItem(TOK_KEY) || 'null'); } catch (e) { return null; }
}
const conectado = () => { const t = leeToken(); return !!(t && t.access && t.exp > Date.now()); };

async function tokenValido() {
  let t = leeToken();
  if (t && t.access && t.exp > Date.now()) return t.access;
  if (t && t.refresh) {
    const g = CFG.graph || {};
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(g.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: g.clientId, grant_type: 'refresh_token',
        refresh_token: t.refresh, scope: GRAPH_SCOPES })
    });
    const j = await res.json();
    if (res.ok && j.access_token) return guardaToken(j).access;
  }
  throw new Error('La sesión ha caducado. Vuelve a conectar.');
}
function desconectar() { try { sessionStorage.removeItem(TOK_KEY); } catch (e) {} toast('Sesión cerrada'); render(); }

/* ---- 24.3 consulta contra Advanced Hunting ------------------------------ */
/**
 * Ejecuta un KQL. La forma exacta de la respuesta no la he podido observar
 * contra un tenant real, asi que se aceptan las dos convenciones de mayusculas
 * que documenta Graph y, si llega otra cosa, se devuelve el cuerpo tal cual
 * para poder verlo en pantalla en vez de fallar en silencio.
 */
async function huntingQuery(kql) {
  const tok = await tokenValido();
  const res = await fetch('https://graph.microsoft.com/v1.0/security/runHuntingQuery', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Query: kql })
  });
  const txt = await res.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  if (!res.ok) {
    const m = j && j.error ? (j.error.message || j.error.code) : txt.slice(0, 300);
    throw new Error('Graph respondió ' + res.status + ': ' + m);
  }
  const filas = (j && (j.results || j.Results)) || null;
  if (!Array.isArray(filas))
    throw new Error('Respuesta inesperada de Graph. Cuerpo recibido: ' + txt.slice(0, 400));
  return filas;
}
/** Convierte la respuesta (lista de objetos) en la cuadricula que lee el modelo. */
function filasAGrid(filas) {
  if (!filas.length) return [];
  const cols = [];
  for (const f of filas.slice(0, 50)) for (const k in f) if (cols.indexOf(k) < 0) cols.push(k);
  const grid = [cols];
  for (const f of filas) grid.push(cols.map(c => {
    const v = f[c];
    return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v);
  }));
  return grid;
}

/** Ejecuta las consultas elegidas y alimenta el modelo. */
async function traerDeDefender(cuales, lotes) {
  const panel = $('#gxLog');
  const log = m => { if (panel) panel.innerHTML += esc(m) + '<br>'; };
  let primera = true, totalFilas = 0;
  for (const id of cuales) {
    const def = KQL[id];
    const consultas = id === 'detalle'
      ? Array.from({ length: lotes }, (_, i) => ({ n: `detalle ${i + 1}/${lotes}`, q: kqlDetalle(i, lotes) }))
      : [{ n: def.l, q: (CFG.kql && CFG.kql[id]) || def.f() }];
    for (const c of consultas) {
      log('▸ ' + c.n + ': consultando…');
      const filas = await huntingQuery(c.q);
      log('   ' + fmt(filas.length) + ' filas recibidas');
      if (!filas.length) continue;
      const grid = filasAGrid(filas);
      const src = addSource(grid, c.n, '', primera);
      primera = false;
      totalFilas += filas.length;
      log('   fundido como «' + src.shape + '»');
    }
  }
  if (!totalFilas) throw new Error('Las consultas no devolvieron ninguna fila.');
  M.aggFull = aggregate(M.rows);
  M.effVer = effVersions(M.rows);
  seedCatalog();
  histSnapshot();
  log('✔ listo: ' + fmt(totalFilas) + ' filas en total');
  return totalFilas;
}


/* ---- 24.5 script de PowerShell -----------------------------------------
   Camino sin registrar ninguna aplicacion: el modulo oficial de Microsoft ya
   trae su propio registro multi-tenant, asi que el usuario solo inicia sesion.
   El script deja los CSV listos para soltarlos en el tablero.
   ------------------------------------------------------------------------ */
function scriptPowerShell(lotes, propia) {
  const q = s => String(s).replace(/\r/g, '');
  const bloques = [
    ['parque',      'Parque de equipos',  kqlParque()],
    ['catalogo',    'Catalogo agregado',  kqlCatalogo()],
    ['excepciones', 'Excepciones',        kqlExcepciones()]
  ];
  let cuerpo = '';
  for (const [id, titulo, kql] of bloques) {
    cuerpo += `
# ---------------------------------------------------------------- ${titulo}
$kql = @'
${q(kql)}
'@
Exportar -Nombre '${id}' -Titulo '${titulo}' -Kql $kql
`;
  }
  if (lotes > 0) {
    cuerpo += `
# ------------------------------------------------- Detalle completo por lotes
for ($i = 0; $i -lt ${lotes}; $i++) {
    $kql = @"
$(Plantilla -Lote $i)
"@
    Exportar -Nombre "detalle_$i" -Titulo "Detalle lote $($i + 1)/${lotes}" -Kql $kql
}
`;
  }
  const plantilla = lotes > 0 ? `
function Plantilla {
    param([int]$Lote)
    $t = @'
${q(kqlDetalle(0, lotes)).replace(/\$/g, '$$$$')}
'@
    return $t -replace 'hash\\(DeviceId, ${lotes}\\) == 0', "hash(DeviceId, ${lotes}) == $Lote"
}
` : '';

  return `<#
    Inventario de Aplicaciones - extraccion desde Microsoft Defender
    Generado el ${new Date().toLocaleString('es-CO')}${CFG.org ? ' para ' + CFG.org : ''}

    NO registra ninguna aplicacion en Entra ID. Usa el modulo oficial de
    Microsoft, que trae su propio registro, e inicia sesion con TU cuenta.

    Uso:
      1. Abre PowerShell (no hace falta como administrador).
      2. Ejecuta:  .\\extraer-defender.ps1
      3. Inicia sesion en la ventana que se abre.
      4. Arrastra los CSV de la carpeta 'salida' al tablero, todos a la vez.

    Si es la primera vez, un administrador debe consentir el permiso
    ThreatHunting.Read.All para Microsoft Graph PowerShell. El propio dialogo
    de inicio de sesion ofrece el boton de consentimiento.
#>

$ErrorActionPreference = 'Stop'
$Salida = Join-Path $PSScriptRoot 'salida'
if (-not (Test-Path $Salida)) { New-Item -ItemType Directory -Path $Salida | Out-Null }

# --- modulo: solo el de autenticacion, que es el ligero ---------------------
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
    Write-Host 'Instalando Microsoft.Graph.Authentication para el usuario actual...' -ForegroundColor Yellow
    Install-Module Microsoft.Graph.Authentication -Scope CurrentUser -Force -AllowClobber
}
Import-Module Microsoft.Graph.Authentication

Write-Host 'Iniciando sesion...' -ForegroundColor Cyan
${propia ? `# Registro propio con flujo de codigo de dispositivo: NO usa URI de
# redireccion, asi que sirve cuando la organizacion no permite anadirlas.
# La aplicacion debe tener Authentication > Allow public client flows = Yes.
$conexion = @{
    ClientId = '${kqlEsc((CFG.graph || {}).clientId || '')}'
    TenantId = '${kqlEsc((CFG.graph || {}).tenantId || '')}'
    Scopes   = 'ThreatHunting.Read.All'
    NoWelcome = $true
}
# El nombre del parametro cambio entre versiones del modulo
$p = (Get-Command Connect-MgGraph).Parameters
if     ($p.ContainsKey('UseDeviceCode'))           { $conexion.UseDeviceCode = $true }
elseif ($p.ContainsKey('UseDeviceAuthentication')) { $conexion.UseDeviceAuthentication = $true }
Write-Host 'Se abrira una pagina para que escribas el codigo que aparezca abajo.' -ForegroundColor Yellow
Connect-MgGraph @conexion` :
`Connect-MgGraph -Scopes 'ThreatHunting.Read.All' -NoWelcome`}
$ctx = Get-MgContext
Write-Host ("Conectado como {0} en {1}" -f $ctx.Account, $ctx.TenantId) -ForegroundColor Green

function Exportar {
    param([string]$Nombre, [string]$Titulo, [string]$Kql)
    Write-Host ("-> {0}: consultando..." -f $Titulo) -NoNewline
    try {
        $resp = Invoke-MgGraphRequest -Method POST \`
            -Uri 'https://graph.microsoft.com/v1.0/security/runHuntingQuery' \`
            -Body (@{ Query = $Kql } | ConvertTo-Json -Depth 4 -Compress) \`
            -ContentType 'application/json'
    } catch {
        Write-Host ''
        Write-Host ("   ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
        return
    }
    $filas = $resp.results
    if (-not $filas -or $filas.Count -eq 0) { Write-Host ' sin filas' -ForegroundColor DarkYellow; return }
    $ruta = Join-Path $Salida ("{0}.csv" -f $Nombre)
    $filas | ForEach-Object { [PSCustomObject]$_ } | Export-Csv -Path $ruta -NoTypeInformation -Encoding UTF8
    Write-Host (" {0} filas -> {1}" -f $filas.Count, (Split-Path $ruta -Leaf)) -ForegroundColor Green
}
${plantilla}${cuerpo}
Write-Host ''
Write-Host ("Listo. Archivos en: {0}" -f $Salida) -ForegroundColor Cyan
Write-Host 'Arrastralos TODOS a la vez sobre el tablero: se funden en un solo modelo.' -ForegroundColor Cyan
Disconnect-MgGraph | Out-Null
`;
}

/* ---- 24.4 vista --------------------------------------------------------- */
function vDatos(A, rows) {
  const g = CFG.graph || {};
  const listo = !!(g.clientId && g.tenantId);
  const on = conectado();
  const sel = (CFG.kql && CFG.kql.ver) || 'catalogo';
  const texto = (CFG.kql && CFG.kql[sel]) || (KQL[sel] ? KQL[sel].f() : '');

  const fuentes = M.sources.length ? `<div class="mt-wrap"><div class="mt-scroll"><table class="mt">
      <thead><tr><th>Archivo</th><th>Forma</th><th class="n">Filas</th><th class="n">Equipos</th>
        <th>Estado</th><th style="width:46px"></th></tr></thead>
      <tbody>${M.sources.map((s, i) => `<tr>
        <td class="name">${esc(s.name)}</td>
        <td><span class="pill ${s.shape === 'detalle' ? 'y' : 'n'}">${esc(s.shape)}</span></td>
        <td class="n">${fmt(s.filas)}</td><td class="n">${s.equipos ? fmt(s.equipos) : '—'}</td>
        <td>${s.truncado && s.truncado.length
          ? `<span class="sem sem-pill bad">Parece cortado</span>`
          : `<span class="sem sem-pill ok">Completo</span>`}</td>
        <td><button class="tbtn" data-rmsrc="${i}" title="Quitar este archivo del modelo"
              style="color:var(--crit-ink);border-color:rgba(208,59,59,.35)">Quitar</button></td></tr>`).join('')}</tbody>
    </table></div>
    <div class="dt-foot"><span>${fmt(M.sources.length)} archivo${M.sources.length > 1 ? 's' : ''} ·
      <b>${fmt(M.rows.length)}</b> filas · <b>${fmt(M.devInfo.size)}</b> equipos con ficha</span>
      <button class="btn" data-rmsrc="todas" style="margin-left:auto">Quitar todos</button>
      <button class="btn btn-p" data-load="add">Añadir archivo</button></div></div>`
    : `<div class="mt-wrap"><div class="empty" style="padding:26px">Todavía no has cargado ningún archivo</div>
       <div class="dt-foot"><button class="btn btn-p" data-load="add" style="margin-left:auto">Añadir archivo</button></div></div>`;

  return viewHead('Origen de datos',
    'De dónde salen los números: los archivos cargados, las consultas que los producen y la conexión directa con Defender.') +
    sec('Fuentes cargadas', 'Se funden entre sí: parque, catálogo y excepciones forman un solo modelo. Puedes quitar el que hayas cargado por error') +
    fuentes +
    '<div id="anclaConsultas"></div>' +
    sec('Consultas', 'Generadas desde tu estándar. Pégalas en Advanced Hunting o ejecútalas desde aquí') +
    `<div class="banner" style="margin-bottom:16px">${ico('info')}<div>
      <b>Empieza por el catálogo.</b> La consulta de excepciones compara contra la versión aprobada, y esa
      versión sale de los datos que ya tengas cargados. Si el estándar se calculó sobre una muestra pequeña,
      apuntará demasiado alto y las excepciones serán medio parque.
      El orden que funciona es: <b>parque → catálogo → cargar ambos → volver aquí</b>, y solo entonces
      generar las excepciones. Con el estándar ya recalculado sobre el parque real, suelen caber sin trocear.
    </div></div>`+
    `<div class="card">
      <div class="row" style="margin-bottom:12px">
        ${Object.keys(KQL).map(k => `<button class="tbtn" data-kql="${k}" aria-pressed="${k === sel}">${esc(KQL[k].l)}</button>`).join('')}
        <span class="spacer"></span>
        <button class="btn" data-kqlact="contar" title="Genera una variante que solo devuelve el número de filas">Contar filas</button>
        <button class="btn" data-kqlact="diagnostico" title="Trocea la consulta en pasos para localizar cuál falla">Diagnóstico</button>
        <button class="btn" data-kqlact="copiar">Copiar</button>
        <button class="btn" data-kqlact="restaurar">Restaurar</button>
      </div>
      <div class="row" style="margin-bottom:12px;padding:9px 12px;border:1px solid var(--line);
           border-radius:9px;background:var(--surface-2)">
        <span class="mini" style="color:var(--ink-2);font-weight:600">Dividir en lotes</span>
        <input type="number" min="1" max="64" value="${loteN()}" data-cfg="kql.lotes"
               style="width:72px;background:var(--surface-1);border:1px solid var(--line);border-radius:7px;
                      padding:5px 8px;font-size:12.5px;color:var(--ink)">
        ${loteN() > 1 ? `
          <button class="btn" data-lote="-1" style="padding:5px 11px">◀</button>
          <b class="mono" style="min-width:96px;text-align:center">Lote ${loteI() + 1} de ${loteN()}</b>
          <button class="btn" data-lote="1" style="padding:5px 11px">▶</button>
          <span class="mini">Exporta uno, avanza y repite. Súbelos todos juntos al tablero.</span>`
        : `<span class="mini">Si la consola dice que superas el límite de 100.000 filas, sube este número.</span>`}
      </div>
      <p class="mini" style="margin:0 0 10px">${esc(KQL[sel] ? KQL[sel].d : '')}</p>
      ${sel === 'excepciones' ? `
      <div class="row" style="margin-bottom:12px;padding:9px 12px;border:1px solid var(--line);
           border-radius:9px;background:var(--surface-2)">
        <span class="mini" style="color:var(--ink-2);font-weight:600">Aplicaciones incluidas</span>
        <select class="fsel" data-cfg="kql.alcanceExc" style="max-width:none">
          <option value="estandar"${excAlcance() === 'estandar' ? ' selected' : ''}>Solo las que gobiernas (${fmt(excDatatable(true).length)})</option>
          <option value="catalogo"${excAlcance() === 'catalogo' ? ' selected' : ''}>Todas las de mi catálogo (${fmt(excDatatable(false).length)})</option>
          <option value="todas"${excAlcance() === 'todas' ? ' selected' : ''}>Todas las del inventario</option>
        </select>
        <span class="mini">${excAlcance() === 'todas'
          ? 'La versión aprobada se calcula en la consulta: la más alta detectada de cada aplicación. Es el criterio estricto y devuelve muchas más filas — usa «Contar filas» antes de exportar.'
          : excAlcance() === 'catalogo'
          ? 'Usa tu estándar editado para todas las aplicaciones que tengan versión aprobada.'
          : 'Solo las administradas, críticas y no permitidas.'}</span>
      </div>` : ''}
      <textarea id="kqlBox" data-kqlsave="${sel}" spellcheck="false"
        style="width:100%;min-height:230px;background:var(--surface-2);border:1px solid var(--line);
               border-radius:9px;padding:12px;font-family:ui-monospace,Consolas,monospace;font-size:12px;
               color:var(--ink);line-height:1.55;resize:vertical">${esc(texto)}</textarea>
      <div class="fld" style="margin-top:12px">
        <label for="kqlFiltro">Filtro de equipos (se inserta en las tres consultas)</label>
        <input id="kqlFiltro" data-cfg="kql.filtro" value="${esc(kqlFiltro())}"
               placeholder='| where DeviceType == "Workstation"'>
        <span class="hint">Aquí van tus condiciones: tipo de dispositivo, dominio, grupo de equipos.
          <b>No pongas <code>sort by</code></b>: si la exportación se corta, el recorte caerá siempre en el
          mismo tramo del alfabeto y el análisis saldrá sesgado.</span>
      </div>
    </div>` +
    '<div id="anclaConexion"></div>' +
    sec('Extraer con tu cuenta', 'Sin registrar ninguna aplicación: el módulo oficial de Microsoft ya trae la suya') +
    `<div class="adm-grid">
      <div class="card"><div class="card-h"><div><h3>Script de PowerShell</h3>
        <p>Un comando, inicias sesión y deja los CSV listos</p></div></div>
        <div style="margin-top:14px;font-size:12.5px;color:var(--ink-3);line-height:1.65">
          <p style="margin:0 0 12px">El script usa <b>Microsoft.Graph.Authentication</b>, el módulo oficial.
          Ese módulo <b>ya está registrado por Microsoft</b>, así que no creas ninguna aplicación en Entra:
          solo inicias sesión con tu cuenta de siempre. Lanza tus tres consultas y escribe los CSV en una
          carpeta <code>salida</code>, que arrastras aquí de una vez.</p>
          <label class="chk" style="margin-bottom:12px">
            <input type="checkbox" id="psPropia"${(CFG.graph || {}).clientId ? '' : ' disabled'}>
            Usar mi propio registro de aplicación${(CFG.graph || {}).clientId ? '' : ' (rellena antes los identificadores abajo)'}
          </label>
          <p class="mini" style="margin:-6px 0 12px">Con código de dispositivo: <b>no usa URI de redirección</b>,
            así que sirve aunque tu organización no permita añadirlas. La app necesita
            <i>Authentication → Allow public client flows → Yes</i>.</p>
          <div class="fld"><label for="psLotes">Lotes del detalle completo (0 = no traerlo)</label>
            <input id="psLotes" type="number" min="0" max="64" value="0">
            <span class="hint">Solo si necesitas el inventario crudo. Con tu parque son ~1,3 millones de filas:
              tráelo acotado a un grupo con el filtro de arriba.</span></div>
          <button class="btn btn-p" data-gx="ps">Descargar extraer-defender.ps1</button>
        </div>
      </div>
      <div class="card"><div class="card-h"><div><h3>Qué hace, paso a paso</h3>
        <p>Para que no ejecutes nada a ciegas</p></div></div>
        <ol style="margin:14px 0 0;padding-left:20px;font-size:12.5px;color:var(--ink-3);line-height:1.8">
          <li>Instala el módulo de autenticación de Microsoft si no lo tienes (solo para tu usuario).</li>
          <li>Abre la ventana de inicio de sesión de Microsoft. <b>Tus credenciales no pasan por el script</b>.</li>
          <li>Lanza las consultas contra <code>security/runHuntingQuery</code>.</li>
          <li>Guarda un CSV por consulta y cierra la sesión.</li>
        </ol>
        <div class="banner" style="margin:14px 0 0">${ico('shield')}<div>
          La primera vez, un administrador debe consentir el permiso <b>ThreatHunting.Read.All</b>
          para Microsoft Graph PowerShell. El propio diálogo de inicio de sesión ofrece el botón.
          No es un registro de aplicación: es aprobar una que ya existe.
        </div></div>
      </div>
    </div>` +
    sec('Conexión desde la página', 'Opción avanzada: requiere registrar una aplicación en Entra ID') +
    `<div class="banner" style="margin-bottom:16px">${ico('info')}<div>
      <b>Esto sí exige un registro.</b> Para que una página web reciba un token, Entra ID necesita saber
      qué aplicación lo pide y a qué dirección puede devolverlo; si no, cualquier web podría pedir tokens
      para tu tenant. No hay forma de saltárselo. Si prefieres no registrar nada, usa el script de arriba:
      hace exactamente lo mismo.
    </div></div>`+
    `<div class="adm-grid">
      <div class="card"><div class="card-h"><div><h3>Registro de la aplicación</h3>
        <p>Un formulario de cinco minutos en Entra ID. Ninguno de estos valores es secreto</p></div></div>
        <div style="margin-top:14px">
          <div class="fld"><label for="gxClient">Application (client) ID</label>
            <input id="gxClient" data-cfg="graph.clientId" value="${esc(g.clientId || '')}"
                   placeholder="00000000-0000-0000-0000-000000000000" spellcheck="false"></div>
          <div class="fld"><label for="gxTenant">Directory (tenant) ID</label>
            <input id="gxTenant" data-cfg="graph.tenantId" value="${esc(g.tenantId || '')}"
                   placeholder="00000000-0000-0000-0000-000000000000" spellcheck="false"></div>
          <div class="fld"><label>URI de redirección que debes registrar</label>
            <input value="${esc(redirectUri())}" readonly onclick="this.select()"
                   style="color:var(--brand)"></div>
          <div class="row">
            ${on ? `<button class="btn" data-gx="salir">Cerrar sesión</button>
                    <span class="sem ok">Conectado</span>`
                 : `<button class="btn btn-p" data-gx="entrar"${listo ? '' : ' disabled style="opacity:.5"'}>Conectar con Defender</button>
                    <span class="sem off">${listo ? 'Sin conectar' : 'Faltan los identificadores'}</span>`}
          </div>
        </div>
      </div>
      <div class="card"><div class="card-h"><div><h3>Traer datos</h3>
        <p>Elige qué consultas ejecutar; la página funde el resultado</p></div></div>
        <div style="margin-top:14px">
          <label class="chk" style="margin-bottom:8px"><input type="checkbox" id="gxParque" checked> Parque de equipos</label><br>
          <label class="chk" style="margin-bottom:8px"><input type="checkbox" id="gxCatalogo" checked> Catálogo agregado</label><br>
          <label class="chk" style="margin-bottom:12px"><input type="checkbox" id="gxExcepciones" checked> Excepciones</label>
          <div class="fld"><label for="gxLotes">Lotes para el detalle completo (0 = no traerlo)</label>
            <input id="gxLotes" type="number" min="0" max="64" value="0">
            <span class="hint">El detalle crudo de un parque grande no cabe en el navegador:
              1,3 millones de filas tumban la pestaña. Úsalo solo con un filtro que acote a un grupo.</span></div>
          <button class="btn btn-p" data-gx="traer"${on ? '' : ' disabled style="opacity:.5"'}>Ejecutar y cargar</button>
          <div id="gxLog" class="mini" style="margin-top:12px;font-family:ui-monospace,Consolas,monospace;
               max-height:170px;overflow:auto;line-height:1.7"></div>
        </div>
      </div>
      <div class="card"><div class="card-h"><div><h3>Cómo registrar la aplicación</h3>
        <p>Una sola vez</p></div></div>
        <ol style="margin:14px 0 0;padding-left:20px;font-size:12.5px;color:var(--ink-3);line-height:1.75">
          <li>Portal de Azure → <b>Microsoft Entra ID</b> → <b>App registrations</b> → <b>New registration</b>.</li>
          <li>Plataforma <b>Single-page application (SPA)</b> y como URI de redirección la de arriba.</li>
          <li>En <b>API permissions</b>, permiso <b>delegado</b> de Microsoft Graph:
              <code>ThreatHunting.Read.All</code>. Pulsa <b>Grant admin consent</b>.</li>
          <li>Copia aquí el <b>Application (client) ID</b> y el <b>Directory (tenant) ID</b>.</li>
        </ol>
        <div class="banner" style="margin:14px 0 0">${ico('shield')}<div>
          No se crea ningún <i>client secret</i>. El token se emite a tu cuenta, vive en la memoria de esta
          pestaña y se pierde al cerrarla. La página solo puede ver lo que tú ya puedes ver.
        </div></div>
      </div>
    </div>`;
}
