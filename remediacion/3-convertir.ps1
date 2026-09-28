<#
    Linea base por ruta de archivo  -  paso 3 de 3:  del CSV de Intune al tablero

    De donde sale el CSV de entrada:
      Intune > Dispositivos > Remediaciones > [la tuya] > Estado del dispositivo
      > Exportar. Baja una fila por equipo, con la salida del script de
      deteccion en una columna.

    Que hace esto:
      Esa columna trae 23 aplicaciones apelmazadas en una cadena. El tablero
      quiere una fila por instalacion. Aqui se desdobla y se le ponen las
      cabeceras que el tablero ya reconoce:

          DeviceName, SoftwareVendor, SoftwareName, SoftwareVersion, LastContact

      El resultado se arrastra al tablero como una fuente mas y se funde con lo
      que ya venga de Intune: si Netskope aparece por los dos lados, es la misma
      aplicacion y el mismo equipo, y no se cuenta dos veces.

      De regalo viene LastContact, que el informe de aplicaciones de Intune no
      trae: de ahi sale la "ultima sincronizacion" que hoy te sale vacia.

    Uso:
      .\3-convertir.ps1 .\DeviceStatus.csv
      .\3-convertir.ps1 .\DeviceStatus.csv -Parquet          (si tienes duckdb)
      .\3-convertir.ps1 .\DeviceStatus.csv -Listar           (que ids llegaron)

    Nada de esto sale del equipo. El archivo que produce lleva nombres de
    maquinas de tu parque: no lo dejes caer en una carpeta sincronizada.
#>

param(
    [Parameter(Position = 0)]
    [string]$Entrada = '',
    [string]$Salida = '',
    [string]$Duck = 'duckdb',
    [switch]$Parquet,
    [switch]$Listar
)

$ErrorActionPreference = 'Stop'

# ======================================================== FABRICANTES
#
# El canal de la remediacion es estrecho -2.048 caracteres- asi que por ahi
# viaja solo "nombre=version". El fabricante se pone aqui, que no cuesta nada,
# y sirve para que estas filas se fundan con las de Intune en vez de quedar
# como aplicaciones aparte.
#
# >>> Esta tabla la rellena 1-preparar.ps1 con los fabricantes tal y como los
#     escribe cada uno en el registro. Lo de abajo es solo el arranque.  <<<
# Lo que no este en la tabla entra sin fabricante, que el tablero muestra
# como "(sin fabricante)". No se rompe nada, solo queda peor etiquetado.

# <<<FABRICANTES>>>
$Fabricantes = @{
    'Adobe Acrobat Reader DC'                 = 'Adobe'
    'Citrix WorkSpace 2402'                   = 'Citrix Systems, Inc.'
    'Cliente SCCM OSD'                        = 'Microsoft Corporation'
    'Lexmark Scanback'                        = 'Lexmark International, Inc.'
    'Lexmark_PostScript_Admin_Mayo2025_V2'    = 'Lexmark International, Inc.'
    'Local Administrator Password Solution'   = 'Microsoft Corporation'
    'Micro Focus EXTRA X-treme'               = 'Micro Focus'
    'Microsoft 365 Monthly Mayo 2026'         = 'Microsoft Corporation'
    'Microsoft Purview Information Protection'= 'Microsoft Corporation'
    'NessusAgent 11.1.3'                      = 'Tenable, Inc.'
    'Netskope 132.0.20.2563'                  = 'Netskope, Inc.'
    'Netskope'                                = 'Netskope, Inc.'
    'Nexthink'                                = 'Nexthink'
    'Remote Help'                             = 'Microsoft Corporation'
    'Tech Pulse'                              = 'HP Inc.'
    'Webex 46.5.0.34931'                      = 'Cisco Systems, Inc.'
    'Webex'                                   = 'Cisco Systems, Inc.'
    'BCO_CORTEX_LB_UPD'                       = 'Palo Alto Networks'
    'BCO_LB_CLEARPASS-ONGUARD_UPD'            = 'Aruba Networks'
}
# <<<FIN FABRICANTES>>>

# ======================================================== EL MOTOR

# Sin argumento, se busca el export mas reciente. Lo normal es acabar de
# bajarlo del portal, y obligarte a copiar la ruta no aporta nada: se reconoce
# por la cabecera, que es la unica forma segura de no confundirlo con otro CSV.
function Buscar-Export {
    $sitios = @()
    try {
        $sf = Get-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders' -ErrorAction Stop
        $d = $sf.'{374DE290-123F-4565-9164-39C4925E467B}'
        if ($d) { $sitios += $d }
    } catch { }
    $sitios += (Join-Path $env:USERPROFILE 'Downloads')
    if ($PSScriptRoot) { $sitios += $PSScriptRoot }
    $sitios += (Get-Location).Path

    $vistos = @{}
    $cands = @()
    foreach ($s in $sitios) {
        if (-not $s -or $vistos.ContainsKey($s) -or -not (Test-Path -LiteralPath $s)) { continue }
        $vistos[$s] = $true
        $cands += @(Get-ChildItem -LiteralPath $s -Filter *.csv -File -ErrorAction SilentlyContinue |
                    Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-45) })
    }
    foreach ($c in ($cands | Sort-Object LastWriteTime -Descending)) {
        $cab = ''
        try { $cab = (Get-Content -LiteralPath $c.FullName -TotalCount 1 -ErrorAction Stop) } catch { continue }
        $n = ($cab.ToLowerInvariant() -replace '[^a-z0-9]', '')
        if ($n.Contains('remediation') -or $n.Contains('correccion') -or
            $n.Contains('deteccion') -or $n.Contains('detectionoutput')) { return $c.FullName }
    }
    return ''
}

if (-not $Entrada) {
    $Entrada = Buscar-Export
    if (-not $Entrada) {
        throw ('No encuentro ningun export de remediacion en Descargas. ' +
               'Bajalo del portal -Remediaciones > la tuya > Estado del dispositivo > ' +
               'Exportar- o pasame la ruta:  .\3-convertir.ps1 C:\ruta\DeviceStatus.csv')
    }
    Write-Host ''
    Write-Host ("  Encontrado:  {0}" -f $Entrada) -ForegroundColor DarkGray
}
if (-not (Test-Path -LiteralPath $Entrada)) { throw "No encuentro $Entrada" }
$Entrada = (Resolve-Path -LiteralPath $Entrada).Path

if (-not $Salida) {
    $Salida = Join-Path (Split-Path -Parent $Entrada) 'rutas-detectadas.csv'
}

# Las cabeceras del informe de Intune cambian de nombre entre versiones de la
# consola y entre idiomas. En vez de fijarlas, se buscan como hace el tablero:
# normalizando y comparando.
function Norma([string]$s) {
    if (-not $s) { return '' }
    return (($s.ToLowerInvariant()) -replace '[^a-z0-9]', '')
}

function Columna-Por($cabeceras, [string[]]$exactas, [string[]]$contiene, [string[]]$excluye) {
    foreach ($e in $exactas) {
        foreach ($c in $cabeceras) { if ((Norma $c) -eq $e) { return $c } }
    }
    foreach ($e in $contiene) {
        foreach ($c in $cabeceras) {
            $n = Norma $c
            if ($n.Contains($e)) {
                $malo = $false
                foreach ($x in $excluye) { if ($n.Contains($x)) { $malo = $true } }
                if (-not $malo) { return $c }
            }
        }
    }
    return ''
}

# Intune exporta en UTC, con la Z al final. Se conserva tal cual: pasarla a hora
# local aqui haria que el mismo CSV diera fechas distintas segun en que equipo
# se convierta, y esta fecha solo sirve para saber como de fresco es el dato.
# Primero cultura invariante -consola en ingles, 9/15/2026- y luego la del
# equipo, por si la consola exporta en espanol.
function Fecha-De([string]$s) {
    if (-not $s) { return $null }
    $rk = [Globalization.DateTimeStyles]::RoundtripKind
    $d = [datetime]::MinValue
    if ([datetime]::TryParse($s, [Globalization.CultureInfo]::InvariantCulture, $rk, [ref]$d)) { return $d }
    if ([datetime]::TryParse($s, [Globalization.CultureInfo]::CurrentCulture, $rk, [ref]$d)) { return $d }
    return $null
}

Write-Host ''
Write-Host ("  Leyendo {0}" -f (Split-Path -Leaf $Entrada)) -ForegroundColor Cyan
$filas = @(Import-Csv -LiteralPath $Entrada)
if (-not $filas.Count) { throw 'El CSV no trae filas.' }

$cab = $filas[0].PSObject.Properties.Name

$cEquipo = Columna-Por $cab @('devicename', 'nombrededispositivo', 'nombredispositivo', 'equipo') `
                            @('devicename', 'device', 'dispositivo', 'equipo', 'hostname') @('id')
$cCarga  = Columna-Por $cab @() `
                            @('preremediationdetection', 'detectionoutput', 'preremediation',
                              'saliddeteccion', 'saliddedeteccion', 'output', 'salida') @()
$cUsr    = Columna-Por $cab @('username', 'upn', 'usuario') @('user', 'upn', 'usuario') @('id')
$cFecha  = Columna-Por $cab @() @('lastrun', 'ultimaejecucion', 'date', 'fecha', 'time', 'hora') @()

if (-not $cEquipo) { throw ("No reconozco la columna del equipo. Cabeceras: " + ($cab -join ', ')) }
if (-not $cCarga)  { throw ("No reconozco la columna de la salida del script. Cabeceras: " + ($cab -join ', ')) }

Write-Host ("  Equipo   -> {0}" -f $cEquipo) -ForegroundColor DarkGray
Write-Host ("  Salida   -> {0}" -f $cCarga)  -ForegroundColor DarkGray
if ($cUsr)   { Write-Host ("  Usuario  -> {0}" -f $cUsr)   -ForegroundColor DarkGray }
if ($cFecha) { Write-Host ("  Fecha    -> {0}" -f $cFecha) -ForegroundColor DarkGray }

# Un equipo puede aparecer varias veces si la remediacion lleva dias corriendo.
# Se queda la ejecucion mas reciente; a falta de fecha, la ultima del archivo.
$ultima = @{}
foreach ($f in $filas) {
    $eq = [string]$f.$cEquipo
    if (-not $eq) { continue }
    $carga = [string]$f.$cCarga
    if (-not $carga -or $carga -notlike 'LB1;*') { continue }

    $fecha = $null
    if ($cFecha) { $fecha = Fecha-De ([string]$f.$cFecha) }

    if ($ultima.ContainsKey($eq)) {
        $prev = $ultima[$eq]
        if ($fecha -and $prev.Fecha -and $fecha -le $prev.Fecha) { continue }
        if (-not $fecha -and $prev.Fecha) { continue }
    }
    $ultima[$eq] = [PSCustomObject]@{
        Carga = $carga
        Fecha = $fecha
        Usr   = if ($cUsr) { [string]$f.$cUsr } else { '' }
    }
}

Write-Host ("  {0} filas, {1} equipos con datos" -f $filas.Count, $ultima.Count) -ForegroundColor DarkGray

if (-not $ultima.Count) {
    Write-Host ''
    Write-Host '  Ningun equipo trae carga util en formato LB1.' -ForegroundColor Red
    Write-Host '  Si la columna de salida esta vacia para todos, abre 2-deteccion.ps1' -ForegroundColor DarkYellow
    Write-Host '  y pon $CodigoSalida = 1: algunos inquilinos solo guardan la salida' -ForegroundColor DarkYellow
    Write-Host '  cuando el equipo se marca como "con problemas".' -ForegroundColor DarkYellow
    Write-Host ''
    exit 1
}

# ---------------------------------------------------------------- a escribir
# A mano y con StreamWriter: son cientos de miles de filas y Export-Csv por
# tuberia tarda minutos en lo que esto tarda segundos.
function Cs([string]$v) {
    if ($null -eq $v) { return '' }
    if ($v.IndexOf(',') -ge 0 -or $v.IndexOf('"') -ge 0 -or $v.IndexOf("`n") -ge 0 -or $v.IndexOf("`r") -ge 0) {
        return '"' + $v.Replace('"', '""') + '"'
    }
    return $v
}

$enc = New-Object System.Text.UTF8Encoding($true)
$sw = New-Object System.IO.StreamWriter($Salida, $false, $enc)
$nFilas = 0
$ids = @{}
$cortados = 0

try {
    $sw.WriteLine('DeviceName,SoftwareVendor,SoftwareName,SoftwareVersion,UserName,LastContact')
    foreach ($eq in $ultima.Keys) {
        $d = $ultima[$eq]
        $trozos = $d.Carga.Split(';')
        if ($trozos.Length -lt 3) { continue }
        $cuerpo = $trozos[2]
        if ($cuerpo -like '*+CORTADO*') { $cortados++; $cuerpo = $cuerpo.Replace('~+CORTADO', '') }
        if (-not $cuerpo) { continue }

        $fecha = ''
        if ($d.Fecha) { $fecha = $d.Fecha.ToString('yyyy-MM-dd HH:mm:ss') }

        foreach ($par in $cuerpo.Split('~')) {
            $i = $par.IndexOf('=')
            if ($i -le 0) { continue }
            $id  = $par.Substring(0, $i)
            $ver = $par.Substring($i + 1)
            if (-not $id) { continue }
            $ids[$id] = $true

            $fab = ''
            if ($Fabricantes.ContainsKey($id)) { $fab = $Fabricantes[$id] }

            $sw.WriteLine((Cs $eq) + ',' + (Cs $fab) + ',' + (Cs $id) + ',' +
                          (Cs $ver) + ',' + (Cs $d.Usr) + ',' + (Cs $fecha))
            $nFilas++
        }
    }
} finally { $sw.Close() }

Write-Host ''
Write-Host ("  {0} instalaciones escritas en {1}" -f $nFilas, (Split-Path -Leaf $Salida)) -ForegroundColor Green
if ($cortados) {
    Write-Host ("  {0} equipos traen la salida cortada por el tope de Intune." -f $cortados) -ForegroundColor Red
    Write-Host '  Parte los objetivos en dos remediaciones.' -ForegroundColor DarkYellow
}

if ($Listar) {
    Write-Host ''
    Write-Host '  Ids que llegaron, y si tienen fabricante:' -ForegroundColor Cyan
    foreach ($k in ($ids.Keys | Sort-Object)) {
        $f = if ($Fabricantes.ContainsKey($k)) { $Fabricantes[$k] } else { '(sin fabricante)' }
        Write-Host ("    {0,-44} {1}" -f $k, $f) -ForegroundColor DarkGray
    }
}

# ---------------------------------------------------------------- parquet
if ($Parquet) {
    $duck = $Duck
    if (-not (Get-Command $duck -ErrorAction SilentlyContinue)) {
        Write-Host '  duckdb no esta en el PATH; me quedo con el CSV.' -ForegroundColor DarkYellow
    } else {
        # duckdb trata \ como escape: todas las rutas con /
        $eIn  = $Salida.Replace('\', '/')
        $eOut = [IO.Path]::ChangeExtension($Salida, '.parquet').Replace('\', '/')
        $sql = "COPY (SELECT * FROM read_csv_auto('$eIn', header=true)) TO '$eOut' (FORMAT PARQUET, COMPRESSION ZSTD);"
        & $duck -c $sql
        if ($LASTEXITCODE -eq 0) {
            Write-Host ("  Parquet: {0}" -f (Split-Path -Leaf $eOut)) -ForegroundColor Green
        }
    }
}

Write-Host ''
Write-Host '  Arrastralo al tablero. Entra como una fuente mas y se funde con Intune.' -ForegroundColor Cyan
Write-Host ''
