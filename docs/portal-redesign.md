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
4. **Administración**: sistema, APIs, usuarios, tools MCP y registros.

Las vistas antiguas de Widgets se eliminan de la navegación. Sus contratos HTTP
siguen activos y el nuevo portal reutiliza los mismos datos enriquecidos.

## Actividad de Inicio

Cuando ninguna zona está reproduciendo, la cabecera de Inicio convierte toda su
superficie en un mosaico con una región por zona. Las `n - 1` separaciones son
bordes de recorte compartidos, no líneas visibles: se desplazan e inclinan de
forma lenta y continua sin dejar huecos entre carátulas. Al señalar o enfocar
una zona, su región se expande y las demás se comprimen; solo entonces aparecen
la canción y el artista, con un tono claro u oscuro calculado a partir de la
carátula. El nombre de zona permanece visible y el clic conserva la vista previa
desde la que se puede reanudar la reproducción. Las carátulas permanecen
estáticas bajo los recortes y las etiquetas se anclan a la posición real de las
divisiones para no invadir la región vecina. El tamaño solicitado a Roon se
calcula desde la mayor superficie que puede ocupar cada imagen y la densidad de
pantalla, con un máximo de 2× y límites de 640 a 1920 px. La preferencia de
movimiento reducido elimina la deriva ambiental y conserva una distribución
estática.

La sección «Tu actividad» separa el historial de escucha y el historial de
búsqueda en dos columnas. Cada una muestra cinco entradas inicialmente y carga
diez más con su propio control «Mostrar más»; en pantallas estrechas se apilan.

El historial de escucha se alimenta de los cambios reales publicados por la
suscripción de zonas de Roon, no de la aceptación de un botón del portal. Cada
entrada conserva carátula, canción, artista, zona y fecha. Los cambios de
posición y las pausas no generan duplicados. SQLite conserva las 500 escuchas
más recientes de forma independiente a las 100 búsquedas del portal.

Las búsquedas se presentan sin carátula ni una etiqueta redundante de tipo. La
consulta puede ocupar varias líneas para que se muestre completa.

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

Las playlists generan por defecto un mosaico animado con hasta 16 imágenes de
sus canciones. La cuadrícula usa 4, 9 o 16 celdas cuadradas pegadas de borde a
borde. Cada carátula se centra y recorta para llenar su celda sin franjas y las
casillas intercambian imágenes con una transición suave. Las dimensiones 2×2,
3×3 y 4×4 se definen mediante clases CSS compatibles con la CSP del portal, sin
estilos inline. Desde la edición se puede subir una imagen JPEG, PNG o WebP de
hasta 5 MB y 40 megapíxeles. El servidor corrige la orientación, la recorta a
cuadrado, la limita a 768×768, elimina los metadatos y la guarda como WebP de
como máximo 750 KB. La tool `roon_set_virtual_playlist_cover_image` ofrece la
misma operación a ChatGPT u otro cliente MCP.

## Control de acceso MCP

- `PATCH /api/admin/api-keys/:key_id` actualiza nombre, rol y allowlist de tools.
- `POST /api/admin/api-keys/:key_id/revoke` revoca temporalmente la key.
- `POST /api/admin/api-keys/:key_id/reactivate` reactiva el secreto original.
- `DELETE /api/admin/api-keys/:key_id` elimina definitivamente la key.
- `GET /api/admin/users` lista las cuentas del portal.
- `POST /api/admin/users` crea una cuenta.
- `PATCH /api/admin/users/:user_id/password` restablece la contraseña y cierra
  sus sesiones.
- `DELETE /api/admin/users/:user_id` elimina una cuenta, salvo la cuenta de la
  sesión actual o la última cuenta existente.
- `GET /api/admin/tools` devuelve el catálogo completo y su estado.
- `PATCH /api/admin/tools/:tool_name` habilita o deshabilita una tool globalmente.

Una tool se registra en MCP únicamente cuando está habilitada globalmente y,
para una API key administrada con allowlist, cuando también está permitida para
esa key. Las keys sin allowlist conservan acceso a todas las tools habilitadas.

## Sistema, red y actualizaciones

La pestaña Sistema separa actualización, red y estado real. La comprobación de
actualizaciones compara el commit instalado con el commit de la rama `main` o
`beta`, incluso cuando `package.json` conserva la misma versión. La interfaz
muestra versión y build instaladas y disponibles, conserva el último resultado
bajo los controles y sigue las etapas publicadas por el watcher del LXC.

Actualizar y reiniciar usan diálogos propios del portal. Tras solicitar una
actualización, el cliente tolera la desconexión temporal, consulta el estado al
volver el servicio y presenta un resultado final de éxito o error. La red se
guarda en un único formulario con puertos y direcciones públicas del bridge y
del portal; los cambios se aplican tras reiniciar.

## Recursos visuales

El logo que usa el portal está incluido en `portal/roonia-logo.svg`, de modo que
la interfaz no depende de la carpeta local y no versionada `logos/`. Los iconos
usan Google Material Symbols Rounded. Las carátulas y fotos proceden del
servicio de imágenes de Roon y mantienen un fallback local.

El documento HTML y los recursos JavaScript/CSS se sirven con `no-store`, y el
HTML referencia los assets con una revisión explícita. Esto evita que un proxy
o navegador combine la estructura de una versión del portal con los manejadores
de otra durante una actualización.

El minirreproductor consulta el estado de Roon periódicamente, pero suspende el
repintado de sus controles mientras el usuario arrastra el progreso o el volumen
o mantiene abierto el selector de zona. Las respuestas que llegan durante el
gesto también se descartan y, al terminar una operación, se solicita una lectura
del estado confirmado por Roon siempre que no haya comenzado otra interacción.
