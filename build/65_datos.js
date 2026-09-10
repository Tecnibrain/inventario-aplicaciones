
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

/* ---- 24.5e preparar los datos con DuckDB ---------------------------------
   Convertir el detalle a Parquet y resumirlo con SQL. Medido sobre 414 MB y
   1.276.473 filas: 2,5 segundos y 5,3 MB de salida, setenta y siete veces mas
   pequeno. El recorredor en C# hacia lo mismo mucho mas despacio y con diez
   veces mas codigo.

   Comparar versiones en SQL es el punto delicado: "1.10" va por debajo de "1.9"
   si se comparan como texto. Se construye una clave rellenando cada tramo a diez
   digitos, y esa si se ordena bien. Sin lambdas: la sintaxis de la flecha
   esta marcada como obsoleta en DuckDB y esto tiene que seguir funcionando
   dentro de un ano.
   ------------------------------------------------------------------------ */
function scriptDuck() {
  return `<#
    Inventario de Aplicaciones - preparar el detalle con DuckDB
    Generado el ${new Date().toLocaleString('es-CO')}${CFG.org ? ' para ' + CFG.org : ''}

    Que hace:
      1. Convierte el CSV del detalle a Parquet. Medido: 414 MB -> 5,3 MB, y
         tarda segundos. Parquet guarda por columnas y con diccionario, y este
         dato son nombres repetidos millones de veces, asi que se comprime
         muchisimo.
      2. Saca de ahi, con SQL, las tres formas que el tablero funde:
            parque.csv       un registro por equipo
            catalogo.csv     aplicacion + version + cuantos equipos
            atrasados.csv    QUE equipo va por detras
      3. Deja el .parquet, que puedes consultar con SQL para cualquier pregunta
         que el tablero no responda.

    Necesita duckdb.exe, que es un unico ejecutable portable y no se instala.
    Si no lo tienes, el script te dice de donde bajarlo.

    Uso:
      .\\preparar-duckdb.ps1 -Ruta 'C:\\ruta\\salida\\detalle.csv'
#>

param(
    [string]$Ruta,
    [string]$Duck = ''
)

$ErrorActionPreference = 'Stop'

if (-not $Ruta) { $Ruta = Read-Host 'Ruta del CSV del detalle' }
$Ruta = $Ruta.Trim().Trim('"')
if (-not (Test-Path $Ruta)) { throw "No existe el archivo: $Ruta" }
$Ruta = (Resolve-Path $Ruta).Path
$Carpeta = Split-Path $Ruta -Parent

# ------------------------------------------------------------------ duckdb
if (-not $Duck) {
    $cand = @(
        (Join-Path $PSScriptRoot 'duckdb.exe'),
        (Join-Path $Carpeta 'duckdb.exe'),
        'duckdb.exe'
    )
    foreach ($c in $cand) {
        $g = Get-Command $c -ErrorAction SilentlyContinue
        if ($g) { $Duck = $g.Source; break }
    }
}
if (-not $Duck) {
    Write-Host ''
    Write-Host 'No encuentro duckdb.exe.' -ForegroundColor Yellow
    Write-Host 'Es un unico ejecutable portable, no se instala ni toca el registro.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  https://github.com/duckdb/duckdb/releases/latest' -ForegroundColor Cyan
    Write-Host '  Baja duckdb_cli-windows-amd64.zip, descomprimelo y deja duckdb.exe'
    Write-Host '  junto a este script. Luego vuelve a ejecutarlo.'
    Write-Host ''
    $r = Read-Host 'Si prefieres, pega aqui la ruta a duckdb.exe (o Enter para salir)'
    if (-not $r) { exit 1 }
    $Duck = $r.Trim().Trim('"')
    if (-not (Test-Path $Duck)) { throw "No existe: $Duck" }
}
Write-Host ("DuckDB: {0}" -f $Duck) -ForegroundColor DarkGray

# ------------------------------------------------ que columnas trae el CSV
$cab = (Get-Content $Ruta -TotalCount 1) -replace '^\\uFEFF', ''
$cols = @()
foreach ($c in ($cab -split ',')) { $cols += $c.Trim('"').Trim() }

function Col {
    param([string[]]$Candidatas)
    foreach ($cand in $Candidatas) {
        foreach ($c in $cols) { if ($c -ieq $cand) { return $c } }
    }
    return $null
}

$cDev = Col @('DeviceName','Device','Equipo','ManagedDeviceName')
$cApp = Col @('ApplicationName','SoftwareName','DisplayName','Apps')
$cVen = Col @('ApplicationPublisher','SoftwareVendor','Publisher')
$cVer = Col @('ApplicationVersion','SoftwareVersion','Installed Version','Version')
$cUsr = Col @('UserName','UPN','EmailAddress','Last Signed-in User')
$cOs  = Col @('OSDescription','Platform','OS','OSDistribution')
$cOsV = Col @('OSVersion','OSVersionInfo')

if (-not $cApp -or -not $cDev) {
    throw "No reconozco las columnas. Cabecera: $cab"
}
Write-Host ("Columnas: equipo={0}  aplicacion={1}  version={2}" -f $cDev, $cApp, $cVer) -ForegroundColor DarkGray

$q = { param($c) if ($c) { '"' + $c + '"' } else { 'NULL' } }
$Q_DEV = & $q $cDev; $Q_APP = & $q $cApp; $Q_VEN = & $q $cVen
$Q_VER = & $q $cVer; $Q_USR = & $q $cUsr; $Q_OS = & $q $cOs; $Q_OSV = & $q $cOsV

# DuckDB trata la barra invertida como escape, asi que todas las rutas van con
# barra normal. Windows las acepta igual.
function Ruta { param([string]$P) return $P.Replace([char]92, '/') }

$Parquet   = Join-Path $Carpeta 'detalle.parquet'
$Parque    = Join-Path $Carpeta 'parque.csv'
$Catalogo  = Join-Path $Carpeta 'catalogo.csv'
$Atrasados = Join-Path $Carpeta 'atrasados.csv'

# El SQL. La clave de version rellena cada tramo a diez digitos: sin eso,
# "1.10" quedaria por debajo de "1.9" al comparar como texto, que es el error
# clasico y el que hace que un tablero de versiones mienta.
$sql = @"
SET preserve_insertion_order = false;

COPY (SELECT * FROM read_csv_auto('$(Ruta $Ruta)', SAMPLE_SIZE=-1, ignore_errors=true))
  TO '$(Ruta $Parquet)' (FORMAT parquet, COMPRESSION zstd);

CREATE OR REPLACE MACRO vkey(v) AS
  lpad(regexp_replace(split_part(coalesce(v,''),'.',1),'[^0-9]','','g'),10,'0') || '.' ||
  lpad(regexp_replace(split_part(coalesce(v,''),'.',2),'[^0-9]','','g'),10,'0') || '.' ||
  lpad(regexp_replace(split_part(coalesce(v,''),'.',3),'[^0-9]','','g'),10,'0') || '.' ||
  lpad(regexp_replace(split_part(coalesce(v,''),'.',4),'[^0-9]','','g'),10,'0') || '.' ||
  lpad(regexp_replace(split_part(coalesce(v,''),'.',5),'[^0-9]','','g'),10,'0');

CREATE OR REPLACE VIEW d AS
  SELECT $Q_DEV AS dev, $Q_USR AS usr, $Q_VEN AS ven, $Q_APP AS app,
         $Q_VER AS ver, $Q_OS AS os, $Q_OSV AS osv
  FROM '$(Ruta $Parquet)'
  WHERE $Q_DEV IS NOT NULL AND $Q_DEV <> '';

COPY (
  SELECT dev AS DeviceName, any_value(usr) AS UserName,
         any_value(os) AS OSDistribution, any_value(osv) AS OSVersionInfo
  FROM d GROUP BY dev
) TO '$(Ruta $Parque)' (HEADER, DELIMITER ',');

CREATE OR REPLACE VIEW tope AS
  SELECT ven, app, max(vkey(ver)) AS vmax
  FROM d WHERE app IS NOT NULL AND app <> '' GROUP BY ven, app;

COPY (
  SELECT d.ven AS SoftwareVendor, d.app AS SoftwareName, d.ver AS SoftwareVersion,
         count(DISTINCT d.dev) AS Equipos
  FROM d JOIN tope t ON d.ven IS NOT DISTINCT FROM t.ven AND d.app = t.app
  WHERE vkey(d.ver) >= t.vmax
  GROUP BY 1,2,3
) TO '$(Ruta $Catalogo)' (HEADER, DELIMITER ',');

COPY (
  SELECT DISTINCT d.dev AS DeviceName, d.usr AS UserName, d.ven AS SoftwareVendor,
         d.app AS SoftwareName, d.ver AS SoftwareVersion, d.osv AS OSVersionInfo
  FROM d JOIN tope t ON d.ven IS NOT DISTINCT FROM t.ven AND d.app = t.app
  WHERE vkey(d.ver) < t.vmax
) TO '$(Ruta $Atrasados)' (HEADER, DELIMITER ',');
"@

$tmp = Join-Path $env:TEMP ('inv-' + [guid]::NewGuid().ToString('N') + '.sql')
Set-Content -Path $tmp -Value $sql -Encoding UTF8

Write-Host ''
Write-Host 'Convirtiendo a Parquet y resumiendo...' -ForegroundColor Cyan
$reloj = [Diagnostics.Stopwatch]::StartNew()
& $Duck -c ".read $(Ruta $tmp)"
$codigo = $LASTEXITCODE
$reloj.Stop()
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
if ($codigo -ne 0) { throw "DuckDB termino con codigo $codigo" }

function Filas { param([string]$P) if (-not (Test-Path $P)) { return 0 }; $n = 0; foreach ($l in [IO.File]::ReadLines($P)) { $n++ }; return [Math]::Max(0, $n - 1) }
function Mb { param([string]$P) if (Test-Path $P) { (Get-Item $P).Length / 1MB } else { 0 } }

Write-Host ''
Write-Host ("Listo en {0:n1} s" -f $reloj.Elapsed.TotalSeconds) -ForegroundColor Green
Write-Host ("  {0,10:n1} MB  ->  {1,8:n1} MB en Parquet  ({2:n0}x mas pequeno)" -f (Mb $Ruta), (Mb $Parquet), ((Mb $Ruta) / [Math]::Max(0.01, (Mb $Parquet)))) -ForegroundColor Green
Write-Host ("  {0,10:n0} equipos          -> parque.csv" -f (Filas $Parque)) -ForegroundColor Green
Write-Host ("  {0,10:n0} app+version      -> catalogo.csv" -f (Filas $Catalogo)) -ForegroundColor Green
Write-Host ("  {0,10:n0} atrasados        -> atrasados.csv" -f (Filas $Atrasados)) -ForegroundColor Green
Write-Host ''
Write-Host 'Arrastra los TRES csv al tablero, a la vez.' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Y para preguntarle cualquier otra cosa a los datos:' -ForegroundColor DarkGray
Write-Host ("  {0} -c ""SELECT * FROM '{1}' LIMIT 10""" -f $Duck, $Parquet) -ForegroundColor DarkGray
`;
}

/* ---- 24.5c resumir un detalle enorme sin abrirlo -------------------------
   El detalle crudo de un parque grande no cabe en el navegador, pero lo que el
   tablero necesita de el si: el catalogo agregado y el parque. Los dos salen de
   una sola pasada por el archivo, sin cargarlo en memoria.

   El C# va dentro de esta plantilla, asi que sus barras invertidas van dobladas.
   ------------------------------------------------------------------------ */
function scriptResumir() {
  // El estandar viaja dentro del script, igual que el datatable de la consulta
  // de excepciones. Aqui NO se filtra por alcance: el alcance decide que puntua
  // en el tablero, y exige estar en el 90 % del parque, cosa que casi ninguna
  // aplicacion cumple. Filtrando por el, el estandar salia vacio y el script
  // caia en el corte duro, que es lo que produce archivos de cientos de MB.
  // Van ordenadas por equipos, de mas a menos, para que -TopApps corte por donde
  // duele menos.
  const cuantos = k => ((M.aggFull && M.aggFull.appDev.get(k)) || { size: 0 }).size;
  const reglas = Object.keys(CFG.apps || {})
    .filter(k => (CFG.apps[k] || {}).rec)
    .sort((a, b) => cuantos(b) - cuantos(a))
    .map(k => { const i = k.indexOf(' / '); return [k.slice(0, i), k.slice(i + 3), CFG.apps[k].rec]; });
  const estandar = reglas.map(([v, a, r]) =>
    `$E['${psEsc(v)}' + $S + '${psEsc(a)}'] = '${psEsc(r)}'`).join('\n');

  return `<#
    Inventario de Aplicaciones - resumir un detalle crudo demasiado grande
    Generado el ${new Date().toLocaleString('es-CO')}${CFG.org ? ' para ' + CFG.org : ''}

    Para que sirve:
      El detalle por equipo de un parque grande son gigabytes, y el navegador no
      lo aguanta: reservar el archivo y decodificarlo a texto lo duplica, porque
      las cadenas de JavaScript son UTF-16.

      Pero abrirlo entero no hace falta. De ese archivo salen tres cosas mucho
      mas pequenos, recorriendolo sin cargarlo en memoria:

      ${reglas.length
        ? `Corte: tu ESTANDAR, ${reglas.length} aplicacion(es). Una instalacion es
      excepcion si va por debajo de la version aprobada de su aplicacion.
      Si aun asi el archivo sale demasiado grande, acota con -TopApps 300, que se
      queda con las 300 aplicaciones mas instaladas, o con -Apps.`
        : `Corte: la version MAS ALTA vista, porque no habia estandar cargado.
      Cuidado, es un baremo durisimo: basta que un equipo tenga una compilacion
      mas nueva para que todos los demas salgan atrasados, y con miles de
      aplicaciones eso son gigabytes. Carga antes el parque y el catalogo en el
      tablero y vuelve a descargar este script: llevara tu estandar dentro.`}

        resumen_catalogo.csv     lo que no es excepcion
        resumen_parque.csv       un registro por equipo
        resumen_excepciones.csv  QUE equipo tiene QUE version por detras

      Los dos primeros y el tercero son complementarios: cada instalacion sale
      en uno o en el otro, nunca en los dos. Si contaran las mismas dos veces,
      el reparto de versiones saldria inflado. Por eso hay que cargar los TRES:
      con solo el catalogo veras unicamente lo que ya esta al dia.

      Las dos primeras dicen cuantos equipos hay en cada version. La tercera dice
      cuales son, que es lo unico que el catalogo agregado no puede dar y lo que
      hace falta para ir a arreglarlos. Solo lleva lo que va por detras de la
      version mas alta vista, que es una fraccion pequena del total.

    Uso:
      .\\resumir-detalle.ps1 -Ruta 'C:\\ruta\\salida\\detalle.csv'
      .\\resumir-detalle.ps1 -Ruta '...' -Apps 'Chrome','Java'   # solo esas
      .\\resumir-detalle.ps1 -Ruta '...' -Todas                   # corte por version mas alta
      .\\resumir-detalle.ps1 -Ruta '...' -Completo 'Microsoft Edge'

    -Completo saca TODAS las instalaciones de esas aplicaciones con nombre de
    equipo, esten al dia o no. Es lo que hace falta para responder «quien tiene
    esta version», porque de lo que esta al dia normalmente solo se cuenta
    cuantos son. Una aplicacion en un parque de 27.000 equipos son 27.000 filas.
      .\\resumir-detalle.ps1 -Ruta '...' -SinExcepciones          # las dos primeras

    Arrastra los TRES archivos al tablero, a la vez.
#>

param(
    [string]$Ruta,
    [string[]]$Apps,
    [switch]$SinExcepciones,
    [switch]$Todas,
    [int]$TopApps = 0,
    [string[]]$Completo
)

$ErrorActionPreference = 'Stop'
if (-not $Ruta) { $Ruta = Read-Host 'Ruta del CSV grande' }
$Ruta = $Ruta.Trim().Trim('"')
if (-not (Test-Path $Ruta)) { throw "No existe el archivo: $Ruta" }
$Ruta = (Resolve-Path $Ruta).Path

$info = Get-Item $Ruta
Write-Host ("Archivo: {0}  ({1:n1} MB)" -f $info.Name, ($info.Length / 1MB)) -ForegroundColor Cyan
if ($Apps) { Write-Host ("Solo aplicaciones que contengan: {0}" -f ($Apps -join ', ')) -ForegroundColor Cyan }

# El estandar del tablero, tal y como estaba al generar este script.
$S = [char]1
$E = New-Object 'System.Collections.Generic.Dictionary[string,string]'
${estandar}
if ($Todas) { $E.Clear() }
if ($TopApps -gt 0) { Write-Host ("Acotado a las {0} aplicaciones mas instaladas" -f $TopApps) -ForegroundColor Cyan }
if ($E.Count -gt 0) {
    Write-Host ("Corte: tu estandar, {0} aplicaciones con version aprobada" -f $E.Count) -ForegroundColor Cyan
} else {
    Write-Host 'Corte: la version mas alta vista. Baremo estricto: esto puede salir enorme.' -ForegroundColor Yellow
}

# En PowerShell puro, un bucle de varios millones de vueltas tarda mas que todo
# lo demas junto. Compilado, el limite pasa a ser el disco.
$fuente = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

public class Resumidor
{
    // Un CSV no se parte por comas y ya: un nombre como
    // "Microsoft Visual C++ 2015-2022 Redistributable (x64), 14.38" lleva la
    // suya dentro, entre comillas. Esto lee campo a campo respetandolas, y
    // aguanta saltos de linea dentro de un campo entrecomillado.
    static bool LeerFila(TextReader r, List<string> campos)
    {
        campos.Clear();
        StringBuilder campo = new StringBuilder();
        bool comillas = false, algo = false;
        int c;
        while ((c = r.Read()) != -1)
        {
            algo = true;
            char ch = (char)c;
            if (comillas)
            {
                if (ch == '"')
                {
                    if (r.Peek() == '"') { r.Read(); campo.Append('"'); }
                    else comillas = false;
                }
                else campo.Append(ch);
            }
            else if (ch == '"') comillas = true;
            else if (ch == ',') { campos.Add(campo.ToString()); campo.Length = 0; }
            else if (ch == '\\n') { campos.Add(campo.ToString()); return true; }
            else if (ch != '\\r') campo.Append(ch);
        }
        if (!algo) return false;
        campos.Add(campo.ToString());
        return true;
    }

    static string Tramo(string s, ref int i, out bool numerico)
    {
        numerico = char.IsDigit(s[i]);
        int i0 = i;
        while (i < s.Length && char.IsLetterOrDigit(s[i]) && char.IsDigit(s[i]) == numerico) i++;
        return s.Substring(i0, i - i0);
    }

    // Comparar versiones como texto es el error clasico: "1.10" saldria por
    // debajo de "1.9". Se compara tramo a tramo, y los numericos como numeros.
    // Debe dar exactamente lo mismo que verCmp() del tablero: si discrepan,
    // marcan cosas distintas.
    static int CmpVer(string a, string b)
    {
        int i = 0, j = 0;
        while (true)
        {
            while (i < a.Length && !char.IsLetterOrDigit(a[i])) i++;
            while (j < b.Length && !char.IsLetterOrDigit(b[j])) j++;
            bool finA = i >= a.Length, finB = j >= b.Length;
            if (finA && finB) return 0;

            string ta, tb;
            bool da, db;
            if (finA)
            {
                // "2.0" y "2.0.0" son la misma version: el tramo que falta vale
                // cero, y solo decide si el otro no lo es.
                tb = Tramo(b, ref j, out db);
                if (!db) return -1;
                ta = "0"; da = true;
            }
            else if (finB)
            {
                ta = Tramo(a, ref i, out da);
                if (!da) return 1;
                tb = "0"; db = true;
            }
            else
            {
                ta = Tramo(a, ref i, out da);
                tb = Tramo(b, ref j, out db);
            }

            if (da && db)
            {
                // sin convertir a numero: un tramo puede no caber en un entero
                string sa = ta.TrimStart('0'), sb = tb.TrimStart('0');
                if (sa.Length != sb.Length) return sa.Length < sb.Length ? -1 : 1;
                int c = string.CompareOrdinal(sa, sb);
                if (c != 0) return c < 0 ? -1 : 1;
            }
            else if (da != db)
            {
                return da ? 1 : -1;   // un tramo numerico pesa mas que uno de letras
            }
            else
            {
                int c = string.Compare(ta, tb, StringComparison.OrdinalIgnoreCase);
                if (c != 0) return c < 0 ? -1 : 1;
            }
        }
    }

    static int Indice(List<string> cab, string[] candidatos)
    {
        for (int k = 0; k < candidatos.Length; k++)
            for (int i = 0; i < cab.Count; i++)
                if (string.Equals(cab[i].Trim(), candidatos[k], StringComparison.OrdinalIgnoreCase))
                    return i;
        return -1;
    }

    static string Campo(List<string> f, int i)
    {
        if (i < 0 || i >= f.Count) return "";
        return f[i].Trim();
    }

    static string Csv(string s)
    {
        if (s == null) s = "";
        if (s.IndexOf('"') >= 0) s = s.Replace("\\"", "\\"\\"");
        return "\\"" + s + "\\"";
    }

    static int iDev, iApp, iVen, iVer, iUsr, iOs, iOsV;

    static bool Cabecera(StreamReader r, List<string> cab, out string error)
    {
        error = null;
        if (!LeerFila(r, cab)) { error = "El archivo esta vacio."; return false; }
        if (cab.Count > 0 && cab[0].Length > 0 && cab[0][0] == '\\uFEFF') cab[0] = cab[0].Substring(1);

        iDev = Indice(cab, new string[] { "DeviceName", "Device", "Equipo", "NombreEquipo", "ManagedDeviceName" });
        iApp = Indice(cab, new string[] { "ApplicationName", "SoftwareName", "DisplayName", "Aplicacion" });
        iVen = Indice(cab, new string[] { "ApplicationPublisher", "SoftwareVendor", "Publisher", "Fabricante" });
        iVer = Indice(cab, new string[] { "ApplicationVersion", "SoftwareVersion", "Version" });
        iUsr = Indice(cab, new string[] { "UserName", "UPN", "EmailAddress", "Usuario" });
        iOs  = Indice(cab, new string[] { "OSDescription", "Platform", "OS", "OSDistribution" });
        iOsV = Indice(cab, new string[] { "OSVersion", "OSVersionInfo" });

        if (iApp < 0 && iDev < 0)
        {
            error = "No encuentro ni columna de aplicacion ni de equipo. Cabecera: " + string.Join(", ", cab.ToArray());
            return false;
        }
        return true;
    }

    // Una sola definicion de "esto va atrasado", para que el catalogo y las
    // excepciones sean complementarios de verdad: lo que no es excepcion va al
    // catalogo, y al reves. Si cada uno lo decidiera por su cuenta, una
    // instalacion podria colarse en los dos o en ninguno.
    static bool EsExcepcion(string ven, string app, string ver,
                            Dictionary<string, string> estandar,
                            Dictionary<string, string> maxVer)
    {
        string tope;
        string clave = ven + "\\u0001" + app;
        if (estandar != null && estandar.Count > 0)
        {
            // Fuera del estandar no hay nada que reclamar.
            if (!estandar.TryGetValue(clave, out tope)) return false;
        }
        else if (!maxVer.TryGetValue(clave, out tope)) return false;
        return CmpVer(ver, tope) < 0;
    }

    // Como Interesa, pero con la lista vacia NO entra nada: -Completo es opt-in.
    static bool EsCompleto(string app, string[] completos)
    {
        if (completos == null || completos.Length == 0) return false;
        for (int i = 0; i < completos.Length; i++)
            if (app.IndexOf(completos[i], StringComparison.OrdinalIgnoreCase) >= 0) return true;
        return false;
    }

    static bool Interesa(string app, string[] filtro)
    {
        if (filtro == null || filtro.Length == 0) return true;
        for (int i = 0; i < filtro.Length; i++)
            if (app.IndexOf(filtro[i], StringComparison.OrdinalIgnoreCase) >= 0) return true;
        return false;
    }

    public static string Procesar(string ruta, string salidaCat, string salidaPar,
                                  string salidaExc, string[] filtro,
                                  Dictionary<string, string> estandar, int topApps,
                                  string[] completos, string salidaDet)
    {
        Dictionary<string, int> apps = new Dictionary<string, int>(StringComparer.Ordinal);
        Dictionary<string, string> maxVer = new Dictionary<string, string>(StringComparer.Ordinal);
        Dictionary<string, string[]> devs = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);

        long filas = 0;
        List<string> cab = new List<string>();
        List<string> f = new List<string>();
        string error;

        // --- pasada 1: contar, y quedarse con la version mas alta de cada app
        using (StreamReader r = new StreamReader(ruta, Encoding.UTF8, true, 1 << 20))
        {
            if (!Cabecera(r, cab, out error)) return error;
            while (LeerFila(r, f))
            {
                if (f.Count == 1 && f[0].Length == 0) continue;
                filas++;

                string dev = Campo(f, iDev);
                if (dev.Length > 0 && !devs.ContainsKey(dev))
                    devs[dev] = new string[] { dev, Campo(f, iUsr), Campo(f, iOs), Campo(f, iOsV) };

                string app = Campo(f, iApp);
                if (app.Length == 0) continue;
                if (!Interesa(app, filtro)) continue;

                string ven = Campo(f, iVen), ver = Campo(f, iVer);
                string clave = ven + "\\u0001" + app + "\\u0001" + ver;
                int n;
                apps.TryGetValue(clave, out n);
                apps[clave] = n + 1;

                string claveApp = ven + "\\u0001" + app;
                string alta;
                if (!maxVer.TryGetValue(claveApp, out alta) || CmpVer(ver, alta) > 0)
                    maxVer[claveApp] = ver;
            }
        }

        // -TopApps: quedarse con las N aplicaciones mas instaladas. Se decide con
        // las cuentas de la pasada 1, no con el orden del archivo, para que el
        // recorte sea por relevancia y no por donde cayeron las filas.
        if (topApps > 0)
        {
            Dictionary<string, long> porApp = new Dictionary<string, long>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, int> kv in apps)
            {
                string[] pp = kv.Key.Split('\\u0001');
                string ka = pp[0] + "\\u0001" + pp[1];
                long acc;
                porApp.TryGetValue(ka, out acc);
                porApp[ka] = acc + kv.Value;
            }
            List<KeyValuePair<string, long>> orden = new List<KeyValuePair<string, long>>(porApp);
            orden.Sort(delegate(KeyValuePair<string, long> x, KeyValuePair<string, long> y)
                       { return y.Value.CompareTo(x.Value); });
            HashSet<string> quedan = new HashSet<string>(StringComparer.Ordinal);
            for (int t = 0; t < orden.Count && t < topApps; t++) quedan.Add(orden[t].Key);
            Dictionary<string, string> podado = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (string ka in quedan)
            {
                string v;
                if (estandar != null && estandar.TryGetValue(ka, out v)) podado[ka] = v;
                else if (maxVer.TryGetValue(ka, out v)) podado[ka] = v;
            }
            estandar = podado;
        }

        // Si van a salir excepciones, el catalogo lleva SOLO lo que esta en la
        // version mas alta. Lo demas va en el otro archivo con nombre de equipo,
        // y contarlo en los dos sitios duplicaria cada instalacion atrasada.
        bool soloAlMaximo = !string.IsNullOrEmpty(salidaExc);
        long escritas = 0;
        using (StreamWriter w = new StreamWriter(salidaCat, false, new UTF8Encoding(true)))
        {
            w.WriteLine("SoftwareVendor,SoftwareName,SoftwareVersion,Equipos");
            foreach (KeyValuePair<string, int> kv in apps)
            {
                string[] partes = kv.Key.Split('\\u0001');
                // Lo que se lleva el detalle completo no vuelve a contarse aqui.
                if (EsCompleto(partes[1], completos)) continue;
                if (soloAlMaximo && EsExcepcion(partes[0], partes[1], partes[2], estandar, maxVer)) continue;
                w.WriteLine(Csv(partes[0]) + "," + Csv(partes[1]) + "," + Csv(partes[2]) + "," +
                            kv.Value.ToString(CultureInfo.InvariantCulture));
                escritas++;
            }
        }

        using (StreamWriter w = new StreamWriter(salidaPar, false, new UTF8Encoding(true)))
        {
            w.WriteLine("DeviceName,UserName,OSDistribution,OSVersionInfo");
            foreach (KeyValuePair<string, string[]> kv in devs)
            {
                string[] v = kv.Value;
                w.WriteLine(Csv(v[0]) + "," + Csv(v[1]) + "," + Csv(v[2]) + "," + Csv(v[3]));
            }
        }

        long excep = 0, det = 0;
        if (!string.IsNullOrEmpty(salidaExc))
        {
            // --- pasada 2: QUE equipo va por detras. Es lo unico que el catalogo
            // agregado no puede dar, y es una fraccion pequena del archivo.
            const string CAB = "DeviceName,UserName,SoftwareVendor,SoftwareName,SoftwareVersion,Aprobada,OSVersionInfo";
            StreamWriter wd = null;
            try
            {
                if (!string.IsNullOrEmpty(salidaDet)) { wd = new StreamWriter(salidaDet, false, new UTF8Encoding(true)); wd.WriteLine(CAB); }
                using (StreamReader r = new StreamReader(ruta, Encoding.UTF8, true, 1 << 20))
                using (StreamWriter w = new StreamWriter(salidaExc, false, new UTF8Encoding(true)))
                {
                    cab.Clear();
                    if (!Cabecera(r, cab, out error)) return error;
                    w.WriteLine(CAB);
                    while (LeerFila(r, f))
                    {
                        if (f.Count == 1 && f[0].Length == 0) continue;
                        string dev = Campo(f, iDev), app = Campo(f, iApp);
                        if (dev.Length == 0 || app.Length == 0) continue;
                        if (!Interesa(app, filtro)) continue;

                        string ven = Campo(f, iVen), ver = Campo(f, iVer);
                        string tope, clave = ven + "\\u0001" + app;
                        if (estandar == null || estandar.Count == 0 || !estandar.TryGetValue(clave, out tope))
                            maxVer.TryGetValue(clave, out tope);

                        // -Completo: todo, al dia o no, y no pasa por las otras salidas
                        if (wd != null && EsCompleto(app, completos))
                        {
                            wd.WriteLine(Csv(dev) + "," + Csv(Campo(f, iUsr)) + "," + Csv(ven) + "," + Csv(app) + "," +
                                         Csv(ver) + "," + Csv(tope) + "," + Csv(Campo(f, iOsV)));
                            det++;
                            continue;
                        }
                        if (!EsExcepcion(ven, app, ver, estandar, maxVer)) continue;

                        w.WriteLine(Csv(dev) + "," + Csv(Campo(f, iUsr)) + "," + Csv(ven) + "," + Csv(app) + "," +
                                    Csv(ver) + "," + Csv(tope) + "," + Csv(Campo(f, iOsV)));
                        excep++;
                    }
                }
            }
            finally { if (wd != null) wd.Dispose(); }
        }

        return string.Format(CultureInfo.InvariantCulture, "OK|{0}|{1}|{2}|{3}|{4}",
                             filas, escritas, devs.Count, excep, det);
    }
}
'@

Add-Type -TypeDefinition $fuente -Language CSharp

$carpeta = Split-Path $Ruta -Parent
$salidaCat = Join-Path $carpeta 'resumen_catalogo.csv'
$salidaPar = Join-Path $carpeta 'resumen_parque.csv'
$salidaExc = if ($SinExcepciones) { $null } else { Join-Path $carpeta 'resumen_excepciones.csv' }
$salidaDet = if ($Completo -and -not $SinExcepciones) { Join-Path $carpeta 'resumen_detalle.csv' } else { $null }
if ($Completo) { Write-Host ("Detalle completo de: {0}" -f ($Completo -join ', ')) -ForegroundColor Cyan }

Write-Host 'Recorriendo el archivo. No se carga en memoria; con varios GB tarda unos minutos...' -ForegroundColor Cyan
$reloj = [Diagnostics.Stopwatch]::StartNew()
$res = [Resumidor]::Procesar($Ruta, $salidaCat, $salidaPar, $salidaExc, $Apps, $E, $TopApps, $Completo, $salidaDet)
$reloj.Stop()

if (-not $res.StartsWith('OK|')) { throw $res }
$partes = $res.Split('|')
$nExc = [long]$partes[4]

Write-Host ''
Write-Host ("Listo en {0:n0} s" -f $reloj.Elapsed.TotalSeconds) -ForegroundColor Green
Write-Host ("  {0,12:n0} filas leidas" -f [long]$partes[1])
Write-Host ("  {0,12:n0} al dia              -> {1}" -f [int]$partes[2], (Split-Path $salidaCat -Leaf)) -ForegroundColor Green
Write-Host ("  {0,12:n0} equipos             -> {1}" -f [int]$partes[3], (Split-Path $salidaPar -Leaf)) -ForegroundColor Green
if ($salidaExc) {
    Write-Host ("  {0,12:n0} desactualizados     -> {1}" -f $nExc, (Split-Path $salidaExc -Leaf)) -ForegroundColor Green
    if ($salidaDet) {
        Write-Host ("  {0,12:n0} detalle completo    -> {1}" -f [long]$partes[5], (Split-Path $salidaDet -Leaf)) -ForegroundColor Green
    }
    $mb = (Get-Item $salidaExc).Length / 1MB
    Write-Host ("  {0,12:n1} MB de excepciones" -f $mb) -ForegroundColor DarkGray
    if ($mb -gt 400) {
        Write-Host ''
        Write-Host ('AVISO: {0:n0} MB no entran en el tablero, que corta en 400 MB.' -f $mb) -ForegroundColor Yellow
        Write-Host 'No se ha recortado nada a proposito: un recorte silencioso sesga el analisis.' -ForegroundColor Yellow
        if ($E.Count -eq 0) {
            Write-Host 'Lo mas probable es el corte: sin estandar se compara contra la version mas' -ForegroundColor Yellow
            Write-Host 'alta vista, y casi todo queda por debajo. Carga parque y catalogo en el' -ForegroundColor Yellow
            Write-Host 'tablero, vuelve a descargar el script y repite: llevara tu estandar dentro.' -ForegroundColor Yellow
        } else {
            Write-Host "Acotalo mas:  -Apps 'Chrome','Java'   o ajusta el alcance en Administracion." -ForegroundColor Yellow
        }
    }
}
Write-Host ''
Write-Host 'Arrastra los archivos al tablero, todos a la vez.' -ForegroundColor Cyan
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
  for (const id of ['parque', 'catalogo', 'detalle']) {
    if (!opts[id]) continue;
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
    Inventario de Aplicaciones - extraccion desde Microsoft Intune
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
      2. Ejecuta:  .\\extraer-intune.ps1
      3. Espera: un informe grande tarda varios minutos en generarse.
      4. Arrastra los CSV de la carpeta 'salida' al tablero, todos a la vez.
#>

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
Write-Host ''
Write-Host ("Listo. Archivos en: {0}" -f $Salida) -ForegroundColor Cyan
Write-Host 'Arrastralos TODOS a la vez sobre el tablero: se funden en un solo modelo.' -ForegroundColor Cyan
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

  return viewHead('Origen de datos',
    'De dónde salen los números: los archivos cargados, las consultas que los producen y la conexión directa con Defender.') +
    sec('Fuentes cargadas', 'Se funden entre sí: parque, catálogo y excepciones forman un solo modelo. Puedes quitar el que hayas cargado por error') +
    fuentes +
    '<div id="anclaConsultas"></div>' +
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
    sec('Intune', 'El camino sin tope de filas: los informes se entregan como archivo, no como respuesta') +
    `<div class="banner" style="margin-bottom:16px">${ico('info')}<div>
      <b>Intune no tiene el límite de 100.000 filas.</b> Advanced Hunting responde a una consulta y ahí
      está el tope; Intune genera un <b>informe en segundo plano</b> y te devuelve un enlace a un ZIP, así
      que el inventario completo sale entero y sin lotes. A cambio no trae <code>EndOfSupportStatus</code>,
      ni vulnerabilidades, ni los equipos que tengan sensor de Defender pero no estén inscritos en Intune:
      para eso sigue haciendo falta Defender. <b>Puedes cargar los dos</b>: el tablero los funde.
    </div></div>
    <div class="adm-grid">
      <div class="card"><div class="card-h"><div><h3>Script de PowerShell</h3>
        <p>Pide los informes, espera a que se generen y descomprime los CSV</p></div></div>
        <div style="margin-top:14px">
          <label class="chk" style="margin-bottom:8px"><input type="checkbox" id="inParque" checked>
            Parque de equipos <span class="mini" style="color:var(--ink-4)">· DevicesWithInventory</span></label><br>
          <label class="chk" style="margin-bottom:8px"><input type="checkbox" id="inCatalogo" checked>
            Catálogo agregado <span class="mini" style="color:var(--ink-4)">· AppInvAggregate</span></label><br>
          <label class="chk" style="margin-bottom:12px"><input type="checkbox" id="inDetalle">
            Detalle crudo por equipo <span class="mini" style="color:var(--ink-4)">· AppInvRawData</span></label>
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
            <span class="hint">Es <b>OData, no KQL</b>: nada que ver con el filtro de Advanced Hunting de
              arriba. Cada informe admite unos campos distintos, así que si falla, déjalo vacío.</span></div>
          <button class="btn btn-p" data-gx="intune">Descargar extraer-intune.ps1</button>
        </div>
      </div>
      <div class="card"><div class="card-h"><div><h3>Si el detalle no cabe</h3>
        <p>Y con un parque grande no cabe: son gigabytes</p></div></div>
        <div style="margin-top:14px;font-size:12.5px;color:var(--ink-3);line-height:1.7">
          <p style="margin:0 0 10px">El navegador no puede con el detalle crudo entero. No es cuestión de
            optimizar: reservar el archivo y decodificarlo a texto lo <b>duplica</b>, porque las cadenas de
            JavaScript son UTF-16. Por encima de <b>400&nbsp;MB</b> el tablero ni lo intenta.</p>
          <p style="margin:0 0 12px">Pero abrirlo entero no hace falta. <code>preparar-duckdb.ps1</code> lo
            recorre <b>en tu equipo</b>, sin cargarlo en memoria, y saca de él lo que el tablero sí usa:
            el catálogo y el parque. De gigabytes salen unos pocos MB, <b>sin perder ningún equipo ni
            ninguna versión</b>.</p>
          <p style="margin:0 0 12px">Y saca también <b>qué equipo tiene qué versión por detrás</b>, que es
            lo único que el catálogo agregado no puede dar: con él sabes <i>cuántos</i> equipos van
            atrasados, pero no <i>cuáles</i>, y la tabla «Equipos con esta aplicación» sale vacía.
            Solo lleva lo que va por detrás de la versión más alta, que es una fracción pequeña
            del archivo.</p>
          <button class="btn btn-p" data-gx="duck">Descargar preparar-duckdb.ps1</button>
          <button class="btn" data-gx="resumir" style="margin-left:8px">Version sin DuckDB</button>
        </div>
      </div>
      <div class="card"><div class="card-h"><div><h3>Qué permiso necesita</h3>
        <p>Uno solo, y es de los que ya suele estar concedido</p></div></div>
        <div style="margin-top:14px;font-size:12.5px;color:var(--ink-3);line-height:1.7">
          <p style="margin:0 0 10px">Con <code>DeviceManagementManagedDevices.Read.All</code> basta para
            los tres informes. Si además tienes <code>DeviceManagementApps.Read.All</code> y
            <code>Directory.Read.All</code>, no estorban, pero no hacen falta aquí.</p>
          <p style="margin:0 0 10px">Como el permiso figura de tipo <b>Aplicación</b>, la app se autentica
            contra sí misma: no hay usuario, y por eso no aplican ni la asignación de usuario ni la URI de
            redirección. Eso sí, <b>necesita una credencial</b>: un client secret o un certificado.</p>
          <p style="margin:0">El secreto <b>no viaja dentro del script</b>. Se pide al ejecutarlo, o se lee
            de la variable <code>GRAPH_SECRET</code>, y se borra de memoria en cuanto se canjea el token.</p>
        </div>
        <div class="banner" style="margin:14px 0 0">${ico('shield')}<div>
          El informe grande tarda: <code>AppInvRawData</code> de un parque de 26.000 equipos son más de un
          millón de filas y puede pasar de diez minutos generándose. El script espera solo, con puntos.
          <b>No lo cargues entero en el tablero</b>: el navegador no aguanta ese detalle. Para el análisis
          usa parque + catálogo, y el detalle solo acotado con el filtro.
        </div></div>
      </div>
    </div>`;
}
