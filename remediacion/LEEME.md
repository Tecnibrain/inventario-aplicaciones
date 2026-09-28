# Línea base por ruta de archivo

Sacar del parque cosas que el inventario de programas instalados **no ve**: un
archivo en una ruta concreta, con su versión.

El vehículo es una remediación de Intune, pero **no se remedia nada**. Se
aprovecha que Intune captura lo que el script de detección escribe por pantalla
y que eso se descarga después como CSV.

---

## Lo que haces una sola vez

### 1. En un equipo que tenga instalado lo de la línea base

```powershell
.\1-preparar.ps1
```

Lee el registro, saca la ruta real del ejecutable de cada aplicación y **la
escribe él mismo dentro de `2-deteccion.ps1`**. No hay nada que copiar ni pegar.
Al terminar ejecuta la detección para enseñarte lo que va a reportar.

Lo que sale con `[x]` queda activo. Lo que sale con `[?]` queda **comentado a
propósito** — míralo y descomenta lo que sea. Lo que no estaba instalado en ese
equipo queda comentado con un hueco para la ruta.

> Si lo ejecutas en un equipo que no tiene casi nada instalado, casi todo saldrá
> comentado y la prueba final te dirá en rojo que el script no reportaría nada.
> Es el resultado correcto: ejecútalo donde esté el software.

### 2. En el portal de Intune

**Dispositivos → Remediaciones → Crear**

| Campo | Valor |
|---|---|
| Script de detección | `2-deteccion.ps1` |
| Script de corrección | **déjalo en blanco** |
| Ejecutar con las credenciales del usuario conectado | **No** |
| Aplicar comprobación de firma | No |
| Ejecutar en PowerShell de 64 bits | **Sí** |
| Programación | Diaria |

Asignar al grupo de equipos. Y ya está: eso es todo el montaje.

---

## Lo que haces cada vez que quieras datos frescos

**Dispositivos → Remediaciones → la tuya → Estado del dispositivo → Exportar.**
Después:

```powershell
.\3-convertir.ps1
```

Sin argumentos. Busca solo el export más reciente en Descargas y lo reconoce por
la cabecera. Deja `rutas-detectadas.csv` con las columnas que el tablero ya lee.

**Arrástralo al tablero.** Entra como una fuente más y se funde con lo que venga
de Intune: lo que aparezca por los dos lados no se cuenta dos veces.

---

## Los archivos

| | |
|---|---|
| `1-preparar.ps1` | Tu equipo, una vez. Rellena el script de detección |
| `2-deteccion.ps1` | **El que se sube a Intune** |
| `3-convertir.ps1` | Tu equipo, cada vez |
| `remediacion-vacia.ps1` | Solo si algún día pones `$CodigoSalida = 1` |

---

## Los límites, antes de montar nada encima

- **Licencia.** Remediaciones pide Windows E3/E5, VDA o el add-on de Intune. Sin
  eso, este camino no existe y quedan ConfigMgr o una tarea programada.
- **~2.048 caracteres de salida por equipo.** Con 23 aplicaciones sobra sitio
  (unos 500), pero el paso 2 vigila el tope y el paso 3 avisa si algún equipo
  vino cortado. Si llega a pasar, se parte en dos remediaciones.
- **Corre como SYSTEM.** Lo que viva en `C:\Users\...` no se ve. Webex, por
  ejemplo, se instala en el perfil del usuario: para eso hace falta otra
  remediación marcada «ejecutar con las credenciales del usuario conectado».
- **Retención ~30 días** del informe. Para histórico hay que exportar cada tanto.
- **Cadencia diaria**, no bajo demanda.
- **UTF-8 sin BOM y sin tildes** en el `.ps1` que se sube. PowerShell 5.1 lee un
  archivo sin BOM como ANSI y parte los caracteres acentuados por la mitad; por
  eso los scripts no llevan ni una tilde.

## El fallo que no se ve

Una ruta mal puesta **no da error**: da «no instalado» en los 38.000 equipos, en
silencio, y el indicador de cumplimiento se lo traga. Es el único fallo de este
montaje que no se nota hasta que alguien lo audita.

Contra eso van las tres defensas: el paso 1 saca las rutas del registro en vez
de adivinarlas, los emparejamientos dudosos salen comentados, y la prueba final
te enseña lo que el script va a reportar antes de que lo subas.

## Datos

Nada de esto sale del equipo. `rutas-detectadas.csv` lleva nombres de máquinas
del parque y está cubierto por `.gitignore`, igual que los `.ps1` y los `.bak`.
