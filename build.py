#!/usr/bin/env python3
"""
Ensambla index.html a partir de los fragmentos de build/.

El resultado es un unico archivo autocontenido: sin dependencias, sin CDN y sin
proceso de compilacion mas alla de esta concatenacion. El orden importa, porque
el navegador ejecuta el <script> de arriba abajo.

Uso:  python build.py
"""
import io
import os
import sys

RAIZ = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(RAIZ, 'build')
SALIDA = os.path.join(RAIZ, 'index.html')

# El orden es el contrato: cabecera, estilos, marcado y despues las capas de JS,
# de la mas basica (lectores) a la mas alta (interaccion).
PARTES = [
    '00_head.html',      # <title>, meta, tipografias, apertura de <style>
    '10_css_base.css',   # sistema de diseno: color, tipografia, componentes
    '20_css_app.css',    # shell, navegacion, vistas, semaforos
    '05_body.html',      # cierre de <style>, marcado estatico, apertura de <script>
    '30_engine_io.js',   # lectores XLSX/CSV, fechas, columnas, modelo, datos geo
    '40_engine_viz.js',  # agregacion y motor de graficos SVG
    '50_core.js',        # estado, rutas, catalogo, cumplimiento, historico
    '60_views_a.js',     # resumen, cumplimiento, aplicaciones, equipos
    '60_views_b.js',     # versiones, tendencias, mapas, informe, administracion
    '70_app.js',         # navegacion, exportacion, interaccion, carga y cierre
]


def main():
    faltan = [p for p in PARTES if not os.path.exists(os.path.join(BUILD, p))]
    if faltan:
        sys.stderr.write('Faltan fragmentos en build/: %s\n' % ', '.join(faltan))
        return 1

    trozos = []
    for nombre in PARTES:
        with io.open(os.path.join(BUILD, nombre), encoding='utf-8') as fh:
            trozos.append(fh.read())
    html = ''.join(trozos)

    # Comprobaciones baratas que atrapan un ensamblado roto antes de publicarlo.
    controles = [
        ('<style>', 1), ('</style>', 1),
        ('<script>', 1), ('</script>', 1),
        ('<body', 1), ('</body>', 1), ('</html>', 1),
    ]
    errores = ['%s aparece %d veces (esperado %d)' % (t, html.count(t), n)
               for t, n in controles if html.count(t) != n]
    if errores:
        sys.stderr.write('Ensamblado incorrecto:\n  %s\n' % '\n  '.join(errores))
        return 1

    with io.open(SALIDA, 'w', encoding='utf-8', newline='') as fh:
        fh.write(html)
    sys.stdout.write('index.html generado: %d caracteres (%d KB)\n'
                     % (len(html), len(html) // 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
