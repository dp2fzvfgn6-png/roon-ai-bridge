# Revisión UX del portal

Fecha: 2026-07-10

## Método

Se creó `scripts/portal-ux-preview.js`, un servidor local con zonas, carátulas,
resultados de búsqueda, playlists, API keys y tools representativas. Esto permite
revisar el portal sin depender de la disponibilidad del Roon Core y sirve como
escena repetible para futuras regresiones visuales.

La revisión se hizo con una ventana de 1440 × 1000 px, capturas de pantalla,
inspección del DOM y medición de cajas renderizadas.

## Problemas encontrados

### Bloqueo estructural

La aplicación reservaba el ancho del sidebar dos veces: `.app` declaraba una
columna de 236 px y `.workspace` añadía otros 236 px de margen. Como consecuencia,
el navegador calculaba:

- viewport: 1440 px;
- sidebar: 236 px;
- workspace: 0 px;
- `main`: aproximadamente 115 px;
- hero: 84 px.

El contenido se comprimía en una columna mínima y dejaba la mayor parte de la
pantalla vacía. Este era el principal motivo por el que el portal no era usable.

### Jerarquía visual

- El inicio mostraba una ilustración decorativa en lugar de la música real.
- Carátula, artista, álbum, zona y transporte no formaban una unidad clara.
- Métricas técnicas y accesos rápidos competían con “Ahora suena”.
- Todos los módulos usaban el mismo tratamiento de tarjeta y el mismo peso.

### Lenguaje visual

- Radios de hasta 32 px en casi todos los contenedores.
- Bordes completos y fondos elevados incluso para listas simples.
- Exceso de pequeñas cajas anidadas en zonas, tools, keys y actividad.
- El resultado parecía un dashboard genérico, no un producto musical cercano a
  Roon.

### Identidad

- El logo aparecía en login y sidebar, pero tenía poca presencia dentro de la
  aplicación.
- En móvil desaparecía completamente.
- El avatar genérico `IA` introducía una identidad distinta a roonIA.
- Los colores del logo no ordenaban suficientemente los estados y acciones.

### Carga de iconos

Antes de que Material Symbols terminara de cargar, los nombres de ligadura
(`person`, `lock`, `arrow_forward`) ocupaban espacio visible y deformaban
controles. Los iconos ahora tienen una caja fija de `1em` que evita ese salto.

## Decisiones aplicadas

- Un único sidebar fijo; el workspace usa `calc(100% - sidebar)` una sola vez.
- Portada musical centrada en la pista activa, con carátula real, fondo derivado,
  artista, álbum, zona y transporte.
- Logo completo de roonIA más grande en escritorio y logo específico en la barra
  superior móvil.
- Navegación simplificada: Inicio, Explorar, Zonas y Ajustes.
- Superficies planas con separadores; radios de 0–2 px salvo controles circulares,
  artistas y discos.
- Álbumes y playlists tratados como carátulas, no como tarjetas administrativas.
- Zonas convertidas en filas de control anchas en lugar de paneles independientes.
- Keys, tools, logs y presets convertidos en tablas/listas visuales sin cajas.
- Paleta derivada de los SVG del proyecto: verde `#678475` y terracota `#c16048`.
- Navegación inferior y logo visible en móvil, con portada activa compacta.

## Verificación

- Sintaxis de `portal/app.js` y del servidor de preview validada con Node.
- TypeScript compila sin errores.
- Suite completa: 78 pruebas superadas.
- `git diff --check` sin errores de whitespace.

El navegador integrado permitió capturar y medir el estado inicial, pero su
política de URL bloqueó una recarga posterior de localhost. No se intentó eludir
esa restricción.

## Validación en el LXC

Despliegue realizado el 2026-07-10 desde el canal `beta`:

- commit desplegado: `227ed2cd943caf10146b0c760a369f0034d7fd4b`;
- contenedor `roon-ai-bridge`: `running`;
- portal: `v0.16.1`, configuración de autenticación activa;
- marcadores del logo, navegación `Explorar / Zonas / Ajustes` y nuevo layout:
  presentes en los assets servidos;
- Roon Core: conectado a `Roon Server`;
- transport, browse e image: preparados;
- zonas detectadas: 4;
- outputs detectados: 4;
- tools MCP publicadas: 88;
- verificadas: `roon_status`, `roon_search_media`, `roon_play_media` y
  `roon_list_virtual_playlists`;
- logs de arranque: servidores HTTP y portal escuchando sin errores.

### Carátulas, zona activa y acciones de pista

Validación realizada el 2026-07-10 sobre el commit `a22fdc8` del canal `beta`:

- suite completa: 78 pruebas superadas y compilación TypeScript correcta;
- Roon Core, transport, browse e image: preparados;
- zonas y outputs detectados: 4 y 4;
- el portal entrega una carátula real autenticada con `200 image/jpeg`
  (50 419 bytes en la muestra comprobada);
- la política CSP admite las URL `blob:` usadas por la caché autenticada de
  imágenes;
- presentes el selector persistente de zona activa y las acciones de pista
  `replace_queue`, `play_next` y `append`;
- `tools/list`: 88 tools, incluidas las tools requeridas de estado, búsqueda,
  reproducción y playlists.
