<#
    Linea base por ruta de archivo  -  paso 2 de 3:  el script que sube a Intune

    Este SI se sube a Intune:
      Intune > Dispositivos > Remediaciones > Crear
      Script de deteccion:  este archivo
      Script de correccion: DEJALO EN BLANCO. Es opcional, y aqui no hay nada
                            que corregir. Solo hace falta si algun dia pones
                            $CodigoSalida = 1 (ver mas abajo).
      Ejecutar con las credenciales del usuario conectado:  NO
      Ejecutar en PowerShell de 64 bits:                    SI
      Programacion: diaria

    Que hace, y por que se usa una remediacion para inventariar:
      Intune captura lo que el script de deteccion escribe por pantalla y lo
      guarda con el equipo. Ese texto se descarga despues como CSV. Es el unico
      canal de Intune por el que se puede sacar algo que el inventario de
      programas instalados no ve: un archivo en una ruta.

      Aqui no se corrige nada. Se comprueba, se escribe el resultado y se sale
      con 0, asi que la correccion no llega a ejecutarse nunca.

    La carga util, formato LB1:

        LB1;23;Agility=7.10.24~PinPad=1.0.0.56~Netskope=132.0.20.2563
        ^   ^  ^
        |   |  solo lo que SI esta. Lo que falta, falta: el paso 3 conoce la
        |   |  lista entera y lo que no venga lo da por no instalado.
        |   cuantos objetivos se comprobaron
        formato

      Se emite solo lo encontrado por el tope de caracteres: Intune corta la
      salida en unos 2.048. Un equipo con los 23 puestos ocupa ~500, asi que
      hay sitio de sobra, pero el tope esta vigilado mas abajo por si la lista
      crece. Verifica el tope real de tu inquilino con una prueba antes de
      montar nada encima: es un numero documentado, no una garantia.

    Antes de subirlo:
      No lo edites tu. Ejecuta 1-preparar.ps1 en un equipo que tenga instalado
      lo de la linea base: rellena solo la lista de objetivos de mas abajo con
      las rutas reales y te ensena lo que va a salir.

      El archivo esta en UTF-8 sin BOM y sin una sola tilde, a proposito:
      PowerShell 5.1 lee un .ps1 sin BOM como ANSI y parte los acentos.

    Lo que hay que mirar con lupa:
      Una ruta mal puesta NO da error: da "no instalado" en todo el parque, en
      silencio. Es el unico fallo de este montaje que no se ve. Por eso el
      paso 1 saca las rutas del registro y por eso existe -Prueba.
#>

param([switch]$Prueba)

# ============================================================== AJUSTES

# Tope de caracteres de la salida. Intune documenta 2.048; se deja margen.
$TopeSalida = 1900

# Normalmente 0: "sin problemas", la correccion no corre y la salida se guarda
# igual. Si en el informe la columna de salida te sale vacia, pon 1: el equipo
# se marca como "con problemas", corre remediacion-vacia.ps1 (que no hace nada) y
# la salida queda guardada seguro. Cuesta que el informe se vea todo en rojo.
$CodigoSalida = 0

# Los ultimos parches instalados, por numero de KB.
#
#   0   nada. Es lo normal, y no porque el dato no sirva: la compilacion de
#       Windows que YA viene en el inventario -"10.0.26100.9445"- son los
#       ultimos digitos el parche del mes, y eso lo tienes sin pedir nada.
#   1   el KB mas reciente, como "Parche de Windows=KB5062553". Una sola
#       aplicacion mas en el tablero, con el KB de version: asi se le puede
#       poner version aprobada y el cumplimiento de parches sale solo.
#   N   los N mas recientes, uno por KB y con su fecha de instalacion. Cuidado:
#       cada KB distinto es una aplicacion distinta en el catalogo, y en un
#       parque grande son cientos de lineas que no son programas.
#
# Lo que esto anade sobre la compilacion: el numero de KB se puede buscar, y
# cubre lo que no es del sistema operativo -.NET y demas-.
$Parches = 0

# ============================================================== OBJETIVOS
#
# Formas admitidas:
#
#   @{ Id = 'Agility'; Rutas = @("$env:ProgramFiles\Enterdev\Agility\Agility.exe") }
#       una o varias rutas candidatas; gana la primera que exista.
#       Admite comodines:  "$env:ProgramFiles\Foo\*\foo.exe"
#
#   @{ Id = 'Cliente SCCM OSD'; Reg = 'HKLM:\SOFTWARE\...'; Val = 'ProductVersion' }
#       la version sale del registro en vez de del archivo.
#
# Si el archivo existe pero no lleva version dentro, se reporta "1", que en el
# tablero se lee como "esta puesto, sin version conocida".
#
# >>> NO EDITES ESTA LISTA A MANO. La escribe 1-preparar.ps1 con las rutas
#     reales de tu parque, sacadas del registro. Lo de abajo son ejemplos.  <<<

# <<<OBJETIVOS>>>
$Objetivos = @(
    @{ Id = 'Cliente SCCM OSD'
       Reg = 'HKLM:\SOFTWARE\Microsoft\SMS\Mobile Client'; Val = 'ProductVersion' }

    @{ Id = 'Local Administrator Password Solution'
       Rutas = @("$env:ProgramFiles\LAPS\CSE\AdmPwd.dll") }

    @{ Id = 'Netskope'
       Rutas = @("$env:ProgramFiles\Netskope\STAgent\stAgentSvc.exe"
                 "${env:ProgramFiles(x86)}\Netskope\STAgent\stAgentSvc.exe") }

    @{ Id = 'Adobe Acrobat Reader DC'
       Rutas = @("$env:ProgramFiles\Adobe\Acrobat DC\Acrobat\Acrobat.exe"
                 "${env:ProgramFiles(x86)}\Adobe\Acrobat Reader DC\Reader\AcroRd32.exe") }

    # OJO con este: Webex se instala en el perfil del usuario. Corriendo como
    # SYSTEM esta ruta no existe y saldria "no instalado" en todo el parque.
    # Para lo que vive en C:\Users hace falta OTRA remediacion, marcada
    # "ejecutar con las credenciales del usuario conectado: SI".
    # @{ Id = 'Webex'; Rutas = @("$env:LOCALAPPDATA\Programs\Cisco Spark\CiscoCollabHost.exe") }
)
# <<<FIN OBJETIVOS>>>

# ============================================================== EL MOTOR
# De aqui abajo no hay nada que tocar.

$ErrorActionPreference = 'SilentlyContinue'

# Ni = ni ~ pueden viajar en la carga util: son los separadores.
function Limpia([string]$s) {
    if (-not $s) { return '' }
    $t = ($s -replace '[=~\r\n\t]', ' ').Trim()
    $t = ($t -replace '\s+', ' ')
    if ($t.Length -gt 40) { $t = $t.Substring(0, 40) }
    return $t
}

# La version de un archivo. ProductVersion primero -es la que publica el
# fabricante y la que casa con la linea base-, FileVersion como respaldo.
function Version-De([string]$ruta) {
    if (-not $ruta) { return '' }
    $it = $null
    try { $it = Get-Item -Path $ruta -Force -ErrorAction SilentlyContinue | Select-Object -First 1 } catch { }
    if (-not $it) { return '' }
    if ($it.PSIsContainer) { return '1' }        # carpeta: esta, sin version

    $v = ''
    try {
        $vi = $it.VersionInfo
        if ($vi) {
            $v = [string]$vi.ProductVersion
            if (-not $v -or -not $v.Trim()) { $v = [string]$vi.FileVersion }
        }
    } catch { }
    $v = Limpia $v
    if (-not $v) { return '1' }                  # archivo sin metadatos

    # "7.10.24 (build 5)" -> "7.10.24". Lo que sigue al numero es ruido para
    # comparar contra la version aprobada.
    $m = [regex]::Match($v, '^\d+(\.\d+)*')
    if ($m.Success -and $m.Value.Length -ge 1) { return $m.Value }
    return $v
}

function Version-Registro([string]$clave, [string]$valor) {
    if (-not $clave) { return '' }
    try {
        $p = Get-ItemProperty -Path $clave -ErrorAction Stop
        if (-not $p) { return '' }
        if ($valor) {
            if ($p.PSObject.Properties[$valor]) { return Limpia ([string]$p.$valor) }
            return ''
        }
        return '1'                               # la clave existe: esta puesto
    } catch { return '' }
}

$partes = @()
$fallos = 0

foreach ($o in $Objetivos) {
    $id = Limpia ([string]$o['Id'])
    if (-not $id) { continue }
    $ver = ''

    try {
        if ($o.ContainsKey('Reg') -and $o['Reg']) {
            $ver = Version-Registro $o['Reg'] ([string]$o['Val'])
        }
        if (-not $ver -and $o.ContainsKey('Rutas')) {
            foreach ($r in @($o['Rutas'])) {
                $ver = Version-De $r
                if ($ver) { break }
            }
        }
    } catch { $fallos++; $ver = '' }

    if ($ver) { $partes += ($id + '=' + $ver) }

    if ($Prueba) {
        $marca = if ($ver) { '[x]' } else { '[ ]' }
        $color = if ($ver) { 'Green' } else { 'DarkYellow' }
        Write-Host ("  {0} {1,-42} {2}" -f $marca, $id, $ver) -ForegroundColor $color
    }
}

# ---------------------------------------------------------------- parches
# Win32_QuickFixEngineering es lo que hay: rapido y en todas las maquinas. No
# lo trae TODO -lo que entra por la pila de mantenimiento a veces no aparece-
# pero para "en que parche va este equipo" sirve, y la compilacion de Windows
# cubre el hueco.
if ($Parches -gt 0) {
    try {
        $hf = @(Get-CimInstance -ClassName Win32_QuickFixEngineering -ErrorAction Stop |
                Where-Object { $_.HotFixID -match '^KB\d+$' })
        # Manda la fecha de instalacion, y el numero de KB solo desempata.
        # Tentaba ordenar por numero y ahorrarse esto, porque InstalledOn viene
        # vacio o como texto en bastantes equipos; pero el numero NO va siempre
        # en orden: en la maquina donde se probo esto, KB5132402 se instalo el
        # 28 y KB5127936 el 29, y el grande es el viejo. Con el numero a secas
        # el "ultimo parche" habria salido mal.
        #
        # La conversion va aqui, en un bucle con su try, y no dentro del
        # Sort-Object: un casteo que revienta ahi dentro se lleva por delante
        # la consulta entera y el equipo reporta vacio sin decir por que.
        $lista = @()
        foreach ($h in $hf) {
            $t = 0
            if ($h.InstalledOn) { try { $t = ([datetime]$h.InstalledOn).Ticks } catch { $t = 0 } }
            $lista += New-Object PSObject -Property @{
                KB = [string]$h.HotFixID
                Ticks = $t
                Num = [int]($h.HotFixID -replace '\D', '')
            }
        }
        $hf = @($lista | Sort-Object Ticks, Num -Descending | Select-Object -First $Parches)

        if ($Parches -eq 1 -and $hf.Count) {
            # Una linea y una aplicacion: el KB de version, listo para que el
            # tablero lo puntue contra la version aprobada que le pongas.
            $partes += ('Parche de Windows=' + (Limpia $hf[0].KB))
        } else {
            foreach ($h in $hf) {
                $f = '1'
                if ($h.Ticks) { $f = (New-Object DateTime($h.Ticks)).ToString('yyyy-MM-dd') }
                $partes += ((Limpia $h.KB) + '=' + $f)
            }
        }
    } catch { $fallos++ }
}

$carga = 'LB1;' + $Objetivos.Count + ';' + ($partes -join '~')

# Guardia del tope. Si algun dia la lista crece tanto que no cabe, se corta por
# una pareja entera -nunca por la mitad de una version, que daria un dato falso-
# y se deja constancia de que se corto.
if ($carga.Length -gt $TopeSalida) {
    $acum = 'LB1;' + $Objetivos.Count + ';'
    $ok = @()
    foreach ($p in $partes) {
        if (($acum + ($ok + $p -join '~') + '~+CORTADO').Length -gt $TopeSalida) { break }
        $ok += $p
    }
    $carga = $acum + ($ok -join '~') + '~+CORTADO'
}

if ($Prueba) {
    Write-Host ''
    if ($Objetivos.Count -eq 0) {
        Write-Host '  NO HAY NINGUN OBJETIVO ACTIVO.' -ForegroundColor Red
        Write-Host '  Este script subido a Intune no reportaria nada de nada. Abrelo,' -ForegroundColor Red
        Write-Host '  busca la lista $Objetivos y descomenta las lineas que sirvan:' -ForegroundColor Red
        Write-Host '  1-preparar.ps1 las deja comentadas cuando no esta seguro, o cuando' -ForegroundColor DarkYellow
        Write-Host '  el programa no estaba instalado en el equipo donde lo ejecutaste.' -ForegroundColor DarkYellow
        Write-Host ''
        exit 0
    }
    if ($Parches -gt 0) {
        $kb = @($partes | Where-Object { $_ -match '^(KB\d+|Parche de Windows)=' })
        foreach ($p in $kb) { Write-Host ("  [x] {0}" -f $p.Replace('=', '  ')) -ForegroundColor Green }
        if (-not $kb.Count) { Write-Host '  [ ] parches: no devolvio ninguno' -ForegroundColor DarkYellow }
    }
    Write-Host ('  {0} de {1} objetivos presentes, {2} con error de lectura' -f
        ($partes.Count - $(if ($Parches -gt 0) { @($partes | Where-Object { $_ -match '^(KB\d+|Parche de Windows)=' }).Count } else { 0 })),
        $Objetivos.Count, $fallos) -ForegroundColor Cyan
    Write-Host ('  Salida: {0} caracteres de {1} de tope' -f $carga.Length, $TopeSalida) -ForegroundColor Cyan
    if ($carga -like '*+CORTADO*') {
        Write-Host '  NO CABE: parte los objetivos en dos remediaciones.' -ForegroundColor Red
    }
    Write-Host ''
    Write-Host $carga -ForegroundColor White
    Write-Host ''
    Write-Host '  Recuerda que aqui corres como TU. En Intune corre como SYSTEM' -ForegroundColor DarkYellow
    Write-Host '  y lo que este en C:\Users no se vera.' -ForegroundColor DarkYellow
    exit 0
}

Write-Output $carga
exit $CodigoSalida
