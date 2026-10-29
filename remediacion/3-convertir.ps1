<#
    De la salida de una remediacion de Intune al tablero  -  paso 3 de 3

    De donde sale el CSV de entrada:
      Intune > Dispositivos > Remediaciones > [la tuya] > Estado del dispositivo
      > Exportar. Baja una fila por equipo, con la salida del script de
      deteccion en una columna.

    Que hace esto:
      Esa columna trae varias cosas apelmazadas en una sola cadena. El tablero
      quiere una fila por dato. Aqui se desdobla y se le ponen las cabeceras que
      el tablero ya reconoce:

          DeviceName, SoftwareVendor, SoftwareName, SoftwareVersion, LastContact

    Reconoce dos formatos de salida, y no hay que decirle cual es:

      LB1;23;Netskope=132.0.20.2563~Webex=46.5.0
          el de 2-deteccion.ps1: linea base por ruta de archivo.

      Win 24H2 build 26100.6899 | Upgrade: SI el 2026-03-10 (desde 23H2 build
      22631.4890) | Ultimas KB: KB5066835 2026-10-14; KB5065426 2026-09-10
          nivel de parche de Windows, en una linea legible. De aqui sale el
          apartado Parches del tablero. Cada dato se saca por su forma -el KB
          parece un KB, la fecha parece una fecha- y no por su posicion, asi que
          la redaccion de la linea puede cambiar sin que esto deje de leerla.

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

# Los parches no caben en la tabla de arriba: cada KB es un numero distinto y
# salen varios nuevos cada mes, asi que se reconocen por la forma del nombre.
$Windows = @{
    'Parche de Windows'      = $true
    'Parche instalado'       = $true
    'Parche anterior'        = $true
    'Upgrade de Windows'     = $true
    'Windows instalado'      = $true
    'Windows anterior'       = $true
    'Compilacion de Windows' = $true
}
function Fabricante-De([string]$id) {
    if ($Fabricantes.ContainsKey($id)) { return $Fabricantes[$id] }
    if ($id -match '^KB\d+$' -or $Windows.ContainsKey($id)) { return 'Microsoft Corporation' }
    return ''
}

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

# ======================================================== EL OTRO FORMATO
#
# Una linea legible con el nivel de parche del equipo:
#
#   Win 24H2 build 26100.6899 | Upgrade: SI el 2026-03-10 (desde 23H2 build
#   22631.4890) | Ultimas KB: KB5066835 2026-10-14; KB5065426 2026-09-10
#
# No se parte por el separador ni se cuentan posiciones: cada dato se saca por
# su forma. Un KB parece un KB y una fecha parece una fecha, asi que la linea
# puede cambiar de redaccion -o de idioma- y esto sigue leyendola. Es lo que
# acaba pasando: el script lo retoca otra persona y nadie avisa.
function Parse-Win([string]$linea) {
    if (-not $linea) { return $null }
    $r = @{ Comp = ''; Rel = ''; Upg = ''; Inst = ''; Antes = ''; Kbs = @() }

    # La compilacion con su UBR: 26100.6899. Los ultimos digitos son el parche.
    $m = [regex]::Match($linea, '(?i)\bbuild\s+(\d{4,6})\.(\d+)')
    if (-not $m.Success) { $m = [regex]::Match($linea, '\b(\d{5,6})\.(\d{1,5})\b') }
    if ($m.Success) { $r.Comp = '10.0.' + $m.Groups[1].Value + '.' + $m.Groups[2].Value }

    # La version comercial, si viene escrita. Si no, el tablero la deduce de la
    # compilacion, que es de donde la saca para todo el resto del parque.
    $m = [regex]::Match($linea, '\b(2[0-9]H[12])\b')
    if ($m.Success) { $r.Rel = $m.Groups[1].Value }

    # Upgrade de version: si lo hubo, y desde donde.
    #
    # La fecha del tramo es la misma cosa en los dos casos -el dia en que se
    # instalo el Windows que hay ahora- se llame "upgrade el 2026-03-10" o
    # "instalacion limpia 2026-07-28". Asi que sale a su propio campo y el del
    # upgrade se queda con un si o un no. Se busca dentro del tramo -de ahi el
    # [^|]- para no acabar cogiendo la fecha de un KB.
    $m = [regex]::Match($linea, '(?i)upgrade[^a-z0-9]{0,4}([a-z]+)')
    if ($m.Success) {
        $tok = $m.Groups[1].Value.ToLowerInvariant()
        # Secos a proposito: estos valores acaban siendo la "version" de una
        # aplicacion en el catalogo del tablero, y ahi una frase estorba.
        if ($tok.StartsWith('s') -or $tok.StartsWith('y')) {
            $r.Upg = 'Si'
            $d = [regex]::Match($linea, '(?i)\b(?:desde|from)\s+([^)|;]+)')
            if ($d.Success) {
                $r.Antes = ($d.Groups[1].Value.Trim() -replace '(?i)\s+build\s+', ' ')
            }
        } elseif ($tok.StartsWith('n')) {
            $r.Upg = 'No'
        }
        $f = [regex]::Match($linea, '(?i)upgrade[^|]*?(\d{4}-\d{2}-\d{2})')
        if ($f.Success) { $r.Inst = $f.Groups[1].Value }
    }

    # Los KB, con la fecha que venga pegada detras.
    $vistos = @{}
    foreach ($k in [regex]::Matches($linea, '(?i)\b(KB\d{5,})\b(?:\s*[(\[]?\s*(\d{4}-\d{2}-\d{2}))?')) {
        $kb = $k.Groups[1].Value.ToUpperInvariant()
        if ($vistos.ContainsKey($kb)) { continue }
        $vistos[$kb] = $true
        $r.Kbs += New-Object PSObject -Property @{
            Kb = $kb; Fecha = $k.Groups[2].Value
        }
    }
    # El script los manda del mas nuevo al mas viejo, pero eso es una costumbre
    # suya, no una garantia. Si todos traen fecha se reordena por fecha, que es
    # el unico criterio que no miente: el numero de KB mas alto puede ser el mas
    # viejo -KB5132402 se instalo el 28 y KB5127936 el 29- y confiar en el
    # numero es justo el fallo que pone 'al dia' a un equipo que no lo esta.
    if ($r.Kbs.Count -gt 1 -and -not ($r.Kbs | Where-Object { -not $_.Fecha })) {
        $r.Kbs = @($r.Kbs | Sort-Object Fecha -Descending)
    }

    if (-not $r.Comp -and -not $r.Kbs.Count -and -not $r.Upg) { return $null }
    return $r
}

Write-Host ''
Write-Host ("  Leyendo {0}" -f (Split-Path -Leaf $Entrada)) -ForegroundColor Cyan
$filas = @(Import-Csv -LiteralPath $Entrada)
if (-not $filas.Count) { throw 'El CSV no trae filas.' }

$cab = $filas[0].PSObject.Properties.Name

$cEquipo = Columna-Por $cab @('devicename', 'nombrededispositivo', 'nombredispositivo', 'equipo') `
                            @('devicename', 'device', 'dispositivo', 'equipo', 'hostname') @('id')
# Dos trampas en la cabecera real de Intune.
#
# Una: junto a PreRemediationDetectionScriptOutput viaja
# PreRemediationDetectionScriptError, va ANTES en el archivo y tambien contiene
# "preremediationdetection". Se llevaba el puesto y todos los equipos salian sin
# carga. De ahi el nombre exacto primero y el "error" en la lista de excluidos.
#
# Y otra, con la consola en espanol: Norma() tira todo lo que no sea a-z0-9, y
# la tilde de "deteccion" se va con ella. "Salida de deteccion previa a la
# correccion" acaba siendo 'salidadedeteccinpreviaalacorreccin', con la i sola.
$cCarga  = Columna-Por $cab @('preremediationdetectionscriptoutput',
                              'predetectionscriptoutput') `
                            @('preremediationdetection', 'detectionoutput', 'preremediation',
                              'salidadedeteccin', 'salidadedeteccion', 'deteccinprevia',
                              'deteccionprevia', 'output', 'salida') @('error')
$cUsr    = Columna-Por $cab @('username', 'upn', 'usuario') @('user', 'upn', 'usuario') @('id')
# Aqui la trampa es "Last run message", que contiene 'lastrun' y no es una fecha
# sino un texto. Por eso van primero los nombres exactos y se excluye lo que
# sabemos que no es una fecha aunque lo parezca.
$cFecha  = Columna-Por $cab @('modifiedtime', 'lastsynctime', 'lastruntime') `
                            @('lastrun', 'lastsync', 'date', 'fecha', 'time', 'hora',
                              'ejecucin', 'ejecucion', 'sincronizacin', 'sincronizacion') `
                            @('message', 'mensaje', 'error', 'next', 'proxima', 'agent')

if (-not $cEquipo) { throw ("No reconozco la columna del equipo. Cabeceras: " + ($cab -join ', ')) }
if (-not $cCarga)  { throw ("No reconozco la columna de la salida del script. Cabeceras: " + ($cab -join ', ')) }

Write-Host ("  Equipo   -> {0}" -f $cEquipo) -ForegroundColor DarkGray
Write-Host ("  Salida   -> {0}" -f $cCarga)  -ForegroundColor DarkGray
if ($cUsr)   { Write-Host ("  Usuario  -> {0}" -f $cUsr)   -ForegroundColor DarkGray }
if ($cFecha) { Write-Host ("  Fecha    -> {0}" -f $cFecha) -ForegroundColor DarkGray }

# Un equipo puede aparecer varias veces si la remediacion lleva dias corriendo.
# Se queda la ejecucion mas reciente; a falta de fecha, la ultima del archivo.
$ultima = @{}
$nLb = 0
$nWin = 0
foreach ($f in $filas) {
    $eq = [string]$f.$cEquipo
    if (-not $eq) { continue }
    $carga = [string]$f.$cCarga
    if (-not $carga) { continue }

    # El formato se decide por lo que trae la linea, no por un ajuste: la misma
    # carpeta sirve para las dos remediaciones y una menos que recordar.
    $tipo = ''
    $win = $null
    if ($carga -like 'LB1;*') {
        $tipo = 'LB1'
    } else {
        $win = Parse-Win $carga
        if ($win) { $tipo = 'WIN' }
    }
    if (-not $tipo) { continue }

    $fecha = $null
    if ($cFecha) { $fecha = Fecha-De ([string]$f.$cFecha) }

    if ($ultima.ContainsKey($eq)) {
        $prev = $ultima[$eq]
        if ($fecha -and $prev.Fecha -and $fecha -le $prev.Fecha) { continue }
        if (-not $fecha -and $prev.Fecha) { continue }
        if ($prev.Tipo -eq 'LB1') { $nLb-- } else { $nWin-- }
    }
    if ($tipo -eq 'LB1') { $nLb++ } else { $nWin++ }
    $ultima[$eq] = [PSCustomObject]@{
        Tipo  = $tipo
        Carga = $carga
        Win   = $win
        Fecha = $fecha
        Usr   = if ($cUsr) { [string]$f.$cUsr } else { '' }
    }
}

Write-Host ("  {0} filas, {1} equipos con datos" -f $filas.Count, $ultima.Count) -ForegroundColor DarkGray
if ($nLb)  { Write-Host ("  {0} en formato de linea base" -f $nLb) -ForegroundColor DarkGray }
if ($nWin) { Write-Host ("  {0} en formato de parches de Windows" -f $nWin) -ForegroundColor DarkGray }

if (-not $ultima.Count) {
    Write-Host ''
    Write-Host '  Ningun equipo trae carga que se pueda leer.' -ForegroundColor Red
    Write-Host ("  Se reconoce 'LB1;...' y la linea de parches 'Win 24H2 build " +
                "26100.6899 | ...'.") -ForegroundColor DarkYellow
    Write-Host '  Mira la columna de salida en el CSV: esto es lo primero que vino:' -ForegroundColor DarkYellow
    Write-Host ('    ' + ([string]$filas[0].$cCarga).Substring(0,
                [Math]::Min(150, ([string]$filas[0].$cCarga).Length))) -ForegroundColor DarkGray
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
    $sw.WriteLine('DeviceName,SoftwareVendor,SoftwareName,SoftwareVersion,UserName,LastContact,OSVersion')

    # Una fila del CSV de salida. El tablero lee 'una aplicacion instalada en un
    # equipo', asi que el nivel de parche entra disfrazado de eso: nombres fijos
    # -cinco, no uno por KB- y el dato en la columna de version. Fijos porque si
    # cada KB fuera una aplicacion distinta, el catalogo se llenaria de cientos
    # de lineas que no son programas y dejaria de poder navegarse.
    function Escribe($eq, $nombre, $valor, $usr, $fecha, $comp) {
        if (-not $valor) { return }
        $ids[$nombre] = $true
        $sw.WriteLine((Cs $eq) + ',' + (Cs (Fabricante-De $nombre)) + ',' + (Cs $nombre) + ',' +
                      (Cs $valor) + ',' + (Cs $usr) + ',' + (Cs $fecha) + ',' + (Cs $comp))
        $script:nFilas++
    }

    foreach ($eq in $ultima.Keys) {
        $d = $ultima[$eq]

        $fecha = ''
        if ($d.Fecha) { $fecha = $d.Fecha.ToString('yyyy-MM-dd HH:mm:ss') }

        # ---- el formato de parches de Windows
        if ($d.Tipo -eq 'WIN') {
            $w = $d.Win
            # La compilacion no va como fila: va en su columna, la misma que
            # trae el inventario de Intune. Asi el apartado Parches funciona
            # aunque este CSV sea lo unico que se haya cargado.
            $comp = $w.Comp
            if ($w.Kbs.Count) {
                Escribe $eq 'Parche de Windows' $w.Kbs[0].Kb $d.Usr $fecha $comp
                Escribe $eq 'Parche instalado' $w.Kbs[0].Fecha $d.Usr $fecha $comp
                # Los demas van todos bajo el mismo nombre, con el KB y su dia
                # en la version: se pueden buscar y agrupar sin que cada numero
                # de KB se convierta en una aplicacion del catalogo.
                for ($k = 1; $k -lt $w.Kbs.Count; $k++) {
                    $v = $w.Kbs[$k].Kb
                    if ($w.Kbs[$k].Fecha) { $v = $v + ' (' + $w.Kbs[$k].Fecha + ')' }
                    Escribe $eq 'Parche anterior' $v $d.Usr $fecha $comp
                }
            }
            Escribe $eq 'Upgrade de Windows' $w.Upg $d.Usr $fecha $comp
            Escribe $eq 'Windows instalado' $w.Inst $d.Usr $fecha $comp
            Escribe $eq 'Windows anterior' $w.Antes $d.Usr $fecha $comp
            # Un equipo que solo reporta compilacion -ni KB ni upgrade- tambien
            # cuenta: sin una fila no entra en el tablero y se perderia su nivel.
            if (-not $w.Kbs.Count -and -not $w.Upg -and -not $w.Antes -and $comp) {
                Escribe $eq 'Compilacion de Windows' $comp $d.Usr $fecha $comp
            }
            continue
        }

        # ---- el formato de linea base por ruta
        $trozos = $d.Carga.Split(';')
        if ($trozos.Length -lt 3) { continue }
        $cuerpo = $trozos[2]
        if ($cuerpo -like '*+CORTADO*') { $cortados++; $cuerpo = $cuerpo.Replace('~+CORTADO', '') }
        if (-not $cuerpo) { continue }

        foreach ($par in $cuerpo.Split('~')) {
            $i = $par.IndexOf('=')
            if ($i -le 0) { continue }
            $id  = $par.Substring(0, $i)
            $ver = $par.Substring($i + 1)
            if (-not $id) { continue }
            Escribe $eq $id $ver $d.Usr $fecha ''
        }
    }
} finally { $sw.Close() }

Write-Host ''
Write-Host ("  {0} filas escritas en {1}" -f $nFilas, (Split-Path -Leaf $Salida)) -ForegroundColor Green
if ($cortados) {
    Write-Host ("  {0} equipos traen la salida cortada por el tope de Intune." -f $cortados) -ForegroundColor Red
    Write-Host '  Parte los objetivos en dos remediaciones.' -ForegroundColor DarkYellow
}

if ($Listar) {
    Write-Host ''
    Write-Host '  Ids que llegaron, y si tienen fabricante:' -ForegroundColor Cyan
    foreach ($k in ($ids.Keys | Sort-Object)) {
        $f = Fabricante-De $k
        if (-not $f) { $f = '(sin fabricante)' }
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
        # snappy y no zstd: el lector de parquet del tablero no trae
        # descompresor de zstd y el archivo no se abriria. Pesa algo mas.
        $sql = "COPY (SELECT * FROM read_csv_auto('$eIn', header=true)) TO '$eOut' (FORMAT PARQUET, COMPRESSION snappy);"
        & $duck -c $sql
        if ($LASTEXITCODE -eq 0) {
            Write-Host ("  Parquet: {0}" -f (Split-Path -Leaf $eOut)) -ForegroundColor Green
        }
    }
}

Write-Host ''
Write-Host '  Arrastralo al tablero. Entra como una fuente mas y se funde con Intune.' -ForegroundColor Cyan
Write-Host ''
