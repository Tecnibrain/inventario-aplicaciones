
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
/** Escapa para una cadena de PowerShell entre comillas simples: se duplican. */
// Escapa para una cadena de PowerShell entre comillas simples: se duplican.
// Y fuera los caracteres de control: un salto de linea dentro del nombre de una
// aplicacion partiria la instruccion en dos y el script no arrancaria.
const psEsc = s => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/'/g, "''");

/**
 * Filtro de equipos comun a las tres consultas. Admite varias condiciones, una
 * por linea; cada una se reindenta al nivel del bloque para que la consulta
 * generada siga siendo legible al pegarla.
 */
function kqlFiltro() {
  const f = (CFG.kql && CFG.kql.filtro) != null ? CFG.kql.filtro : '| where DeviceType == "Workstation"';
  return String(f).split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n    ');
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
/**
 * Cuerpo JSON para pegar en Graph Explorer. La consulta va como una sola cadena,
 * asi que los saltos de linea y las comillas tienen que ir escapados: de eso se
 * encarga JSON.stringify.
 */
function cuerpoGraph(kql) {
  return JSON.stringify({ Query: kql }, null, 2);
}

/**
 * Carga la respuesta que devuelve Graph Explorer. Acepta el JSON completo, solo
 * el array de resultados, o el objeto con `results`, que es lo que se copia
 * segun desde donde se haga.
 */
function cargarRespuestaGraph(texto, nombre, reset) {
  let j;
  try { j = JSON.parse(texto); }
  catch (e) { throw new Error('Eso no es JSON válido. Copia la respuesta completa del panel de Graph Explorer.'); }
  const filas = Array.isArray(j) ? j : (j.results || j.Results || j.value || null);
  if (!Array.isArray(filas))
    throw new Error('No encuentro la lista de resultados. Se espera un array, o un objeto con «results».');
  if (!filas.length) throw new Error('La respuesta no trae ninguna fila.');
  const grid = filasAGrid(filas);
  const src = addSource(grid, nombre || 'respuesta de Graph', '', !!reset);
  M.aggFull = aggregate(M.rows);
  M.effVer = effVersions(M.rows);
  seedCatalog();
  histSnapshot();
  return src;
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


/* ---- 24.5a autenticacion, comun a Defender y a Intune -------------------
   Los tres caminos terminan igual: con $Token puesto. Lo que cambia despues es
   contra que endpoint se habla, asi que el bloque se comparte.
   ------------------------------------------------------------------------ */
function bloqueAuth(modo, scope) {
  const g = CFG.graph || {};
  const authRest = `
# --- Autenticacion por codigo de dispositivo, SIN MODULO ---------------------
# Microsoft.Graph.Authentication v2 falla al cargarse en Windows PowerShell 5.1
# con un TypeLoadException: sus ensamblados apuntan a .NET moderno. Aqui se
# habla directamente con el endpoint de OAuth, asi que no hace falta el modulo
# ni PowerShell 7.
$Client = '${psEsc(g.clientId || '')}'
$Tenant = '${psEsc(g.tenantId || '')}'
$Scope  = 'https://graph.microsoft.com/${scope} offline_access'
if (-not $Client -or -not $Tenant) { throw 'Faltan el Application ID y el Directory ID. Rellenalos en Origen de datos y vuelve a descargar el script.' }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$base = "https://login.microsoftonline.com/$Tenant/oauth2/v2.0"

Write-Host 'Solicitando codigo de inicio de sesion...' -ForegroundColor Cyan
$dc = Invoke-RestMethod -Method POST -Uri "$base/devicecode" -Body @{ client_id = $Client; scope = $Scope }
Write-Host ''
Write-Host '  ------------------------------------------------------------'
Write-Host ("  Abre  {0}" -f $dc.verification_uri) -ForegroundColor Yellow
Write-Host ("  Codigo: {0}" -f $dc.user_code) -ForegroundColor Yellow
Write-Host '  ------------------------------------------------------------'
Write-Host ''
try { Start-Process $dc.verification_uri } catch { }

$tok = $null
$limite = (Get-Date).AddSeconds([int]$dc.expires_in)
$espera = [Math]::Max(5, [int]$dc.interval)
while (-not $tok -and (Get-Date) -lt $limite) {
    Start-Sleep -Seconds $espera
    try {
        $tok = Invoke-RestMethod -Method POST -Uri "$base/token" -Body @{
            client_id   = $Client
            grant_type  = 'urn:ietf:params:oauth:grant-type:device_code'
            device_code = $dc.device_code
        }
    } catch {
        $detalle = ''
        try { $detalle = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch { }
        if ($detalle -eq 'slow_down') { $espera += 5 }
        elseif ($detalle -ne 'authorization_pending') {
            $msg = ''
            try { $msg = ($_.ErrorDetails.Message | ConvertFrom-Json).error_description } catch { $msg = $_.Exception.Message }
            throw $msg
        }
    }
}
if (-not $tok) { throw 'Se agoto el tiempo de espera del inicio de sesion.' }
$Token = $tok.access_token
Write-Host 'Sesion iniciada correctamente.' -ForegroundColor Green

`;
  const authApp = `
# --- Autenticacion de APLICACION (client credentials) ------------------------
# El permiso ${scope} esta concedido como permiso de APLICACION,
# no delegado: la app se autentica contra si misma y no hay usuario de por medio.
# Eso evita tanto la asignacion de usuario como la URI de redireccion.
#
# El secreto NO va escrito en este archivo. Se pide al ejecutar, o se lee de la
# variable de entorno GRAPH_SECRET si prefieres automatizarlo sin teclearlo.
$Client = '${psEsc(g.clientId || '')}'
$Tenant = '${psEsc(g.tenantId || '')}'
if (-not $Client -or -not $Tenant) { throw 'Faltan el Application ID y el Directory ID. Rellenalos en Origen de datos y vuelve a descargar el script.' }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ($env:GRAPH_SECRET) {
    $plano = $env:GRAPH_SECRET
    Write-Host 'Usando el secreto de la variable de entorno GRAPH_SECRET.' -ForegroundColor DarkGray
} else {
    Write-Host 'Pega el client secret (no se vera al escribir y no se guarda en ningun sitio):' -ForegroundColor Cyan
    $seguro = Read-Host -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
    try { $plano = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if (-not $plano) { throw 'No se recibio ningun secreto.' }

Write-Host 'Solicitando token de aplicacion...' -ForegroundColor Cyan
try {
    $tok = Invoke-RestMethod -Method POST -Uri "https://login.microsoftonline.com/$Tenant/oauth2/v2.0/token" -Body @{
        client_id     = $Client
        client_secret = $plano
        scope         = 'https://graph.microsoft.com/.default'
        grant_type    = 'client_credentials'
    }
} catch {
    $msg = $_.Exception.Message
    try { $msg = ($_.ErrorDetails.Message | ConvertFrom-Json).error_description } catch { }
    throw "No se pudo obtener el token: $msg"
} finally {
    # el secreto deja de estar en memoria en cuanto no hace falta
    $plano = $null
    [GC]::Collect()
}
$Token = $tok.access_token
Write-Host 'Token obtenido. La aplicacion consulta en su propio nombre.' -ForegroundColor Green

`;
  const authModulo = `
# --- Autenticacion con el modulo oficial de Microsoft ------------------------
# Aviso: Microsoft.Graph.Authentication v2 suele fallar en Windows PowerShell 5.1
# con TypeLoadException. Si ocurre, usa PowerShell 7 (pwsh) o marca en el tablero
# "Usar mi propio registro", que genera una version sin modulo.
if ($PSVersionTable.PSVersion.Major -lt 6) {
    Write-Host ''
    Write-Host 'AVISO: estas en Windows PowerShell ' -NoNewline -ForegroundColor Yellow
    Write-Host $PSVersionTable.PSVersion -ForegroundColor Yellow
    Write-Host 'El modulo de Microsoft esta pensado para PowerShell 7. Si falla al importarse:' -ForegroundColor Yellow
    Write-Host '  1) Instala PowerShell 7:  winget install Microsoft.PowerShell' -ForegroundColor Yellow
    Write-Host '     y vuelve a ejecutar este script con  pwsh' -ForegroundColor Yellow
    Write-Host '  2) O marca "Usar mi propio registro" en el tablero: no usa modulo.' -ForegroundColor Yellow
    Write-Host ''
}
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
    Write-Host 'Instalando Microsoft.Graph.Authentication para el usuario actual...' -ForegroundColor Yellow
    Install-Module Microsoft.Graph.Authentication -Scope CurrentUser -Force -AllowClobber
}
Import-Module Microsoft.Graph.Authentication

Write-Host 'Iniciando sesion...' -ForegroundColor Cyan
Connect-MgGraph -Scopes '${scope}' -NoWelcome
$ctx = Get-MgContext
Write-Host ("Conectado como {0} en {1}" -f $ctx.Account, $ctx.TenantId) -ForegroundColor Green

`;
  return modo === 'aplicacion' ? authApp : modo === 'dispositivo' ? authRest : authModulo;
}

/** La funcion Exportar de Defender: una consulta KQL por llamada. */
function expDefender(modo) {
  return modo === 'microsoft' ? `
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
` : `
function Exportar {
    param([string]$Nombre, [string]$Titulo, [string]$Kql)
    Write-Host ("-> {0}: consultando..." -f $Titulo) -NoNewline
    try {
        $resp = Invoke-RestMethod -Method POST \`
            -Uri 'https://graph.microsoft.com/v1.0/security/runHuntingQuery' \`
            -Headers @{ Authorization = "Bearer $Token" } \`
            -ContentType 'application/json' \`
            -Body (@{ Query = $Kql } | ConvertTo-Json -Depth 4 -Compress)
    } catch {
        Write-Host ''
        $msg = $_.Exception.Message
        try { $msg = ($_.ErrorDetails.Message | ConvertFrom-Json).error.message } catch { }
        Write-Host ("   ERROR: {0}" -f $msg) -ForegroundColor Red
        return
    }
    $filas = $resp.results
    if (-not $filas -or $filas.Count -eq 0) { Write-Host ' sin filas' -ForegroundColor DarkYellow; return }
    $ruta = Join-Path $Salida ("{0}.csv" -f $Nombre)
    $filas | ForEach-Object { [PSCustomObject]$_ } | Export-Csv -Path $ruta -NoTypeInformation -Encoding UTF8
    Write-Host (" {0} filas -> {1}" -f $filas.Count, (Split-Path $ruta -Leaf)) -ForegroundColor Green
}
`;
}

/* ---- 24.5b extraccion desde Intune --------------------------------------
   Intune no expone KQL, pero si algo que Advanced Hunting no tiene: trabajos de
   exportacion. Se pide un informe, Intune lo genera en segundo plano y devuelve
   un enlace temporal a un ZIP. No hay tope de 100.000 filas, asi que el
   inventario completo sale de una sola vez.
   ------------------------------------------------------------------------ */
// Sin lista de columnas a proposito. Pedirlas por nombre no ahorra nada que
// importe y si puede romperlo: si Intune descarta en silencio las que no
// reconoce en vez de fallar, el CSV sale sin la columna de equipo o la de
// aplicacion y el tablero ya no sabe que es. El detector aguanta de sobra las
// columnas de mas, que es justo lo que se comprobo con las cabeceras reales.
const INFORMES_INTUNE = {
  parque: ['Parque de equipos', 'DevicesWithInventory', []],
  catalogo: ['Catalogo agregado', 'AppInvAggregate', []],
  detalle: ['Detalle crudo por equipo', 'AppInvRawData', []]
};

function scriptIntune(opts, modo) {
  opts = opts || {};
  const ps = a => a.length ? "@('" + a.join("', '") + "')" : '@()';
  let cuerpo = '';
  // Solo el detalle. Antes se pedian tambien el parque y el catalogo agregado,
  // pero el detalle los contiene a los dos: el tablero saca de el un registro
  // por equipo y el recuento por aplicacion y version. Pedirlos aparte era
  // esperar dos informes mas para obtener lo mismo.
  for (const id of ['detalle']) {
    const [titulo, reporte, cols] = INFORMES_INTUNE[id];
    cuerpo += `
Exportar-Informe -Nombre '${id}' -Titulo '${titulo}' -Reporte '${reporte}' \`
                 -Columnas ${ps(cols)} -Filtro $Filtro
`;
  }

  const rest = modo !== 'microsoft';
  const puente = rest ? `
function GraphPost { param($Uri, $Body)
    Invoke-RestMethod -Method POST -Uri $Uri -Headers @{ Authorization = "Bearer $Token" } \`
        -ContentType 'application/json' -Body $Body
}
function GraphGet { param($Uri)
    Invoke-RestMethod -Method GET -Uri $Uri -Headers @{ Authorization = "Bearer $Token" }
}` : `
function GraphPost { param($Uri, $Body)
    Invoke-MgGraphRequest -Method POST -Uri $Uri -Body $Body -ContentType 'application/json' -OutputType PSObject
}
function GraphGet { param($Uri)
    Invoke-MgGraphRequest -Method GET -Uri $Uri -OutputType PSObject
}`;

  return `<#
    Inventario de Aplicaciones - de Intune al archivo, en un paso
    Generado el ${new Date().toLocaleString('es-CO')}${CFG.org ? ' para ' + CFG.org : ''}
    Modo: ${modo === 'aplicacion' ? 'permiso de APLICACION con client secret (sin usuario)'
          : modo === 'dispositivo' ? 'registro propio, codigo de dispositivo, sin modulo'
          : 'modulo oficial de Microsoft (recomendado PowerShell 7)'}

    Por que Intune y no Advanced Hunting:
      Los informes de Intune se entregan como archivo, no como respuesta de una
      consulta, asi que NO se aplica el tope de 100.000 filas de la consola de
      Defender. El inventario completo sale entero, sin lotes.

    Lo que no trae, y por eso Defender sigue haciendo falta:
      - EndOfSupportStatus (software fuera de soporte)
      - Vulnerabilidades y CVE
      - Equipos con sensor de Defender que no esten inscritos en Intune

    Permiso necesario:  DeviceManagementManagedDevices.Read.All

    Uso:
      1. Abre PowerShell (no hace falta como administrador).
      2. Ejecuta:  .\\inventario.ps1
      3. Espera: un informe grande tarda varios minutos en generarse.
      4. Arrastra el detalle.parquet al tablero. Solo ese.

    Al final borra los CSV intermedios: el Parquet los contiene enteros y
    ocupa una fraccion. Si prefieres conservarlos, -Conservar.
#>

param(
    [string]$Duck = '',
    [switch]$Conservar
)

$ErrorActionPreference = 'Stop'
$Salida = Join-Path $PSScriptRoot 'salida'
if (-not $Salida) { $Salida = Join-Path (Get-Location) 'salida' }
if (-not (Test-Path $Salida)) { New-Item -ItemType Directory -Path $Salida | Out-Null }

# Filtro OData del informe. Ojo: no es KQL, y cada informe admite unos campos
# distintos. Ejemplos:  (OS eq 'Windows')   o   (ApplicationName eq 'Google Chrome')
$Filtro = '${psEsc((opts.filtro || '').replace(/[\r\n]+/g, ' ').trim())}'
${bloqueAuth(modo, 'DeviceManagementManagedDevices.Read.All')}${puente}

$script:ApiIntune = 'beta'

function Exportar-Informe {
    param([string]$Nombre, [string]$Titulo, [string]$Reporte, [string[]]$Columnas, [string]$Filtro)

    Write-Host ("-> {0}  ({1})" -f $Titulo, $Reporte) -ForegroundColor Cyan
    $cuerpo = @{ reportName = $Reporte; format = 'csv' }
    if ($Columnas -and $Columnas.Count -gt 0) { $cuerpo['select'] = $Columnas }
    if ($Filtro) { $cuerpo['filter'] = $Filtro }

    # Se prueban beta y v1.0: no todos los informes estan publicados en ambas.
    # Si falla con la lista de columnas, se reintenta sin ella, porque los
    # nombres de columna cambian entre versiones del informe.
    $trabajo = $null; $fallo = 'sin detalle'
    foreach ($vuelta in 1..2) {
        foreach ($v in @('beta', 'v1.0')) {
            try {
                $trabajo = GraphPost "https://graph.microsoft.com/$v/deviceManagement/reports/exportJobs" \`
                                     ($cuerpo | ConvertTo-Json -Depth 4 -Compress)
                $script:ApiIntune = $v
                break
            } catch {
                $fallo = $_.Exception.Message
                try { $fallo = ($_.ErrorDetails.Message | ConvertFrom-Json).error.message } catch { }
            }
        }
        if ($trabajo) { break }
        if ($vuelta -eq 1 -and $cuerpo.ContainsKey('select')) {
            Write-Host '   la lista de columnas no le gusta; reintento sin ella' -ForegroundColor DarkYellow
            $cuerpo.Remove('select')
        } else { break }
    }
    if (-not $trabajo) {
        Write-Host ("   ERROR: {0}" -f $fallo) -ForegroundColor Red
        if ($Filtro) { Write-Host '   (el filtro puede ser el culpable: cada informe admite otros campos)' -ForegroundColor DarkYellow }
        return
    }

    Write-Host '   generando' -NoNewline
    $reloj = [Diagnostics.Stopwatch]::StartNew()
    while ($trabajo.status -ne 'completed') {
        if ($trabajo.status -eq 'failed') {
            Write-Host ''; Write-Host '   ERROR: Intune marco el trabajo como fallido' -ForegroundColor Red; return
        }
        if ($reloj.Elapsed.TotalMinutes -gt 45) {
            Write-Host ''; Write-Host '   ERROR: mas de 45 minutos esperando; lo dejo' -ForegroundColor Red; return
        }
        Start-Sleep -Seconds 6
        Write-Host '.' -NoNewline
        $trabajo = GraphGet ("https://graph.microsoft.com/{0}/deviceManagement/reports/exportJobs('{1}')" \`
                             -f $script:ApiIntune, $trabajo.id)
    }
    Write-Host (" listo en {0:n0}s" -f $reloj.Elapsed.TotalSeconds)

    # El enlace ya viene firmado por Azure. NO se le manda cabecera de
    # autorizacion: el almacenamiento la rechaza si la ve.
    $zip = Join-Path $Salida ("{0}.zip" -f $Nombre)
    $tmp = Join-Path $Salida ("_{0}" -f $Nombre)
    $antes = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
    try { Invoke-WebRequest -Uri $trabajo.url -OutFile $zip -UseBasicParsing }
    finally { $ProgressPreference = $antes }

    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force

    # Un informe grande puede venir partido en varios CSV. Quedarse con el
    # primero perderia el resto sin decir nada, asi que se guardan todos.
    $partes = @(Get-ChildItem $tmp -Filter *.csv -Recurse | Sort-Object Name)
    if (-not $partes.Count) { Write-Host '   ERROR: el ZIP no traia ningun CSV' -ForegroundColor Red; return }

    $i = 0
    foreach ($parte in $partes) {
        $sufijo = if ($partes.Count -eq 1) { '' } else { "_$i" }
        $ruta = Join-Path $Salida ("{0}{1}.csv" -f $Nombre, $sufijo)
        Move-Item $parte.FullName $ruta -Force

        # cuenta en streaming: un detalle completo no cabe en memoria de golpe
        $n = 0
        foreach ($linea in [IO.File]::ReadLines($ruta)) { $n++ }
        Write-Host ("   {0:n0} lineas -> {1}" -f [Math]::Max(0, $n - 1), (Split-Path $ruta -Leaf)) -ForegroundColor Green

        # La cabecera, a la vista: si el tablero luego no reconoce el archivo,
        # es lo primero que hay que mirar y ya esta aqui.
        $cab = ''
        foreach ($linea in [IO.File]::ReadLines($ruta)) { $cab = $linea; break }
        Write-Host ("   Cabecera: {0}" -f $cab) -ForegroundColor DarkGray
        $i++
    }
    Remove-Item $tmp -Recurse -Force
    Remove-Item $zip -Force
}
${cuerpo}
# ---------------------------------------------------------------- a Parquet
# El tablero lee el Parquet directamente y saca de el el parque, el catalogo y
# los atrasados, asi que los CSV intermedios no le hacen falta a nadie.
$Detalle = @(Get-ChildItem $Salida -Filter 'detalle*.csv' -ErrorAction SilentlyContinue | Sort-Object Name)
if (-not $Detalle.Count) { throw 'No se genero ningun CSV de detalle. Mira los errores de arriba.' }

if (-not $Duck) {
    foreach ($c in @((Join-Path $PSScriptRoot 'duckdb.exe'), (Join-Path $Salida 'duckdb.exe'), 'duckdb.exe')) {
        $g = Get-Command $c -ErrorAction SilentlyContinue
        if ($g) { $Duck = $g.Source; break }
    }
}
if (-not $Duck) {
    $hallado = Get-ChildItem (Join-Path $PSScriptRoot 'duckdb') -Filter 'duckdb.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hallado) { $Duck = $hallado.FullName }
}
if (-not $Duck) {
    Write-Host ''
    Write-Host 'Falta duckdb.exe, que es lo que convierte el CSV a Parquet.' -ForegroundColor Yellow
    Write-Host 'Es un unico ejecutable portable: no se instala ni toca el registro.' -ForegroundColor Yellow
    $r = Read-Host 'Lo descargo ahora desde github.com/duckdb? (s/N)'
    if ($r -match '^[syY]') {
        $zipD = Join-Path $env:TEMP 'duckdb-cli.zip'
        $dst  = Join-Path $PSScriptRoot 'duckdb'
        Write-Host 'Descargando...' -ForegroundColor Cyan
        $antes = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
        try {
            Invoke-WebRequest -UseBasicParsing -OutFile $zipD \`
                -Uri 'https://github.com/duckdb/duckdb/releases/latest/download/duckdb_cli-windows-amd64.zip'
        } finally { $ProgressPreference = $antes }
        Expand-Archive -Path $zipD -DestinationPath $dst -Force
        Remove-Item $zipD -Force -ErrorAction SilentlyContinue
        $g = Get-ChildItem $dst -Filter 'duckdb.exe' -Recurse | Select-Object -First 1
        if ($g) { $Duck = $g.FullName; Write-Host ("   {0}" -f $Duck) -ForegroundColor DarkGray }
    }
}

# Sin DuckDB no hay Parquet, pero no te quedas sin nada: el tablero tambien lee
# el CSV, recorriendolo por trozos. Tarda mas y ocupa mas; los numeros son los
# mismos. Asi que se avisa y se deja el CSV, en vez de fallar.
if (-not $Duck) {
    Write-Host ''
    Write-Host 'Sin DuckDB no puedo hacer el Parquet, pero el tablero tambien lee el CSV:' -ForegroundColor Yellow
    Write-Host ("  {0}" -f $Detalle[0].FullName) -ForegroundColor Cyan
    Write-Host 'Arrastra ese. Tarda mas y ocupa mas, pero los numeros son los mismos.' -ForegroundColor Yellow
    exit 0
}

# DuckDB trata la barra invertida como escape, asi que las rutas van con barra
# normal. Windows las acepta igual.
function Barra { param([string]$P) return $P.Replace([char]92, '/') }

$Parquet = Join-Path $Salida 'detalle.parquet'
$patron  = Barra (Join-Path $Salida 'detalle*.csv')

# Un informe grande viene partido en varios CSV, y no tienen por que traer las
# columnas en el mismo orden: por eso union_by_name, que las casa por nombre en
# vez de por posicion.
$sql = @"
SET preserve_insertion_order = false;
COPY (SELECT * FROM read_csv_auto('$patron', SAMPLE_SIZE=-1, ignore_errors=true, union_by_name=true))
  TO '$(Barra $Parquet)' (FORMAT parquet, COMPRESSION snappy);
"@

$tmpSql = Join-Path $env:TEMP ('inv-' + [guid]::NewGuid().ToString('N') + '.sql')
Set-Content -Path $tmpSql -Value $sql -Encoding UTF8

Write-Host ''
Write-Host 'Convirtiendo a Parquet...' -ForegroundColor Cyan
$reloj = [Diagnostics.Stopwatch]::StartNew()
& $Duck -c ".read $(Barra $tmpSql)"
$codigo = $LASTEXITCODE
$reloj.Stop()
Remove-Item $tmpSql -Force -ErrorAction SilentlyContinue
if ($codigo -ne 0) { throw "DuckDB termino con codigo $codigo" }

$mbCsv = ($Detalle | Measure-Object -Property Length -Sum).Sum / 1MB
$mbPq  = (Get-Item $Parquet).Length / 1MB
if (-not $Conservar) {
    foreach ($f in $Detalle) { Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host ("Listo en {0:n1} s" -f $reloj.Elapsed.TotalSeconds) -ForegroundColor Green
Write-Host ("  {0,10:n1} MB de CSV  ->  {1:n1} MB en Parquet  ({2:n0}x mas pequeno)" -f $mbCsv, $mbPq, ($mbCsv / [Math]::Max(0.01, $mbPq))) -ForegroundColor Green
Write-Host ''
Write-Host 'Un archivo, y es el unico que necesitas:' -ForegroundColor Cyan
Write-Host ("  {0}" -f $Parquet) -ForegroundColor Cyan
Write-Host 'Arrastralo al tablero.' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Y para preguntarle cualquier otra cosa a los datos:' -ForegroundColor DarkGray
Write-Host ("  {0} -c ""SELECT * FROM '{1}' LIMIT 10""" -f $Duck, $Parquet) -ForegroundColor DarkGray
${modo === 'microsoft' ? 'Disconnect-MgGraph | Out-Null\n' : ''}`;
}

/* ---- 24.5d extraccion desde HP Workforce Experience ----------------------
   La pasarela de HP filtra por Origin: la misma llamada responde 200 desde su
   propio portal y 403 desde cualquier otro sitio, asi que la pagina no puede
   hablar con ella. Un script no manda Origin y pasa sin problema, de ahi que
   esto sea un .ps1.

   A cambio, aqui no hay client secret, ni tramite, ni tope de filas: la sesion
   es del usuario, el refresh token no caduca y WXPQL pagina con limit/skip.
   ------------------------------------------------------------------------ */
const HP_REGIONES = { us: 'https://api.workforceexperience.hp.com',
                      eu: 'https://eu-api.workforceexperience.hp.com',
                      au: 'https://au-api.workforceexperience.hp.com' };

function scriptHP(correo, region) {
  const base = HP_REGIONES[region] || HP_REGIONES.us;
  return `<#
    Inventario de Aplicaciones - extraccion desde HP Workforce Experience
    Generado el ${new Date().toLocaleString('es-CO')}${CFG.org ? ' para ' + CFG.org : ''}

    Por que un script y no un boton en la pagina:
      La pasarela de HP filtra por cabecera Origin. Comprobado: la misma llamada
      responde 200 desde el portal de HP y 403 desde cualquier otro origen. Un
      navegador siempre manda Origin; un script no, y por eso este si pasa.

    Lo bueno de este camino:
      - No hay client secret ni tramite: entras con tu cuenta.
      - El refresh token no caduca, asi que solo la PRIMERA vez hay que hacer un
        paso a mano. Despues se guarda cifrado y las siguientes van solas.
      - WXPQL pagina con limit/skip: no hay tope de exportacion. Es lo que
        resuelve el corte de 135.000 filas de la consola.

    Uso:
      .\\extraer-hp.ps1                 la primera vez, te guia
      .\\extraer-hp.ps1                 las siguientes, ya va sola
      .\\extraer-hp.ps1 -Reiniciar      si quieres volver a iniciar sesion
#>

param(
    [string]$Correo = '${psEsc(correo || '')}',
    [string]$Base   = '${base}',
    [int]$Pagina    = 500,
    [switch]$Reiniciar
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Salida = Join-Path $PSScriptRoot 'salida'
if (-not $Salida) { $Salida = Join-Path (Get-Location) 'salida' }
if (-not (Test-Path $Salida)) { New-Item -ItemType Directory -Path $Salida | Out-Null }

# El refresh token vive aqui, cifrado con DPAPI: solo lo puede leer este usuario
# en esta maquina. Ni el repositorio ni el tablero lo ven nunca.
$Guardado = Join-Path $PSScriptRoot '.hp-token'
$TOKEN_URL = 'https://workforceexperience.hp.com/services/oauth_handler/onecloud/v2/token'
$REDIRECT  = 'https://developers.workforceexperience.hp.com/authtest'

function Guardar-Refresh {
    param([string]$Valor)
    ConvertTo-SecureString $Valor -AsPlainText -Force |
        ConvertFrom-SecureString | Set-Content -Path $Guardado -Encoding ASCII
}

function Leer-Refresh {
    if (-not (Test-Path $Guardado)) { return $null }
    try {
        $seg = (Get-Content $Guardado -Raw).Trim() | ConvertTo-SecureString
        $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg)
        try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($b) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
    } catch { return $null }
}

function Pedir-Token {
    param([hashtable]$Cuerpo)
    Invoke-RestMethod -Method POST -Uri $TOKEN_URL -ContentType 'application/json' \`
        -Body ($Cuerpo | ConvertTo-Json -Compress)
}

# ---------------------------------------------------------------- sesion
if ($Reiniciar -and (Test-Path $Guardado)) { Remove-Item $Guardado -Force }
$refresh = Leer-Refresh
$tok = $null

if ($refresh) {
    Write-Host 'Renovando la sesion guardada...' -ForegroundColor Cyan
    try { $tok = Pedir-Token @{ grant_type = 'refresh_token'; refresh_token = $refresh } }
    catch { Write-Host '   la sesion guardada ya no vale; hay que entrar otra vez' -ForegroundColor Yellow }
}

if (-not $tok) {
    if (-not $Correo) { $Correo = Read-Host 'Tu correo corporativo (el de Workforce Experience)' }

    Write-Host 'Buscando tu proveedor de identidad...' -ForegroundColor Cyan
    $idp = Invoke-RestMethod -Uri ("{0}/v1/identity/idpLookup?email={1}" -f $Base, [Uri]::EscapeDataString($Correo))
    $href = $idp[0].links[0].href
    if (-not $href) { throw 'HP no devolvio un proveedor de identidad para ese correo.' }

    $auth = 'https://workforceexperience.hp.com/services/oauth_handler/onecloud/auth?providerHref={0}&login_hint={1}&redirect_uri={2}' -f \`
            [Uri]::EscapeDataString($href), [Uri]::EscapeDataString($Correo), [Uri]::EscapeDataString($REDIRECT)

    Write-Host ''
    Write-Host '  ------------------------------------------------------------'
    Write-Host '  Se abrira el navegador. Inicia sesion.' -ForegroundColor Yellow
    Write-Host '  Al terminar acabaras en una pagina en blanco: copia la URL'   -ForegroundColor Yellow
    Write-Host '  ENTERA de la barra de direcciones y pegala aqui.'             -ForegroundColor Yellow
    Write-Host '  ------------------------------------------------------------'
    Write-Host ''
    try { Start-Process $auth } catch { Write-Host ("Abrela a mano: {0}" -f $auth) }

    $url = Read-Host 'Pega aqui la URL completa'
    if ($url -notmatch 'code=([^&]+)') { throw 'En esa URL no viene ningun code. Copiala entera, con todo lo que va detras del ?' }
    $code = [Uri]::UnescapeDataString($Matches[1])
    if ($url -notmatch 'state=([^&]+)') { throw 'En esa URL no viene ningun state.' }
    $state = [Uri]::UnescapeDataString($Matches[1])

    $tok = Pedir-Token @{ grant_type = 'authorization_code'; code = $code; state = $state; redirect_uri = $REDIRECT }
}

if (-not $tok.access_token) { throw 'No se pudo obtener el token.' }
if ($tok.refresh_token) { Guardar-Refresh $tok.refresh_token }
$script:Acceso = $tok.access_token
$script:Caduca = (Get-Date).AddSeconds([int]($tok.expires_in) - 60)
Write-Host 'Sesion lista.' -ForegroundColor Green

function Token-Vigente {
    # El acceso dura 15 minutos y una descarga larga los pasa de sobra.
    if ((Get-Date) -lt $script:Caduca) { return $script:Acceso }
    $r = Leer-Refresh
    if (-not $r) { throw 'La sesion caduco y no hay refresh guardado. Vuelve a ejecutar con -Reiniciar.' }
    $n = Pedir-Token @{ grant_type = 'refresh_token'; refresh_token = $r }
    if ($n.refresh_token) { Guardar-Refresh $n.refresh_token }
    $script:Acceso = $n.access_token
    $script:Caduca = (Get-Date).AddSeconds([int]($n.expires_in) - 60)
    return $script:Acceso
}

function Consultar {
    param([string]$Wxpql)
    $r = Invoke-RestMethod -Method POST -Uri ("{0}/v1/insights/query" -f $Base) \`
        -Headers @{ Authorization = ('Bearer ' + (Token-Vigente)) } \`
        -ContentType 'application/json' -Body (@{ query = $Wxpql } | ConvertTo-Json -Compress)
    if ($r.data)    { return $r.data }
    if ($r.records) { return $r.records }
    if ($r.results) { return $r.results }
    if ($r.rows)    { return $r.rows }
    return $r
}

# ------------------------------------------------- que tablas hay de verdad
Write-Host ''
Write-Host 'Tablas a las que tienes acceso:' -ForegroundColor Cyan
$tablas = @()
try {
    $t = Invoke-RestMethod -Uri ("{0}/v1/insights/tables" -f $Base) \`
         -Headers @{ Authorization = ('Bearer ' + (Token-Vigente)) }
    $tablas = @($t.tables | ForEach-Object { $_.tableName })
    $tablas | Sort-Object | ForEach-Object { Write-Host ("   {0}" -f $_) -ForegroundColor DarkGray }
} catch { Write-Host ('   no se pudo listar: ' + $_.Exception.Message) -ForegroundColor Yellow }

function Hay { param([string]$N) return ($tablas -contains $N) }

function Exportar {
    param([string]$Nombre, [string]$Titulo, [string]$Consulta)
    Write-Host ("-> {0}" -f $Titulo) -ForegroundColor Cyan
    $todo = New-Object System.Collections.ArrayList
    $skip = 0
    while ($true) {
        $q = "{0} | limit {1} skip {2}" -f $Consulta, $Pagina, $skip
        try { $filas = @(Consultar $q) }
        catch {
            $msg = $_.Exception.Message
            try { $msg = ($_.ErrorDetails.Message | ConvertFrom-Json).message } catch { }
            Write-Host ("   ERROR: {0}" -f $msg) -ForegroundColor Red
            return
        }
        if (-not $filas -or $filas.Count -eq 0) { break }
        foreach ($f in $filas) { [void]$todo.Add([PSCustomObject]$f) }
        Write-Host ("   {0:n0} filas..." -f $todo.Count)
        if ($filas.Count -lt $Pagina) { break }
        $skip += $Pagina
        Start-Sleep -Milliseconds 250     # la API tiene limite de peticiones
    }
    Write-Host ''
    if ($todo.Count -eq 0) { Write-Host '   sin filas' -ForegroundColor DarkYellow; return }
    $ruta = Join-Path $Salida ("{0}.csv" -f $Nombre)
    $todo | Export-Csv -Path $ruta -NoTypeInformation -Encoding UTF8
    Write-Host ("   {0:n0} filas -> {1}" -f $todo.Count, (Split-Path $ruta -Leaf)) -ForegroundColor Green
}

Write-Host ''

# Catalogo agregado: una fila por aplicacion y version, con cuantos equipos.
# Es lo que le faltaba al export de la consola, que solo daba la version mas alta.
if (Hay 'SoftwareUtilizationSummary') {
    Exportar -Nombre 'hp_catalogo' -Titulo 'Catalogo agregado' -Consulta \`
        'SoftwareUtilizationSummary | project appName, appVersion, deviceCount, deviceOS'
}

# Detalle por equipo. Si existe una tabla de inventario propiamente dicha se usa
# esa, porque las de utilizacion solo ven lo que se ha ABIERTO, no lo instalado.
if (Hay 'SoftwareInventory') {
    Exportar -Nombre 'hp_detalle' -Titulo 'Detalle por equipo (inventario)' -Consulta \`
        'SoftwareInventory | project deviceName, deviceSn, appName, appVersion, deviceOS, lastSignedInUser'
} elseif (Hay 'DeviceSoftwareUtilization') {
    Write-Host 'AVISO: no hay tabla de inventario; se usa la de utilizacion.' -ForegroundColor Yellow
    Write-Host '       Eso ve lo que se ha usado, no necesariamente todo lo instalado.' -ForegroundColor Yellow
    Exportar -Nombre 'hp_detalle' -Titulo 'Detalle por equipo (utilizacion)' -Consulta \`
        'DeviceSoftwareUtilization | project deviceName, deviceSn, appName, appVersion, deviceOS, month'
}

# Parque: un registro por equipo.
if (Hay 'DeviceDEXScore') {
    Exportar -Nombre 'hp_parque' -Titulo 'Parque de equipos' -Consulta \`
        'DeviceDEXScore | project deviceName, deviceSn, deviceModel, deviceOS, OSVersion, lastSignedInUser'
} elseif (Hay 'NonReportingDevices') {
    Exportar -Nombre 'hp_parque' -Titulo 'Parque de equipos' -Consulta \`
        'NonReportingDevices | project deviceName, deviceSn, deviceType, deviceMfg, lastSeen, dateEnrolled'
}

Write-Host ''
Write-Host ("Listo. Archivos en: {0}" -f $Salida) -ForegroundColor Cyan
Write-Host 'Arrastralos TODOS a la vez sobre el tablero: se funden en un solo modelo.' -ForegroundColor Cyan
Write-Host 'La proxima vez no hara falta iniciar sesion: la sesion queda guardada cifrada.' -ForegroundColor DarkGray
`;
}

/* ---- 24.5 script de PowerShell -----------------------------------------
   Camino sin registrar ninguna aplicacion: el modulo oficial de Microsoft ya
   trae su propio registro multi-tenant, asi que el usuario solo inicia sesion.
   El script deja los CSV listos para soltarlos en el tablero.
   ------------------------------------------------------------------------ */
function scriptPowerShell(lotes, modo) {
  const q = s => String(s).replace(/\r/g, '');
  const g = CFG.graph || {};
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
    $kql = Plantilla -Lote $i
    Exportar -Nombre "detalle_$i" -Titulo "Detalle lote $($i + 1)/${lotes}" -Kql $kql
}
`;
  }
  const plantilla = lotes > 0 ? `
function Plantilla {
    param([int]$Lote)
    $t = @'
${q(kqlDetalle(0, lotes))}
'@
    return $t -replace 'hash\\(DeviceId, ${lotes}\\) == 0', "hash(DeviceId, ${lotes}) == $Lote"
}
` : '';

  return `<#
    Inventario de Aplicaciones - extraccion desde Microsoft Defender
    Generado el ${new Date().toLocaleString('es-CO')}${CFG.org ? ' para ' + CFG.org : ''}
    Modo: ${modo === 'aplicacion' ? 'permiso de APLICACION con client secret (sin usuario)'
          : modo === 'dispositivo' ? 'registro propio, codigo de dispositivo, sin modulo'
          : 'modulo oficial de Microsoft (recomendado PowerShell 7)'}

    Uso:
      1. Abre PowerShell (no hace falta como administrador).
      2. Ejecuta:  .\\extraer-defender.ps1
      3. Inicia sesion cuando te lo pida.
      4. Arrastra los CSV de la carpeta 'salida' al tablero, todos a la vez.
#>

$ErrorActionPreference = 'Stop'
$Salida = Join-Path $PSScriptRoot 'salida'
if (-not $Salida) { $Salida = Join-Path (Get-Location) 'salida' }
if (-not (Test-Path $Salida)) { New-Item -ItemType Directory -Path $Salida | Out-Null }
${bloqueAuth(modo, 'ThreatHunting.Read.All')}${expDefender(modo)}${plantilla}${cuerpo}
Write-Host ''
Write-Host ("Listo. Archivos en: {0}" -f $Salida) -ForegroundColor Cyan
Write-Host 'Arrastralos TODOS a la vez sobre el tablero: se funden en un solo modelo.' -ForegroundColor Cyan
${modo === 'microsoft' || !modo ? 'Disconnect-MgGraph | Out-Null\n' : ''}`;
}

/* ---- 24.4 vista --------------------------------------------------------- */
function vDatos(A, rows) {
  const g = CFG.graph || {};
  const listo = !!(g.clientId && g.tenantId);
  const on = conectado();
  const sel = (CFG.kql && CFG.kql.ver) || 'catalogo';
  const texto = (CFG.kql && CFG.kql[sel]) || (KQL[sel] ? KQL[sel].f() : '');

  const AYUDA_MODO = {
    aplicacion: 'La app se autentica contra sí misma: no hay usuario, así que no aplican ni la asignación ' +
      'de usuario ni la URI de redirección. Es lo que corresponde si en API permissions tu permiso figura ' +
      'como tipo <b>Aplicación</b>. El secreto se pide al ejecutar y no se guarda en el archivo.',
    dispositivo: 'Inicias sesión tú con un código. Requiere el permiso como tipo <b>Delegado</b> y ' +
      '<i>Allow public client flows → Yes</i>. No instala ningún módulo.',
    microsoft: 'Usa la aplicación registrada por Microsoft, sin configurar nada tuyo. Requiere el módulo ' +
      '<code>Microsoft.Graph.Authentication</code>, que falla en Windows PowerShell 5.1: usa PowerShell 7.'
  };
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
    ${M.solape ? `<div class="banner" style="margin:12px 0 0;border-color:rgba(208,59,59,.35)">${ico('shield')}<div>
      <b>Hay ${fmt(M.solape)} combinaciones de aplicación y versión contadas dos veces.</b>
      Un archivo agregado y uno de detalle traen las mismas instalaciones, y al fundirse se suman:
      el reparto de versiones sale inflado. Quita uno de los dos, o usa archivos complementarios
      (el catálogo con lo que está al día y las excepciones con lo atrasado).
    </div></div>` : ''}
    <div class="dt-foot"><span>${fmt(M.sources.length)} archivo${M.sources.length > 1 ? 's' : ''} ·
      <b>${fmt(M.rows.length)}</b> filas · <b>${fmt(M.devInfo.size)}</b> equipos con ficha</span>
      <button class="btn" data-rmsrc="todas" style="margin-left:auto">Quitar todos</button>
      <button class="btn btn-p" data-load="add">Añadir archivo</button></div></div>`
    : `<div class="mt-wrap"><div class="empty" style="padding:26px">Todavía no has cargado ningún archivo</div>
       <div class="dt-foot"><button class="btn btn-p" data-load="add" style="margin-left:auto">Añadir archivo</button></div></div>`;

  // Guardar el parque en el equipo sin decirlo no seria honesto: se ve aqui,
  // con la fecha y lo que ocupa, y se borra de un clic.
  const copia = GUARDADO ? `<div class="banner" style="margin:12px 0 0">${ico('shield')}<div>
      <b>Hay una copia guardada en este equipo</b>, así que el tablero abre con los datos
      puestos sin volver a traer el archivo.
      ${esc(GUARDADO.archivo || '')} · ${fmt(GUARDADO.filas)} filas del modelo${
        GUARDADO.instalaciones ? ` · ${fmt(GUARDADO.instalaciones)} instalaciones indexadas` : ''} ·
      ${GUARDADO.bytes ? (GUARDADO.bytes / 1048576).toFixed(1) + ' MB' : ''} ·
      guardada el ${GUARDADO.guardado ? new Date(GUARDADO.guardado).toLocaleString('es-CO') : '—'}.
      <span class="mini" style="display:block;margin-top:4px">Vive en el almacen del navegador de esta
      máquina: no viaja a ningún servidor y no forma parte de la página publicada.</span>
      <button class="btn" data-olvidar="1" style="margin-top:10px">Olvidar los datos guardados</button>
    </div></div>` : '';

  return viewHead('Origen de datos',
    'De dónde salen los números: los archivos cargados, las consultas que los producen y la conexión directa con Defender.') +
    sec('Fuentes cargadas', 'Se funden entre sí: parque, catálogo y excepciones forman un solo modelo. Puedes quitar el que hayas cargado por error') +
    fuentes + copia +
    '<div id="anclaScript"></div>' +
    sec('Identificadores de la aplicación', 'Los mismos para los dos scripts y para la conexión en página. Ninguno es secreto') +
    `<div class="adm-grid">
      <div class="card"><div class="card-h"><div><h3>De dónde salen</h3>
        <p>Entra ID → App registrations → tu app → Overview</p></div></div>
        <div style="margin-top:14px">
          <div class="fld"><label for="gxClient">Application (client) ID</label>
            <input id="gxClient" data-cfg="graph.clientId" value="${esc(g.clientId || '')}"
                   placeholder="00000000-0000-0000-0000-000000000000" spellcheck="false"></div>
          <div class="fld"><label for="gxTenant">Directory (tenant) ID</label>
            <input id="gxTenant" data-cfg="graph.tenantId" value="${esc(g.tenantId || '')}"
                   placeholder="00000000-0000-0000-0000-000000000000" spellcheck="false"></div>
          <p class="mini" style="margin:2px 0 0">${listo
            ? '<span class="sem sem-pill ok">Listos</span> Los scripts que descargues los llevarán dentro.'
            : '<span class="sem sem-pill bad">Faltan</span> Sin ellos el script se descarga igual, pero falla al arrancar.'}</p>
        </div>
      </div>
      <div class="card"><div class="card-h"><div><h3>El secreto: cuidado con cuál copias</h3>
        <p>Es el error más común, y no avisa</p></div></div>
        <div style="margin-top:14px;font-size:12.5px;color:var(--ink-3);line-height:1.7">
          <p style="margin:0 0 10px">En <b>Certificados y secretos</b> hay dos columnas y solo una sirve:</p>
          <table class="mt" style="margin-bottom:10px"><tbody>
            <tr><td style="white-space:nowrap"><b>Value</b></td><td>la que necesitas. Algo como
              <code>abC8Q~x...</code>, y <b>solo se ve al crearlo</b></td></tr>
            <tr><td style="white-space:nowrap"><b>Secret ID</b></td><td>no sirve. Es un GUID con guiones,
              y ese se ve siempre</td></tr>
          </tbody></table>
          <p style="margin:0 0 10px">Si lo que guardaste tiene forma de <code>0000-0000-…</code>,
            copiaste el que no era: hay que crear un secreto nuevo, porque el valor original ya no
            se puede recuperar.</p>
          <p style="margin:0"><b>El secreto no se escribe aquí ni viaja dentro del script.</b> Se teclea
            al ejecutarlo, o se lee de la variable <code>GRAPH_SECRET</code>, y se borra de memoria en
            cuanto se canjea el token.</p>
        </div>
      </div>
      <div class="card"><div class="card-h"><div><h3>Qué NO hace falta</h3>
        <p>Para los dos scripts de esta página</p></div></div>
        <ul style="margin:14px 0 0;padding-left:18px;font-size:12.5px;color:var(--ink-3);line-height:1.9">
          <li><b>URI de redirección.</b> Sirve para devolver al usuario tras iniciar sesión en el
            navegador. En el flujo de aplicación no hay usuario ni navegador: el script pide el token
            por HTTP y lo recibe en la respuesta. Entra ID ni la mira.</li>
          <li><b>Asignación de usuario</b> en Enterprise applications. No hay usuario que asignar,
            así que <code>AADSTS50105</code> no puede darse.</li>
          <li><b>Permiso delegado.</b> Con el de tipo <i>Aplicación</i> concedido es suficiente.</li>
          <li><b>Instalar módulos.</b> El script habla con OAuth por su cuenta, así que funciona en
            Windows PowerShell 5.1.</li>
        </ul>
      </div>
    </div>` +
    sec('Intune', 'Un script, un archivo: pide el inventario, lo convierte y deja el .parquet') +
    `<div class="banner" style="margin-bottom:16px">${ico('info')}<div>
      <b>Intune no tiene el límite de 100.000 filas.</b> Advanced Hunting responde a una consulta y ahí
      está el tope; Intune genera un <b>informe en segundo plano</b> y devuelve un enlace a un ZIP, así
      que el inventario completo sale entero y sin lotes. A cambio no trae <code>EndOfSupportStatus</code>,
      ni vulnerabilidades, ni los equipos que tengan sensor de Defender pero no estén inscritos en Intune.
    </div></div>
    <div class="adm-grid">
      <div class="card"><div class="card-h"><div><h3>El script</h3>
        <p>Pide el informe, espera, descomprime y convierte. Acaba en un archivo</p></div></div>
        <div style="margin-top:14px">
          <div class="fld"><label for="inModo">Cómo se autentica</label>
            <select id="inModo">
              <option value="aplicacion">Permiso de aplicación · client secret (sin usuario)</option>
              <option value="dispositivo">Mi registro · código de dispositivo (permiso delegado)</option>
              <option value="microsoft">App de Microsoft · módulo Graph (permiso delegado)</option>
            </select>
            <span class="hint" id="inAyuda">${AYUDA_MODO.aplicacion}</span>
          </div>
          <div class="fld"><label for="inFiltro">Filtro del informe (opcional)</label>
            <input id="inFiltro" spellcheck="false" placeholder="(OS eq 'Windows')">
            <span class="hint">Es <b>OData, no KQL</b>. Si falla, déjalo vacío: el informe admite unos
              campos y no otros, y el mensaje de error no siempre lo dice.</span></div>
          <button class="btn btn-p" data-gx="intune">Descargar inventario.ps1</button>
        </div>
      </div>
      <div class="card"><div class="card-h"><div><h3>Qué hace, en orden</h3>
        <p>Y por qué solo pide un informe</p></div></div>
        <div style="margin-top:14px;font-size:12.5px;color:var(--ink-3);line-height:1.7">
          <ol style="margin:0 0 12px;padding-left:18px">
            <li>Pide <code>AppInvRawData</code> a Intune y espera a que se genere. Con un parque
                grande son varios minutos: el script espera solo.</li>
            <li>Descarga el ZIP y saca los CSV.</li>
            <li>Los convierte a <b>detalle.parquet</b> con DuckDB. Medido: <b>414&nbsp;MB de CSV
                → 6,8&nbsp;MB</b>, y tarda segundos.</li>
            <li>Borra los CSV. El Parquet los contiene enteros.</li>
          </ol>
          <div class="banner" style="margin:0 0 12px">${ico('info')}<div>
            <b>Solo pide ese informe, y no es un recorte.</b> El detalle contiene el parque y el
            catálogo: el tablero saca de él un registro por equipo y el recuento por aplicación y
            versión. Pedir los otros dos era esperar dos informes más para obtener lo mismo.
          </div></div>
          <p style="margin:0 0 10px">Si no tienes <code>duckdb.exe</code>, el script se ofrece a
            bajarlo —es un único ejecutable portable, no se instala ni toca el registro—. Y si dices
            que no, te deja el CSV y te lo dice: el tablero también lo lee, recorriéndolo por trozos.
            Tarda más y ocupa más; los números son los mismos.</p>
          <p style="margin:0">Con <code>-Conservar</code> no borra los CSV, por si los quieres sueltos.</p>
        </div>
      </div>
      <div class="card"><div class="card-h"><div><h3>Qué permiso necesita</h3>
        <p>Uno solo, y es de los que ya suele estar concedido</p></div></div>
        <div style="margin-top:14px;font-size:12.5px;color:var(--ink-3);line-height:1.7">
          <p style="margin:0 0 10px">Con <code>DeviceManagementManagedDevices.Read.All</code> basta.
            Si además tienes <code>DeviceManagementApps.Read.All</code> y
            <code>Directory.Read.All</code>, no estorban, pero no hacen falta aquí.</p>
          <p style="margin:0 0 10px">Como el permiso figura de tipo <b>Aplicación</b>, la app se autentica
            contra sí misma: no hay usuario, y por eso no aplican ni la asignación de usuario ni la URI de
            redirección. Eso sí, <b>necesita una credencial</b>: un client secret o un certificado.</p>
          <p style="margin:0">El secreto <b>no viaja dentro del script</b>. Se pide al ejecutarlo, o se lee
            de la variable <code>GRAPH_SECRET</code>, y se borra de memoria en cuanto se canjea el token.</p>
        </div>
      </div>
    </div>`;
}
