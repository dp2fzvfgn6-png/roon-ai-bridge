# Portal visual de roonIA

## Punto de retorno

El portal anterior al rediseño está guardado en:

`data/backups/portal-pre-redesign-2026-07-10.zip`

El archivo contiene la carpeta `portal/` tal como estaba, incluidos los cambios
locales que todavía no estaban en Git. `data/` no se versiona.

## Arquitectura de información

El portal reduce la navegación principal a cuatro espacios:

1. **Inicio**: conexión, estado, reproducción actual, métricas y accesos rápidos.
2. **Música**: búsqueda tipada, navegación de biblioteca y playlists virtuales.
3. **Reproducción**: zonas, colas, transporte, agrupación, transferencia, presets
   y límites de volumen.
4. **Administración**: API keys, tools MCP, operación y sistema.

Las vistas antiguas de Widgets se eliminan de la navegación. Sus contratos HTTP
siguen activos y el nuevo portal reutiliza los mismos datos enriquecidos.

## Búsqueda y acciones contextuales

La búsqueda usa `/api/roon/media/search` y separa artistas, álbumes, pistas y
playlists. Los `result_id` temporales permiten abrir una ficha, reproducir,
iniciar radio, añadir a la cola o añadir el resultado a una playlist virtual.

La primera vista prioriza seis artistas, seis álbumes, doce canciones y seis
playlists. Cada sección permite revelar el resto sin mezclar categorías. Las
fichas enriquecidas usan `/api/roon/media/:result_id/artist-detail` y
`/api/roon/media/:result_id/album-detail` para mostrar la biografía disponible
en Roon, canciones destacadas, álbumes, singles/EPs y las pistas del disco.

Los enlaces internos que Roon incluye en algunos metadatos con formato
`[[identificador|texto]]` se normalizan en la capa de datos. El portal y los
contratos públicos reciben únicamente el texto visible, sin identificadores.

La acción «Añadir canción» de una playlist abre la misma experiencia visual de
búsqueda en contexto. Artistas y álbumes siguen siendo navegables, pero las
pistas sustituyen los controles de reproducción por una única acción de añadir
a la playlist activa.

Las playlists generan por defecto un mosaico estático con hasta 16 imágenes de
sus canciones. La cuadrícula usa 4, 9 o 16 celdas cuadradas pegadas de borde a
borde. Cada carátula se centra y recorta para llenar su celda sin franjas. Desde
la edición se puede subir una imagen JPEG, PNG o WebP de hasta
5 MB; la tool `roon_set_virtual_playlist_cover_image` ofrece la misma operación
a ChatGPT u otro cliente MCP.

## Control de acceso MCP

- `PATCH /api/admin/api-keys/:key_id` actualiza nombre, rol y allowlist de tools.
- `DELETE /api/admin/api-keys/:key_id` revoca la key sin borrar su hash.
- `POST /api/admin/api-keys/:key_id/reactivate` reactiva el secreto original.
- `GET /api/admin/tools` devuelve el catálogo completo y su estado.
- `PATCH /api/admin/tools/:tool_name` habilita o deshabilita una tool globalmente.

Una tool se registra en MCP únicamente cuando está habilitada globalmente y,
para una API key administrada con allowlist, cuando también está permitida para
esa key. Las keys sin allowlist conservan acceso a todas las tools habilitadas.

## Recursos visuales

El logo que usa el portal está incluido en `portal/roonia-logo.svg`, de modo que
la interfaz no depende de la carpeta local y no versionada `logos/`. Los iconos
usan Google Material Symbols Rounded. Las carátulas y fotos proceden del
servicio de imágenes de Roon y mantienen un fallback local.

El minirreproductor consulta el estado de Roon periódicamente, pero suspende el
repintado de sus controles mientras el usuario arrastra el progreso o el volumen
o mantiene abierto el selector de zona. Las respuestas que llegan durante el
gesto también se descartan y, al terminar una operación, se solicita una lectura
del estado confirmado por Roon siempre que no haya comenzado otra interacción.
