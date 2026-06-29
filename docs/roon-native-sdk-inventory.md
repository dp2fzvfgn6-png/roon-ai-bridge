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
| SDK base | Declarar servicios opcionales | Si | `src/roon/roonClient.ts` | El servicio Image es opcional para no impedir la conexion con un Core que no lo exponga. |
| SDK base | Declarar servicios provistos propios | Si | `src/roon/roonClient.ts` | v0.12 registra Settings y Status, ademas de ping y pairing. |
| SDK base | Descubrir Roon Core automaticamente con `start_discovery()` | Si | `src/roon/roonClient.ts` | Es el modo principal de conexion actual. |
| SDK base | Detener discovery con `stop_discovery()` | No | n/a | No hay wrapper ni endpoint para ello. |
| SDK base | Cerrar todas las conexiones con `disconnect_all()` | No | n/a | No se usa. |
| SDK base | Conectar manualmente por websocket con `ws_connect()` | No | n/a | RoonIA no ofrece conexion directa por host/puerto. |
| SDK base | Persistir estado/autorizacion con `get_persisted_state` / `set_persisted_state` | Si | `src/roon/roonClient.ts` | Guarda `roonstate.json`. |
| SDK base | Pairing con un unico Core (`core_paired` / `core_unpaired`) | Si | `src/roon/roonClient.ts` | Es el modo usado por la app. |
| SDK base | Modo multi-core sin pairing (`core_found` / `core_lost`) | No | n/a | No se usa. |
| SDK base | Registrar un servicio custom con `register_service()` | Si | `src/roon/roonClient.ts` | Se usa a traves de los modulos oficiales Settings y Status. |
| SDK base | Servicio `ping` provisto a Roon | Si | implicito por `init_services()` | Lo anade el propio SDK. |

## 2. Servicios que una extension puede proveer a Roon

| Servicio | Accion nativa | Estado en RoonIA | Evidencia | Nota |
| --- | --- | --- | --- | --- |
| Servicio provisto | Publicar estado de extension (`node-roon-api-status`) | Si | `src/roon/roonClient.ts` | Publica conexion, version y resultado de comprobaciones de actualizacion. |
| Servicio provisto | Exponer ajustes UI en Roon (`node-roon-api-settings`) | Si | `src/roon/roonClient.ts` | Permite configurar puertos, ver la direccion y solicitar comprobacion, reinicio o actualizacion. |
| Servicio provisto | Exponer control de volumen hardware a Roon (`node-roon-api-volume-control`) | No | n/a | RoonIA consume el transporte de Roon; no provee un dispositivo de volumen a Roon. |
| Servicio provisto | Exponer control de fuente/standby hardware a Roon (`node-roon-api-source-control`) | No | n/a | No implementado. |

## 3. Servicio nativo `transport`

| Servicio | Accion nativa | Estado en RoonIA | Evidencia | Nota |
| --- | --- | --- | --- | --- |
| Transport | Obtener zonas con `get_zones()` | Si | `src/roon/roonClient.ts`, `src/api/routes/zones.routes.ts`, `src/mcp/mcpTools.ts` | RoonIA lista zonas via HTTP y MCP. |
| Transport | Obtener outputs con `get_outputs()` | Si | `src/roon/roonClient.ts`, `src/api/routes/advanced.routes.ts` | Inicializa y expone el inventario de outputs. |
| Transport | Suscribirse a cambios de zonas con `subscribe_zones()` | Si | `src/roon/roonClient.ts` | Se usa para mantener cache local de zonas. |
| Transport | Suscribirse a cambios de outputs con `subscribe_outputs()` | Si | `src/roon/roonClient.ts` | Mantiene una cache reactiva para portal, API y MCP. |
| Transport | Control `play` | Si | `src/roon/roonPlaybackService.ts`, `src/api/routes/playback.routes.ts`, `src/mcp/mcpTools.ts` | Verifica el estado final en v0.9.2. |
| Transport | Control `pause` | Si | `src/roon/roonPlaybackService.ts` | Expuesto por HTTP y MCP. |
| Transport | Control `playpause` | Si | `src/roon/roonPlaybackService.ts` | Expuesto por HTTP y MCP. |
| Transport | Control `stop` | Si | `src/roon/roonPlaybackService.ts` | Expuesto por HTTP y MCP. |
| Transport | Control `previous` | Si | `src/roon/roonPlaybackService.ts` | Expuesto por HTTP y MCP. |
| Transport | Control `next` | Si | `src/roon/roonPlaybackService.ts` | Expuesto por HTTP y MCP. |
| Transport | Seek absoluto con `seek(..., "absolute", ...)` | Si | `src/roon/roonAdvancedTransportService.ts` | Expuesto en API, MCP y portal. |
| Transport | Seek relativo con `seek(..., "relative", ...)` | Si | `src/roon/roonAdvancedTransportService.ts` | Admite segundos positivos y negativos. |
| Transport | Cambiar volumen absoluto con `change_volume(..., "absolute", ...)` | Si | `src/roon/roonVolumeService.ts`, `src/api/routes/volume.routes.ts`, `src/mcp/mcpTools.ts` | Implementado por output de la zona. |
| Transport | Cambiar volumen relativo con `change_volume(..., "relative", ...)` | Si | `src/roon/roonVolumeService.ts` | Implementado por output de la zona. |
| Transport | Cambiar volumen por paso relativo con `change_volume(..., "relative_step", ...)` | Si | `src/roon/roonVolumeService.ts` | Expuesto en API y MCP. |
| Transport | Mutear/unmutear un output con `mute()` | Si | `src/roon/roonAdvancedTransportService.ts` | Expuesto por output. |
| Transport | Mutear/unmutear todas las zonas con `mute_all()` | Si | `src/roon/roonAdvancedTransportService.ts` | Accion global explicita. |
| Transport | Pausar todas las zonas con `pause_all()` | Si | `src/roon/roonAdvancedTransportService.ts` | Accion global explicita. |
| Transport | Poner output en standby con `standby()` | Si | `src/roon/roonAdvancedTransportService.ts` | Admite `control_key` opcional. |
| Transport | Alternar standby con `toggle_standby()` | Si | `src/roon/roonAdvancedTransportService.ts` | Disponible en portal, API y MCP. |
| Transport | `convenience_switch()` de un output/fuente | Si | `src/roon/roonAdvancedTransportService.ts` | Disponible en portal, API y MCP. |
| Transport | Transferir cola y reproduccion entre zonas con `transfer_zone()` | Si | `src/roon/roonTransferService.ts`, `src/api/routes/playback.routes.ts`, `src/mcp/mcpTools.ts` | Implementado en v0.9.1. |
| Transport | Agrupar outputs sincronizados con `group_outputs()` | Si | `src/roon/roonGroupingService.ts`, `src/api/routes/grouping.routes.ts`, `src/mcp/mcpTools.ts` | Implementado en v0.10 con una zona primaria explicita y verificacion de la topologia final. |
| Transport | Desagrupar outputs con `ungroup_outputs()` | Si | `src/roon/roonGroupingService.ts`, `src/api/routes/grouping.routes.ts`, `src/mcp/mcpTools.ts` | Implementado en v0.10; separa todos los outputs y verifica que vuelvan a zonas independientes. |
| Transport | Cambiar `shuffle` via `change_settings()` | Si | `src/roon/roonAdvancedTransportService.ts` | Expuesto por zona. |
| Transport | Cambiar `auto_radio` via `change_settings()` | Si | `src/roon/roonAdvancedTransportService.ts` | Expuesto por zona. |
| Transport | Cambiar `loop` via `change_settings()` | Si | `src/roon/roonAdvancedTransportService.ts` | Admite `loop`, `loop_one`, `disabled` y `next`. |
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
| Browse | Navegar jerarquia `settings` | Si | `src/api/routes/library.routes.ts`, `portal/app.js` | Disponible en el explorador generico. |
| Browse | Buscar con jerarquia `search` | Si | `src/api/routes/library.routes.ts`, `src/roon/roonBrowseService.ts`, `src/roon/roonMediaService.ts` | Expuesta como `/roon/search` y en la capa typed media. |
| Browse | Cargar items de lista con `load()` | Si | `src/roon/roonBrowseService.ts` | Se usa para paginacion y carga de acciones. |
| Browse | Paginacion por `offset`/`count` | Si | `src/api/routes/library.routes.ts`, `src/roon/roonBrowseService.ts` | Implementada. |
| Browse | Reanudar sesion con `multi_session_key` | Si | `src/roon/roonBrowseService.ts`, `src/roon/roonMediaService.ts` | Implementado. |
| Browse | Abrir un item con `item_key` | Si | `src/roon/roonBrowseService.ts` | Implementado en browse, search, queue y media. |
| Browse | Reiniciar pila con `pop_all` | Si | `src/api/routes/library.routes.ts` | Implementado. |
| Browse | Retroceder niveles con `pop_levels` | Si | `src/api/routes/library.routes.ts` | Implementado. |
| Browse | Refrescar lista con `refresh_list` | Si | `src/api/routes/library.routes.ts` | Implementado. |
| Browse | Actualizar `display_offset` / `set_display_offset` | Si | `src/roon/roonBrowseService.ts` | Se usa en `loadCurrentList()`. |
| Browse | Enviar `input` a un item con `input_prompt` generico | Si | `src/roon/roonBrowseService.ts`, `portal/app.js` | El portal renderiza el prompt y devuelve la entrada a la misma sesion. |

### 4.2 Acciones dinamicas de `browse` que RoonIA si usa o inspecciona

| Servicio | Accion dinamica de browse | Estado en RoonIA | Evidencia | Nota |
| --- | --- | --- | --- | --- |
| Browse dinamico | Ejecutar una accion de reproduccion tipo `Play` / `Play Now` detectada en un resultado | Si | `src/roon/roonBrowseService.ts`, `src/roon/roonMediaService.ts` | Implementado en `playByQuery()` y `roon_play_media`. |
| Browse dinamico | Ejecutar `Add Next` si Roon la expone para el item | Si | `src/roon/roonBrowseService.ts`, `src/roon/roonMediaService.ts` | Implementado. |
| Browse dinamico | Ejecutar `Add to Queue` al final si Roon expone una accion explicita de fin de cola | Si | `src/roon/roonBrowseService.ts`, `src/roon/roonMediaService.ts` | Implementado con validacion para no confundirlo con add-next. |
| Browse dinamico | Ejecutar `Shuffle`/catalogo del artista | Si | `src/roon/roonMediaService.ts` | Usado para reproducir solo el catalogo del artista. |
| Browse dinamico | Ejecutar `Start Radio` / radio del artista | Si | `src/roon/roonMediaService.ts`, `src/api/routes/media.routes.ts`, `src/mcp/mcpTools.ts` | Implementado como accion separada. |
| Browse dinamico | Inspeccionar acciones disponibles para un resultado | Si | `src/roon/roonBrowseService.ts`, `src/api/routes/queue.routes.ts` | `inspect_actions`. |
| Browse dinamico | Ejecutar cualquier otra accion arbitraria que Roon devuelva en un action-list | Si | `src/roon/roonBrowseService.ts`, `src/api/routes/library.routes.ts` | Requiere un `item_key` de la misma sesion Browse. |

### 4.3 Respuestas/efectos nativos de `browse`

| Servicio | Respuesta nativa | Estado en RoonIA | Evidencia | Nota |
| --- | --- | --- | --- | --- |
| Browse | Manejar respuesta `list` | Si | `src/roon/roonBrowseService.ts` | Base de toda la navegacion. |
| Browse | Manejar respuesta `message` | Si | `src/roon/roonBrowseService.ts`, `src/roon/roonMediaService.ts` | Se devuelve al cliente cuando aparece. |
| Browse | Manejar respuesta `none` | Si | `src/roon/roonBrowseService.ts` | Se propaga como accion/respuesta. |
| Browse | Manejar respuesta `replace_item` | Si | `src/roon/roonBrowseService.ts`, `portal/app.js` | El portal reemplaza el item afectado sin perder la sesion. |
| Browse | Manejar respuesta `remove_item` | Si | `src/roon/roonBrowseService.ts`, `portal/app.js` | El portal elimina el item afectado de la lista activa. |

## 5. Servicio nativo `image`

| Servicio | Accion nativa | Estado en RoonIA | Evidencia | Nota |
| --- | --- | --- | --- | --- |
| Image | Descargar imagen con `get_image(image_key, ...)` | Si | `src/roon/roonImageService.ts` | Limita formato y dimensiones, y lo expone a API, MCP, portal y widget. |
| Image | Descargar imagen por HTTP nativo de Roon (`/api/image/...`) | Parcial | `src/api/routes/advanced.routes.ts` | RoonIA usa el servicio SDK y publica su propio proxy autenticado en vez de depender del puerto interno del Core. |

## 6. Acciones nativas que hoy estan implementadas en RoonIA

Esta es la lista consolidada de acciones nativas realmente implementadas hoy:

- registro, pairing, discovery y persistencia de autorizacion
- servicios proporcionados Settings y Status mediante `register_service()`
- zonas y outputs con `get_*` y suscripciones reactivas
- playback, seek absoluto/relativo, volumen en los tres modos y mute
- acciones globales `mute_all()` y `pause_all()`
- standby, toggle standby y convenience switch
- transferencia, agrupacion, desagrupacion y presets persistentes
- cambio de shuffle, auto-radio y loop
- lectura y reinicio de cola desde su primer item
- todas las jerarquias Browse documentadas, incluida `settings`
- browse generico con prompts, acciones arbitrarias, `replace_item` y `remove_item`
- descarga y transformacion de imagenes con el servicio Image
- proxy autenticado de imagenes y datos de imagen para el widget MCP

## 7. Acciones nativas del SDK que NO estan implementadas en RoonIA

Pendientes o ausentes a dia de hoy:

- `stop_discovery()`
- `disconnect_all()`
- `ws_connect()`
- servicios proporcionados `volume-control` y `source-control`

Estas exclusiones son deliberadas:

- Parar discovery, desconectar el Core o forzar `ws_connect()` no aporta una
  accion normal de usuario y puede dejar el bridge aislado.
- `volume-control` y `source-control` sirven para que una extension se presente
  como hardware ante Roon. RoonIA consume outputs existentes; no debe fingir
  que es un dispositivo de audio.

## 8. Conclusiones practicas

- v0.12 cubre todas las acciones del SDK que resultan convenientes para un
  bridge de control sin representar hardware ficticio.
- Las acciones peligrosas globales se mantienen como intenciones separadas y
  explicitas en API, MCP y portal.
- Las operaciones que Roon no ofrece de forma nativa se describen con
  precision: reiniciar cola vuelve al primer item, no borra la cola.
