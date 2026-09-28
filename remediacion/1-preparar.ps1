<#
    Linea base por ruta de archivo  -  paso 1 de 3:  preparar (una sola vez)

    Esto NO se sube a Intune. Se ejecuta UNA VEZ, en un equipo de referencia
    que tenga instalado todo lo de la linea base, y sirve para no adivinar:
    lee el registro de programas instalados y saca, de cada uno, la ruta real
    del ejecutable y el fabricante tal y como lo escribe el propio fabricante.

    Por que hace falta:
      El paso 2 comprueba rutas, no programas instalados, y una ruta mal puesta
      no da error: da "no instalado" en los 38.000 equipos, en silencio. Es el
      unico fallo de este montaje que no se nota hasta que alguien lo audita.

    De donde sale la ruta:
      DisplayIcon del registro de desinstalacion apunta casi siempre al
      ejecutable principal -"C:\Program Files\Foo\foo.exe,0"-. Cuando no,
      se busca en InstallLocation el .exe que mas se parezca al nombre.

    Uso:
      .\1-preparar.ps1              solo los de la linea base
      .\1-preparar.ps1 -Todo        todo lo instalado (para buscar a mano)
      .\1-preparar.ps1 -Csv ruta    lee los nombres de un CSV/columna 1

    No hay nada que copiar ni pegar. Escribe el resultado directamente en los
    otros dos scripts -dejando antes una copia .bak- y al terminar ejecuta la
    deteccion para ensenarte lo que va a reportar desde este equipo. Si eso
    tiene buena pinta, 2-deteccion.ps1 ya esta listo para subir a Intune.
#>

param(
    [switch]$Todo,
    [string]$Csv = ''
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- la lista
# Los 23 de "Linea base.xlsx". Si cambia la lista, cambia esto o usa -Csv.
$Base = @(
    'Adobe Acrobat Reader DC'
    'Agility'
    'BCO_CORTEX_LB_UPD'
    'BCO_LB_CLEARPASS-ONGUARD_UPD'
    'Citrix WorkSpace 2402'
    'Cliente SCCM OSD'
    'GolfSifBranch'
    'Hclient 2.1'
    'Lexmark Scanback'
    'Lexmark_PostScript_Admin_Mayo2025_V2'
    'Local Administrator Password Solution'
    'Micro Focus EXTRA X-treme'
    'Microsoft 365 Monthly Mayo 2026'
    'Microsoft Purview Information Protection'
    'NessusAgent 11.1.3'
    'Netskope 132.0.20.2563'
    'Nexthink'
    'PinPad'
    'Remote Help'
    'Tech Pulse'
    'v_PRO-G_Sucursales'
    'Webex 46.5.0.34931'
    'Who Is Who 2024'
)

if ($Csv) {
    if (-not (Test-Path -LiteralPath $Csv)) { throw "No encuentro $Csv" }
    $Base = @(Get-Content -LiteralPath $Csv | Select-Object -Skip 1 |
              ForEach-Object { ($_ -split '[,;]')[0].Trim('"', ' ') } |
              Where-Object { $_ })
}

# ------------------------------------------------------------ normalizacion
# El mismo criterio que usa el tablero: minusculas y solo alfanumericos, para
# que "Citrix WorkSpace 2402" y "Citrix Workspace 2402" sean la misma cosa.
function Forma([string]$s) {
    if (-not $s) { return '' }
    return ($s.ToLowerInvariant() -replace '[^a-z0-9]', '')
}

# Ruido de los nombres de paquete de despliegue, que no identifica al producto.
$Ruido = 'bco|lb|upd|ver|cliente|client|admin|x64|x86|win|windows|setup|install|update|' +
         'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre'

function Piezas([string]$s) {
    return @($s -split '[^A-Za-z0-9]+' |
             ForEach-Object { $_.ToLowerInvariant() } |
             Where-Object { $_.Length -ge 4 -and $_ -notmatch "^($Ruido)$" -and $_ -notmatch '^\d+$' })
}

# ------------------------------------------------------- programas instalados
function Programas-Instalados {
    $claves = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    $vistos = @{}
    foreach ($c in $claves) {
        Get-ItemProperty -Path $c -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -and -not $_.SystemComponent } |
            ForEach-Object {
                $k = (Forma $_.DisplayName) + '|' + $_.DisplayVersion
                if (-not $vistos.ContainsKey($k)) {
                    $vistos[$k] = $true
                    [PSCustomObject]@{
                        Nombre   = [string]$_.DisplayName
                        Version  = [string]$_.DisplayVersion
                        Fab      = [string]$_.Publisher
                        Icono    = [string]$_.DisplayIcon
                        Carpeta  = [string]$_.InstallLocation
                        Forma    = Forma $_.DisplayName
                        Tokens   = @(Piezas $_.DisplayName)
                    }
                }
            }
    }
}

# -------------------------------------------------------- el ejecutable real
function Exe-De($p) {
    # 1) DisplayIcon: "C:\ruta\app.exe,0" -> "C:\ruta\app.exe"
    if ($p.Icono) {
        $ico = ($p.Icono -split ',')[0].Trim('"', ' ')
        if ($ico -and $ico.ToLowerInvariant().EndsWith('.exe') -and (Test-Path -LiteralPath $ico)) {
            return $ico
        }
    }
    # 2) el .exe de InstallLocation que mas se parezca al nombre del programa.
    #    Hasta dos niveles: Acrobat pone InstallLocation en "Adobe\Acrobat DC"
    #    y el ejecutable en "Adobe\Acrobat DC\Acrobat\Acrobat.exe".
    if ($p.Carpeta) {
        $dir = $p.Carpeta.Trim('"', ' ').TrimEnd('\')
        if ($dir -and (Test-Path -LiteralPath $dir -PathType Container)) {
            $exes = @(Get-ChildItem -LiteralPath $dir -Filter *.exe -File -Recurse -Depth 2 `
                                    -ErrorAction SilentlyContinue | Select-Object -First 400)
            if ($exes.Count) {
                $f = $p.Forma
                $mejor = $exes | Sort-Object @{ Expression = {
                        $b = Forma $_.BaseName
                        # penaliza desinstaladores y ayudantes: no sirven de sonda
                        if ($b -match 'uninst|setup|update|helper|crash|report') { return 9 }
                        if ($f -eq $b) { return 0 }
                        if ($f.StartsWith($b) -or $b.StartsWith($f)) { return 1 }
                        if ($f.Contains($b) -or $b.Contains($f)) { return 2 }
                        return 5
                    } }, @{ Expression = { $_.FullName.Split('\').Count } },
                       @{ Expression = 'Length'; Descending = $true } | Select-Object -First 1
                return $mejor.FullName
            }
            return $dir   # sin .exe dentro: al menos la carpeta sirve de sonda
        }
    }
    return ''
}

# -------------------------------------------------------------- portabilidad
# "C:\Program Files (x86)\X" -> "${env:ProgramFiles(x86)}\X", que sobrevive a
# equipos con Windows en otro idioma o con las carpetas movidas.
function Portable([string]$ruta) {
    if (-not $ruta) { return '' }
    $r = $ruta
    $pares = @(
        @{ v = '${env:ProgramFiles(x86)}'; d = ${env:ProgramFiles(x86)} }
        @{ v = '$env:ProgramFiles';        d = $env:ProgramFiles }
        @{ v = '$env:ProgramData';         d = $env:ProgramData }
        @{ v = '$env:SystemRoot';          d = $env:SystemRoot }
        @{ v = '$env:LOCALAPPDATA';        d = $env:LOCALAPPDATA }
    )
    foreach ($p in $pares) {
        if ($p.d -and $r.StartsWith($p.d, [StringComparison]::OrdinalIgnoreCase)) {
            return $p.v + $r.Substring($p.d.Length)
        }
    }
    return $r
}

# ============================================================= a trabajar
Write-Host ''
Write-Host '  Leyendo los programas instalados...' -ForegroundColor Cyan
$todos = @(Programas-Instalados)
Write-Host ("  {0} programas en este equipo" -f $todos.Count) -ForegroundColor DarkGray
Write-Host ''

if ($Todo) {
    $todos | Sort-Object Nombre | ForEach-Object {
        [PSCustomObject]@{ Programa = $_.Nombre; Version = $_.Version
                           Fabricante = $_.Fab;  Exe = Portable (Exe-De $_) }
    } | Format-Table -AutoSize -Wrap
    return
}

# En cuantos programas aparece cada palabra. "microsoft" sale en veinte y no
# distingue nada; "netskope" sale en uno y lo decide todo. Sin esto, buscar
# "Micro Focus EXTRA X-treme" por palabras casa con Microsoft Edge, que es el
# fallo peligroso: no da error, da una ruta que no existe en ningun equipo.
$Df = @{}
foreach ($p in $todos) {
    foreach ($t in ($p.Tokens | Select-Object -Unique)) {
        if ($Df.ContainsKey($t)) { $Df[$t]++ } else { $Df[$t] = 1 }
    }
}

$hallados = @()
$perdidos = @()

foreach ($n in $Base) {
    $f = Forma $n
    $piezas = Piezas $n
    $cand = $null
    $por = ''
    $firme = $true

    # 1. el mismo nombre
    $x = @($todos | Where-Object { $_.Forma -eq $f })
    if ($x.Count) { $cand = $x; $por = 'nombre exacto' }

    # 2. uno de los dos amplia al otro
    if (-not $cand) {
        $x = @($todos | Where-Object { $f.Length -ge 5 -and $_.Forma.StartsWith($f) })
        if ($x.Count) { $cand = $x; $por = 'el inventario lo amplia' }
    }
    if (-not $cand) {
        $x = @($todos | Where-Object { $_.Forma.Length -ge 5 -and $f.StartsWith($_.Forma) })
        if ($x.Count) { $cand = $x; $por = 'la linea base lo amplia' }
    }

    # 3. por una palabra que casi no se repite. Palabra entera, nunca subcadena,
    #    y con un minimo de rareza: "microsoft" solo no vale para nada.
    if (-not $cand -and $piezas.Count) {
        $mejorP = 0.0; $mejorC = $null; $mejorT = ''
        foreach ($p in $todos) {
            $s = 0.0; $cual = ''; $raro = 99
            foreach ($t in $piezas) {
                if ($p.Tokens -contains $t) {
                    $d = 1
                    if ($Df.ContainsKey($t)) { $d = $Df[$t] }
                    $s += 1.0 / $d
                    if ($d -lt $raro) { $raro = $d; $cual = $t }
                }
            }
            if ($s -gt $mejorP -and $raro -le 2) { $mejorP = $s; $mejorC = $p; $mejorT = $cual }
        }
        if ($mejorC) { $cand = @($mejorC); $por = 'por la palabra ' + $mejorT; $firme = $false }
    }

    if (-not $cand) {
        $perdidos += $n
        Write-Host ("  [ ]  {0}" -f $n) -ForegroundColor DarkYellow
        continue
    }

    # a igualdad, el que resuelva a un archivo de verdad
    $mejor = $cand | Sort-Object @{ Expression = {
                                       $r = Exe-De $_
                                       if ($r -and (Test-Path -LiteralPath $r -PathType Leaf)) { 0 }
                                       elseif ($r) { 1 } else { 2 } } },
                                 @{ Expression = { $_.Nombre.Length } } | Select-Object -First 1
    $crudo = Exe-De $mejor
    $exe = Portable $crudo

    # una carpeta sirve de sonda, pero solo dice "esta puesto": sin version no
    # se puede comparar contra la linea base, asi que tampoco va como firme
    $archivo = $crudo -and (Test-Path -LiteralPath $crudo -PathType Leaf)
    if (-not $archivo) { $firme = $false }
    if (-not $exe) { $firme = $false }

    $hallados += [PSCustomObject]@{
        Id = $n; Prog = $mejor.Nombre; Ver = $mejor.Version
        Fab = $mejor.Fab; Exe = $exe; Por = $por; Firme = $firme
    }

    $marca = if ($firme) { '[x]' } else { '[?]' }
    $color = if ($firme) { 'Green' } else { 'DarkYellow' }
    Write-Host ("  {0}  {1}" -f $marca, $n) -ForegroundColor $color
    Write-Host ("        {0}  {1}   ({2})" -f $mejor.Nombre, $mejor.Version, $por) -ForegroundColor DarkGray
    if (-not $exe) {
        Write-Host '        SIN RUTA - hay que ponerla a mano' -ForegroundColor DarkGray
    } elseif (-not $archivo) {
        Write-Host ("        {0}   <- carpeta, no da version" -f $exe) -ForegroundColor DarkGray
    } else {
        Write-Host ("        {0}" -f $exe) -ForegroundColor DarkGray
    }
}

# ------------------------------------------------------------- los dos bloques
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine(('# Generado por 1-preparar.ps1 el {0} desde {1}.' -f
    (Get-Date -Format 'yyyy-MM-dd HH:mm'), $env:COMPUTERNAME))
[void]$sb.AppendLine('$Objetivos = @(')
foreach ($h in $hallados) {
    # el Id viaja en la carga util: corto, sin acentos y sin = ni ~
    $id = ($h.Id -replace '[^A-Za-z0-9 ._-]', '').Trim()
    $esc = $id.Replace("'", "''")
    if ($h.Firme) {
        [void]$sb.AppendLine(('    @{{ Id = ''{0}''; Rutas = @("{1}") }}   # {2}' -f $esc, $h.Exe, $h.Prog))
    } elseif ($h.Exe) {
        # Comentado a proposito: el emparejamiento no es seguro, o la ruta es una
        # carpeta y no dara version. Descomentalo tu despues de mirarlo.
        [void]$sb.AppendLine(('    # DUDOSO ({0}) -> confirma que "{1}" es lo que buscas' -f $h.Por, $h.Prog))
        [void]$sb.AppendLine(('    # @{{ Id = ''{0}''; Rutas = @("{1}") }}' -f $esc, $h.Exe))
    } else {
        [void]$sb.AppendLine(('    # SIN RUTA -> ponla tu:  {0}   (instalado: {1})' -f $id, $h.Prog))
        [void]$sb.AppendLine(('    # @{{ Id = ''{0}''; Rutas = @("C:\ruta\al\programa.exe") }}' -f $esc))
    }
}
foreach ($p in $perdidos) {
    $id = ($p -replace '[^A-Za-z0-9 ._-]', '').Trim()
    [void]$sb.AppendLine(('    # NO INSTALADO en este equipo -> busca la ruta en otro:  {0}' -f $id))
    [void]$sb.AppendLine(('    # @{{ Id = ''{0}''; Rutas = @("C:\ruta\al\programa.exe") }}' -f $id.Replace("'", "''")))
}
[void]$sb.AppendLine(')')

$sbF = New-Object System.Text.StringBuilder
[void]$sbF.AppendLine('$Fabricantes = @{')
foreach ($h in $hallados) {
    if (-not $h.Fab) { continue }
    $id = ($h.Id -replace '[^A-Za-z0-9 ._-]', '').Trim()
    $par = ('    ''{0}'' = ''{1}''' -f $id.Replace("'", "''"), $h.Fab.Replace("'", "''"))
    # un fabricante sacado de un emparejamiento dudoso etiqueta mal la fila:
    # tambien va comentado
    if ($h.Firme) { [void]$sbF.AppendLine($par) }
    else          { [void]$sbF.AppendLine('    # DUDOSO ' + $par.TrimStart()) }
}
[void]$sbF.AppendLine('}')

# ---------------------------------------------------- escribirlo donde toca
# Se sustituye el bloque entre marcadores dentro de los otros dos scripts. Que
# lo copie y pegue una persona es una oportunidad mas de equivocarse, y este es
# justo el sitio donde equivocarse no da error.
$raiz = $PSScriptRoot
if (-not $raiz) { $raiz = (Get-Location).Path }

function Sustituir-Bloque([string]$archivo, [string]$ini, [string]$fin, [string]$nuevo) {
    if (-not (Test-Path -LiteralPath $archivo)) {
        Write-Host ("  NO ENCUENTRO {0}" -f (Split-Path -Leaf $archivo)) -ForegroundColor Red
        return $false
    }
    $utf8 = New-Object Text.UTF8Encoding($false)
    $txt = [IO.File]::ReadAllText($archivo, $utf8)
    $a = $txt.IndexOf($ini)
    $b = $txt.IndexOf($fin)
    if ($a -lt 0 -or $b -lt $a) {
        Write-Host ("  {0} no tiene los marcadores {1} / {2}" -f (Split-Path -Leaf $archivo), $ini, $fin) -ForegroundColor Red
        return $false
    }
    # copia de seguridad: si el emparejamiento sale mal, se vuelve atras
    [IO.File]::WriteAllText($archivo + '.bak', $txt, $utf8)
    $salida = $txt.Substring(0, $a + $ini.Length) + "`r`n" + $nuevo.TrimEnd() + "`r`n" + $txt.Substring($b)
    [IO.File]::WriteAllText($archivo, $salida, $utf8)
    return $true
}

$fDet = Join-Path $raiz '2-deteccion.ps1'
$fCon = Join-Path $raiz '3-convertir.ps1'

Write-Host ''
$okDet = Sustituir-Bloque $fDet '# <<<OBJETIVOS>>>'   '# <<<FIN OBJETIVOS>>>'   $sb.ToString()
$okCon = Sustituir-Bloque $fCon '# <<<FABRICANTES>>>' '# <<<FIN FABRICANTES>>>' $sbF.ToString()
if ($okDet) { Write-Host '  2-deteccion.ps1 actualizado  (copia previa en .bak)' -ForegroundColor Green }
if ($okCon) { Write-Host '  3-convertir.ps1 actualizado  (copia previa en .bak)' -ForegroundColor Green }

Write-Host ''
$nFirmes = @($hallados | Where-Object { $_.Firme }).Count
$nDudosos = @($hallados | Where-Object { -not $_.Firme }).Count
Write-Host ('  {0} en firme, {1} dudosos, {2} no instalados aqui' -f
    $nFirmes, $nDudosos, $perdidos.Count) -ForegroundColor Cyan
Write-Host ''
if ($nDudosos) {
    $frase = if ($nDudosos -eq 1) { '  1 dudoso va COMENTADO. Miralo y descomentalo si es el bueno:' }
             else { '  {0} dudosos van COMENTADOS. Miralos y descomenta los buenos:' -f $nDudosos }
    Write-Host $frase -ForegroundColor DarkYellow
    Write-Host '  dar por buena una ruta que no existe no da error, da "no instalado"' -ForegroundColor DarkYellow
    Write-Host '  en los 38.000 equipos y en silencio.' -ForegroundColor DarkYellow
    Write-Host ''
}
Write-Host '  Revisa tambien las rutas de C:\Users\... si las hay: el script de' -ForegroundColor DarkYellow
Write-Host '  deteccion corre como SYSTEM y no ve el perfil del usuario.' -ForegroundColor DarkYellow
Write-Host ''

# ------------------------------------------------- y a ver que sale de verdad
# Se prueba aqui mismo. Subir el script y descubrir a los dos dias que no
# detecta nada seria perder dos dias por no mirar.
if ($okDet) {
    Write-Host '  ---------------------------------------------------------------' -ForegroundColor DarkGray
    Write-Host '  Esto es lo que ese script va a reportar desde este equipo:' -ForegroundColor Cyan
    Write-Host ''
    & $fDet -Prueba
    Write-Host '  ---------------------------------------------------------------' -ForegroundColor DarkGray
    Write-Host '  Si esto tiene buena pinta, sube 2-deteccion.ps1 a Intune.' -ForegroundColor Green
    Write-Host ''
}
