<#
    Linea base por ruta de archivo  -  OPCIONAL:  el script de correccion

    No corrige nada, y es a proposito.

    Intune pide un script de deteccion y, si detecta, ejecuta el de correccion.
    Aqui la deteccion no busca un problema: recoge un dato y sale con 0, asi que
    esto no llega a ejecutarse nunca. Se sube porque el formulario lo pide y
    porque hace falta el dia que cambies $CodigoSalida a 1 en el paso 2.

    Cuando si corre -con $CodigoSalida = 1- lo unico que hace es dejar dicho
    que paso, para que el informe no quede con un motivo en blanco.

    Si algun dia quieres que ademas instale lo que falta, este es el sitio; pero
    piensalo dos veces antes: una cosa es inventariar y otra empujar software a
    38.000 equipos desde un informe.
#>

Write-Output 'LBX;sonda de inventario, no se corrige nada'
exit 0
