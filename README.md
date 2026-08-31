# Inventario de Aplicaciones

Plataforma de gestión de software y cumplimiento para administradores de Microsoft Intune.
Carga un inventario exportado en Excel o CSV y lo convierte en un tablero de control:
cumplimiento por equipo y por aplicación, control de versiones, informes ejecutivos para
cliente y tendencias históricas.

**Todo el procesamiento ocurre en el navegador.** No hay servidor, no hay base de datos y
ningún dato sale del equipo de quien abre la página. El repositorio contiene la herramienta;
nunca el inventario.

---

## Uso

1. Abre la página (`index.html` en local, o la URL de GitHub Pages).
2. Arrastra el export de Intune, Configuration Manager o cualquier inventario en `.xlsx` / `.csv`.
3. La aplicación detecta las columnas sola y propone un estándar por aplicación.
4. Ajusta ese estándar en **Administración** y el resto del tablero se recalcula.

### Columnas que reconoce

Se detectan por nombre, en español o inglés, en cualquier orden:

| Rol | Nombres aceptados (ejemplos) |
|---|---|
| Equipo | `DeviceName`, `Equipo`, `Hostname`, `Computer` |
| Usuario | `UserName`, `Usuario`, `UPN` |
| Fabricante | `SoftwareVendor`, `Fabricante`, `Publisher` |
| Aplicación | `SoftwareName`, `Aplicación`, `Producto` |
| Versión | `SoftwareVersion`, `Versión`, `DisplayVersion` |
| Sistema operativo | `OSDistribution`, `Sistema Operativo` |
| Versión de Windows | `OSVersionInfo`, `Versión SO`, `Build` |
| Fecha | `Timestamp`, `Fecha`, `LastSeen` |
| CPE | `ProductCodeCpe`, `CPE` |
| Cliente | `Cliente`, `Empresa`, `Organización` |
| Área | `Área`, `División`, `Centro de costo` |
| Ubicación | `País`, `Ciudad`, `Sede`, `Región` — activa el mapa geográfico |

Solo son imprescindibles **aplicación** o **fabricante**. El resto habilita funciones extra.

---

## Cómo se calcula el cumplimiento

Cada aplicación tiene un estándar: **versión aprobada**, **versión mínima**, si es **crítica**,
si está **administrada** y si está **permitida**.

| Estado | Condición |
|---|---|
| 🟢 Cumple | La versión del equipo es igual o superior a la aprobada |
| 🟡 Requiere atención | Está entre la mínima y la aprobada |
| 🔴 No cumple | Está por debajo de la mínima, o la aplicación no está permitida |

Un equipo hereda el peor estado de sus aplicaciones.

### Dos decisiones de diseño que conviene entender

**El estándar propuesto no es la versión más alta detectada.** Aprobar siempre el máximo deja
el parque entero en rojo el primer día: en un inventario real casi ningún equipo está al máximo
en *todas* sus aplicaciones. La propuesta automática es percentil — aprobada = la versión más
nueva que ya tiene al menos la mitad del parque; mínima = la que cubre el 90 %. Si prefieres el
criterio estricto, hay un botón en Administración.

**El cumplimiento no se mide sobre todo el catálogo.** Un equipo corporativo lleva decenas de
librerías, controladores y componentes. Por defecto solo puntúan las aplicaciones que realmente
gobiernas: las **administradas**, las **críticas** y las **no permitidas** — igual que las
políticas de Intune. El alcance se puede ampliar a todo el catálogo desde Administración.

Las reglas propuestas automáticamente se marcan con ◇. **En cuanto editas una fila deja de ser
automática** y se respeta tal cual en las siguientes cargas.

---

## Qué se guarda y dónde

| Dato | Dónde vive | Persiste |
|---|---|---|
| Estándares, umbrales, categorías | `localStorage` del navegador | Sí, por navegador y origen |
| Histórico de lecturas (24 máx.) | `localStorage` del navegador | Sí |
| Inventario cargado | Memoria de la pestaña | No |

Para llevar tu estándar a otro equipo: **Administración → Exportar configuración (JSON)** y
luego **Importar** en el destino. El histórico todavía no tiene exportación.

Servir la página por HTTP (GitHub Pages, o un servidor local) hace el almacenamiento más
estable que abrir el archivo desde disco. Si el navegador bloquea el almacenamiento, la
aplicación sigue funcionando pero pierde la configuración al recargar.

---

## Exportación

| Formato | Contenido |
|---|---|
| `.xlsx` | Cuatro hojas: Resumen, Aplicaciones, Equipos, Inventario |
| `.csv` | Las mismas hojas en un solo archivo de texto |
| `.csv` original | Las filas cargadas, tal cual, con la selección aplicada |
| `.json` | La configuración del estándar |

El `.xlsx` se genera desde cero en el navegador (ZIP + CRC32 + deflate nativo), sin librerías.

Para PDF: botón **PDF**, que usa la impresión del navegador con estilos propios. En modo
Cliente imprime el informe ejecutivo.

---

## Integración con Microsoft Intune

Hoy la fuente de datos es un archivo exportado. La capa de lectura está aislada del resto: el
modelo interno (equipos, aplicaciones, versiones, fechas) es el mismo que produciría Microsoft
Graph.

**Conectar Graph en vivo requiere un backend.** Graph exige un *client secret* o un certificado,
y eso no puede vivir en una página: cualquiera que la abriese tendría la credencial. El backend
autentica contra Entra ID, consulta `deviceManagement/detectedApps` y `managedDevices`, y
entrega el mismo modelo que hoy produce el lector de archivos.

El estándar, el motor de cumplimiento, el histórico y todas las vistas son independientes del
origen de los datos. Al conectar Graph no cambia nada de eso.

---

## Desarrollo

`index.html` es un archivo generado. **No lo edites a mano**: se ensambla desde `build/`.

```
build/
  00_head.html      cabecera y tipografías
  10_css_base.css   sistema de diseño (color, tipografía, componentes)
  20_css_app.css    shell, navegación, vistas, semáforos
  05_body.html      marcado estático
  30_engine_io.js   lectores XLSX/CSV, fechas, detección de columnas, modelo
  40_engine_viz.js  agregación y motor de gráficos SVG
  50_core.js        estado, rutas, catálogo de estándares, cumplimiento, histórico
  60_views_a.js     resumen, cumplimiento, aplicaciones, equipos
  60_views_b.js     versiones, tendencias, mapas, informe, administración
  70_app.js         navegación, exportación, interacción, carga de archivo
```

Para regenerar `index.html`, concatena los fragmentos en ese orden:

```bash
python build.py
```

Sin dependencias externas: ni frameworks, ni CDN, ni paquetes. La única petición de red son
las tipografías de Google, con pila de respaldo si no hay conexión.

---

## Privacidad

- El inventario **nunca** se envía a ningún servidor: se lee con `FileReader` y se procesa en memoria.
- No hay telemetría, analítica ni cookies.
- Publicar esta herramienta no expone datos de nadie: quien la abre carga su propio archivo.
- `.gitignore` excluye `*.csv`, `*.xlsx` y `*.json` precisamente para que ningún inventario ni
  catálogo de cliente acabe en el repositorio por descuido.

## Licencia

MIT — ver [LICENSE](LICENSE).
