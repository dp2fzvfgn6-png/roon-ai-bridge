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

Las playlists aceptan `cover_image_key`. Desde su detalle se puede escoger como
carátula la imagen de cualquiera de sus pistas.

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

El portal sirve los SVG de `logos/` en `/assets/brand` sin modificar la carpeta
original. Los iconos usan Google Material Symbols Rounded. Las carátulas y fotos
proceden del servicio de imágenes de Roon y mantienen un fallback local.
