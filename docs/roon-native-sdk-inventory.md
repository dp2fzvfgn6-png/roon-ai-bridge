# Inventario completo de acciones nativas de la API/SDK de Roon vs RoonIA

## Alcance y criterio

Este inventario se ha hecho cruzando:

- `node-roon-api/README.md`
- `node-roon-api/lib.js`
- `node-roon-api-browse/lib.js`
- `node-roon-api-transport/lib.js`
- `node-roon-api/docs/RoonApiImage.html`
- el codigo actual de `RoonIA` en `src/`

Estado usado en la tabla:

- `Si`: la accion nativa esta implementada y expuesta de forma util en RoonIA.
- `Parcial`: el SDK se usa internamente o de forma indirecta, pero RoonIA no lo expone como accion separada y dedicada.
- `No`: no esta implementada en RoonIA.

Nota importante sobre `browse`: el SDK solo define dos llamadas nativas fijas (`browse` y `load`), pero Roon puede devolver acciones dinamicas segun el item seleccionado (`Play Now`, `Add Next`, `Start Radio`, etc.). Esas acciones dinamicas no vienen enumeradas de forma cerrada por el SDK. En este documento dejo:

- todas las llamadas nativas fijas del SDK
- todas las acciones dinamicas de `browse` que RoonIA detecta o ejecuta hoy
- una fila explicita para "accion dinamica arbitraria no contemplada"

## 1. SDK base / ciclo de vida de la extension

| Servicio | Accion nativa | Estado en RoonIA | Evidencia | Nota |
| --- | --- | --- | --- | --- |
| SDK base | Registrar la extension en Roon | Si | `src/roon/roonClient.ts` | Se hace con `new RoonApi(...)` y el registro posterior del core. |
| SDK base | Declarar servicios requeridos con `init_services()` | Si | `src/roon/roonClient.ts` | RoonIA declara `RoonApiTransport` y opcionalmente `RoonApiBrowse`. |
| SDK base | Declarar servicios opcionales | No | `src/roon/roonClient.ts` | No se usa `optional_services`. |
| SDK base | Declarar servicios provistos propios | Parcial | `src/roon/roonClient.ts` | RoonIA no registra servicios propios custom, pero el SDK anade `ping` y el servicio interno de pairing. |
| SDK base | Descubrir Roon Core automaticamente con `start_discovery()` | Si | `src/roon/roonClient.ts` | Es el modo principal de conexion actual. |
| SDK base | Detener discovery con `stop_discovery()` | No | n/a | No hay wrapper ni endpoint para ello. |
| SDK base | Cerrar todas las conexiones con `disconnect_all()` | No | n/a | No se usa. |
| SDK base | Conectar manualmente por websocket con `ws_connect()` | No | n/a | RoonIA no ofrece conexion directa por host/puerto. |
| SDK base | Persistir estado/autorizacion con `get_persisted_state` / `set_persisted_state` | Si | `src/roon/roonClient.ts` | Guarda `roonstate.json`. |
| SDK base | Pairing con un unico Core (`core_paired` / `core_unpaired`) | Si | `src/roon/roonClient.ts` | Es el modo usado por la app. |
| SDK base | Modo multi-core sin pairing (`core_found` / `core_lost`) | No | n/a | No se usa. |
| SDK base | Registrar un servicio custom con `register_service()` | No | n/a | No hay servicios custom hacia Roon mas alla de los implicitos del SDK. |
| SDK base | Servicio `ping` provisto a Roon | Si | implicito por `init_services()` | Lo anade el propio SDK. |

## 2. Servicios que una extension puede proveer a Roon

| Servicio | Accion nativa | Estado en RoonIA | Evidencia | Nota |
| --- | --- | --- | --- | --- |
| Servicio provisto | Publicar estado de extension (`node-roon-api-status`) | No | n/a | RoonIA no usa `node-roon-api-status` ni `set_status()`. |
| Servicio provisto | Exponer ajustes UI en Roon (`node-roon-api-settings`) | No | n/a | No implementado. |
| Servicio provisto | Exponer control de volumen hardware a Roon (`node-roon-api-volume-control`) | No | n/a | RoonIA consume el transporte de Roon; no provee un dispositivo de volumen a Roon. |
| Servicio provisto | Exponer control de fuente/standby hardware a Roon (`node-roon-api-source-control`) | No | n/a | No implementado. |

## 3. Servicio nativo `transport`

| Servicio | Accion nativa | Estado en RoonIA | Evidencia | Nota |
| --- | --- | --- | --- | --- |
| Transport | Obtener zonas con `get_zones()` | Si | `src/roon/roonClient.ts`, `src/api/routes/zones.routes.ts`, `src/mcp/mcpTools.ts` | RoonIA lista zonas via HTTP y MCP. |
| Transport | Obtener outputs con `get_outputs()` | No | n/a | No hay llamada dedicada a `get_outputs()`. |
| Transport | Suscribirse a cambios de zonas con `subscribe_zones()` | Si | `src/roon/roonClient.ts` | Se usa para mantener cache local de zonas. |
| Transport | Suscribirse a cambios de outputs con `subscribe_outputs()` | No | n/a | No implementado. |
| Transport | Control `play` | Si | `src/roon/roonPlaybackService.ts`, `src/api/routes/playback.routes.ts`, `src/mcp/mcpTools.ts` | Verifica el estado final en v0.9.2. |
| Transport | Control `pause` | Si | `src/roon/roonPlaybackService.ts` | Expuesto por HTTP y MCP. |
| Transport | Control `playpause` | Si | `src/roon/roonPlaybackService.ts` | Expuesto por HTTP y MCP. |
| Transport | Control `stop` | Si | `src/roon/roonPlaybackService.ts` | Expuesto por HTTP y MCP. |
| Transport | Control `previous` | Si | `src/roon/roonPlaybackService.ts` | Expuesto por HTTP y MCP. |
| Transport | Control `next` | Si | `src/roon/roonPlaybackService.ts` | Expuesto por HTTP y MCP. |
| Transport | Seek absoluto con `seek(..., "absolute", ...)` | No | n/a | No hay endpoint ni herramienta para seek. |
| Transport | Seek relativo con `seek(..., "relative", ...)` | No | n/a | No implementado. |
| Transport | Cambiar volumen absoluto con `change_volume(..., "absolute", ...)` | Si | `src/roon/roonVolumeService.ts`, `src/api/routes/volume.routes.ts`, `src/mcp/mcpTools.ts` | Implementado por output de la zona. |
| Transport | Cambiar volumen relativo con `change_volume(..., "relative", ...)` | Si | `src/roon/roonVolumeService.ts` | Implementado por output de la zona. |
| Transport | Cambiar volumen por paso relativo con `change_volume(..., "relative_step", ...)` | No | n/a | No expuesto. |
| Transport | Mutear/unmutear un output con `mute()` | No | n/a | No implementado. |
| Transport | Mutear/unmutear todas las zonas con `mute_all()` | No | n/a | No implementado. |
| Transport | Pausar todas las zonas con `pause_all()` | No | n/a | No implementado. |
| Transport | Poner output en standby con `standby()` | No | n/a | No implementado. |
| Transport | Alternar standby con `toggle_standby()` | No | n/a | No implementado. |
| Transport | `convenience_switch()` de un output/fuente | No | n/a | No implementado. |
| Transport | Transferir cola y reproduccion entre zonas con `transfer_zone()` | Si | `src/roon/roonTransferService.ts`, `src/api/routes/playback.routes.ts`, `src/mcp/mcpTools.ts` | Implementado en v0.9.1. |
| Transport | Agrupar outputs sincronizados con `group_outputs()` | Si | `src/roon/roonGroupingService.ts`, `src/api/routes/grouping.routes.ts`, `src/mcp/mcpTools.ts` | Implementado en v0.10 con una zona primaria explicita y verificacion de la topologia final. |
| Transport | Desagrupar outputs con `ungroup_outputs()` | Si | `src/roon/roonGroupingService.ts`, `src/api/routes/grouping.routes.ts`, `src/mcp/mcpTools.ts` | Implementado en v0.10; separa todos los outputs y verifica que vuelvan a zonas independientes. |
| Transport | Cambiar `shuffle` via `change_settings()` | No | n/a | RoonIA no usa `change_settings`; el modo artista usa acciones de `browse`. |
| Transport | Cambiar `auto_radio` via `change_settings()` | No | n/a | No implementado. |
| Transport | Cambiar `loop` via `change_settings()` | No | n/a | No implementado. |
| Transport | Leer cola por suscripcion con `subscribe_queue()` | Si | `src/roon/roonQueueService.ts`, `src/api/routes/queue.routes.ts`, `src/mcp/mcpTools.ts` | Se usa para snapshots de cola. |
| Transport | Saltar a un item de cola con `play_from_here()` | Si | `src/roon/roonQueueService.ts`, `src/api/routes/queue.routes.ts`, `src/mcp/mcpTools.ts` | Implementado. |

## 4. Servicio nativo `browse`

### 4.1 Llamadas nativas fijas de `browse`

| Servicio | Accion nativa | Estado en RoonIA | Evidencia | Nota |
| --- | --- | --- | --- | --- |
| Browse | Navegar jerarquia `browse` | Si | `src/api/routes/library.routes.ts`, `src/roon/roonBrowseService.ts` | Jerarquia general de biblioteca. |
| Browse | Navegar jerarquia `playlists` | Si | `src/api/routes/library.routes.ts` | Soportada en `/roon/library?hierarchy=playlists`. |
| Browse | Navegar jerarquia `internet_radio` | Si | `src/api/routes/library.routes.ts` | Soportada. |
| Browse | Navegar jerarquia `albums` | Si | `src/api/routes/library.routes.ts` | Soportada. |
| Browse | Navegar jerarquia `artists` | Si | `src/api/routes/library.routes.ts` | Soportada. |
| Browse | Navegar jerarquia `genres` | Si | `src/api/routes/library.routes.ts` | Soportada. |
| Browse | Navegar jerarquia `composers` | Si | `src/api/routes/library.routes.ts` | Soportada. |
| Browse | Navegar jerarquia `settings` | No | n/a | El SDK la permite, pero RoonIA no la expone. |
| Browse | Buscar con jerarquia `search` | Si | `src/api/routes/library.routes.ts`, `src/roon/roonBrowseService.ts`, `src/roon/roonMediaService.ts` | Expuesta como `/roon/search` y en la capa typed media. |
| Browse | Cargar items de lista con `load()` | Si | `src/roon/roonBrowseService.ts` | Se usa para paginacion y carga de acciones. |
| Browse | Paginacion por `offset`/`count` | Si | `src/api/routes/library.routes.ts`, `src/roon/roonBrowseService.ts` | Implementada. |
| Browse | Reanudar sesion con `multi_session_key` | Si | `src/roon/roonBrowseService.ts`, `src/roon/roonMediaService.ts` | Implementado. |
| Browse | Abrir un item con `item_key` | Si | `src/roon/roonBrowseService.ts` | Implementado en browse, search, queue y media. |
| Browse | Reiniciar pila con `pop_all` | Si | `src/api/routes/library.routes.ts` | Implementado. |
| Browse | Retroceder niveles con `pop_levels` | Si | `src/api/routes/library.routes.ts` | Implementado. |
| Browse | Refrescar lista con `refresh_list` | Si | `src/api/routes/library.routes.ts` | Implementado. |
| Browse | Actualizar `display_offset` / `set_display_offset` | Si | `src/roon/roonBrowseService.ts` | Se usa en `loadCurrentList()`. |
| Browse | Enviar `input` a un item con `input_prompt` generico | No | n/a | RoonIA no expone un endpoint generico para contestar prompts arbitrarios de browse. |

### 4.2 Acciones dinamicas de `browse` que RoonIA si usa o inspecciona

| Servicio | Accion dinamica de browse | Estado en RoonIA | Evidencia | Nota |
| --- | --- | --- | --- | --- |
| Browse dinamico | Ejecutar una accion de reproduccion tipo `Play` / `Play Now` detectada en un resultado | Si | `src/roon/roonBrowseService.ts`, `src/roon/roonMediaService.ts` | Implementado en `playByQuery()` y `roon_play_media`. |
| Browse dinamico | Ejecutar `Add Next` si Roon la expone para el item | Si | `src/roon/roonBrowseService.ts`, `src/roon/roonMediaService.ts` | Implementado. |
| Browse dinamico | Ejecutar `Add to Queue` al final si Roon expone una accion explicita de fin de cola | Si | `src/roon/roonBrowseService.ts`, `src/roon/roonMediaService.ts` | Implementado con validacion para no confundirlo con add-next. |
| Browse dinamico | Ejecutar `Shuffle`/catalogo del artista | Si | `src/roon/roonMediaService.ts` | Usado para reproducir solo el catalogo del artista. |
| Browse dinamico | Ejecutar `Start Radio` / radio del artista | Si | `src/roon/roonMediaService.ts`, `src/api/routes/media.routes.ts`, `src/mcp/mcpTools.ts` | Implementado como accion separada. |
| Browse dinamico | Inspeccionar acciones disponibles para un resultado | Si | `src/roon/roonBrowseService.ts`, `src/api/routes/queue.routes.ts` | `inspect_actions`. |
| Browse dinamico | Ejecutar cualquier otra accion arbitraria que Roon devuelva en un action-list | No | n/a | No existe un endpoint generico "run arbitrary browse action". |

### 4.3 Respuestas/efectos nativos de `browse`

| Servicio | Respuesta nativa | Estado en RoonIA | Evidencia | Nota |
| --- | --- | --- | --- | --- |
| Browse | Manejar respuesta `list` | Si | `src/roon/roonBrowseService.ts` | Base de toda la navegacion. |
| Browse | Manejar respuesta `message` | Si | `src/roon/roonBrowseService.ts`, `src/roon/roonMediaService.ts` | Se devuelve al cliente cuando aparece. |
| Browse | Manejar respuesta `none` | Si | `src/roon/roonBrowseService.ts` | Se propaga como accion/respuesta. |
| Browse | Manejar respuesta `replace_item` | Parcial | `src/roon/roonBrowseService.ts` | Se propaga si aparece, pero no hay UX generica para explotarla como flujo propio. |
| Browse | Manejar respuesta `remove_item` | Parcial | `src/roon/roonBrowseService.ts` | Igual que la anterior. |

## 5. Servicio nativo `image`

| Servicio | Accion nativa | Estado en RoonIA | Evidencia | Nota |
| --- | --- | --- | --- | --- |
| Image | Descargar imagen con `get_image(image_key, ...)` | No | n/a | El SDK lo documenta, pero RoonIA no declara ni usa `node-roon-api-image`. |
| Image | Descargar imagen por HTTP nativo de Roon (`/api/image/...`) | No | n/a | RoonIA no lo encapsula ni lo expone. |

## 6. Acciones nativas que hoy estan implementadas en RoonIA

Esta es la lista consolidada de acciones nativas realmente implementadas hoy:

- registro de extension y pairing con un unico Core
- discovery automatico del Core
- persistencia de autorizacion/estado
- listado de zonas
- cache reactiva de zonas via `subscribe_zones()`
- control de reproduccion: `play`, `pause`, `playpause`, `stop`, `previous`, `next`
- cambio de volumen `absolute` y `relative`
- transferencia nativa entre zonas con `transfer_zone()`
- lectura de cola via `subscribe_queue()`
- `play_from_here()` sobre items de cola
- browse de biblioteca en jerarquias `browse`, `playlists`, `internet_radio`, `albums`, `artists`, `genres`, `composers`
- busqueda en jerarquia `search`
- `load()` con paginacion, `item_key`, `multi_session_key`, `pop_all`, `pop_levels`, `refresh_list`, `set_display_offset`
- ejecucion controlada de acciones dinamicas de browse para `Play`, `Add Next`, `Add to Queue`, `Shuffle` de artista y `Start Radio`
- inspeccion de acciones dinamicas disponibles para cola

## 7. Acciones nativas del SDK que NO estan implementadas en RoonIA

Pendientes o ausentes a dia de hoy:

- `stop_discovery()`
- `disconnect_all()`
- `ws_connect()`
- servicios opcionales del SDK base
- servicios provistos `status`, `settings`, `volume-control`, `source-control`
- `get_outputs()`
- `subscribe_outputs()`
- `seek()` absoluto y relativo
- `change_volume(..., "relative_step", ...)`
- `mute()`
- `mute_all()`
- `pause_all()`
- `standby()`
- `toggle_standby()`
- `convenience_switch()`
- `change_settings()` para `shuffle`, `auto_radio` y `loop`
- jerarquia `settings` en browse
- soporte generico para `input_prompt`
- ejecucion generica de cualquier accion arbitraria devuelta por Roon en browse
- `get_image()` y proxy/uso del servicio de imagenes

## 8. Conclusiones practicas

- En control de reproduccion y cola, RoonIA cubre bien el nucleo nativo que mas valor aporta: zonas, playback, volumen, cola, browse, busqueda, radio y transferencia.
- La mayor parte de lo que falta esta en tres grupos: gestion avanzada de outputs, ajustes/standby/mute/seek, y acciones genericas no tipadas de `browse`.
- Si queremos cerrar la brecha con el SDK nativo de Roon, las prioridades naturales son: `seek`, `mute`, `change_settings`, `get_outputs`/`subscribe_outputs`, e `image`.
