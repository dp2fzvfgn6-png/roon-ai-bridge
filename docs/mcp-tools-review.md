# Revisión de tools MCP de RoonIA

Documento de trabajo para decidir qué tools deben mantenerse, ocultarse al modelo,
fusionarse o eliminarse.

Fuente revisada: `src/mcp/mcpTools.ts` en el estado local actual.

- Total registrado: **89 tools**.
- Visibilidad normal: modelo y aplicación.
- Excepciones actuales: `roon_search`, `roon_play_by_query` y
  `roon_queue_by_query` están marcadas como heredadas y visibles solo para la
  aplicación.
- Escribir `ELIMINAR`, `MANTENER`, `OCULTAR AL MODELO` o `REVISAR` en la columna
  **Decisión**.
- Una coincidencia en la columna **Relación o precaución** no implica por sí sola
  que dos tools sean duplicadas: puede indicar una frontera que conviene conservar.

## 1. Estado, salud y metadatos del sistema

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_status` | Lectura | Devuelve conexión con Roon Core y disponibilidad de transporte, Browse e imágenes. Usarla para preguntas como «¿está conectado Roon?» o como comprobación previa de funciones Roon. | No sustituye a `roon_healthcheck`: el proceso puede estar vivo aunque Roon esté desconectado. Se parece parcialmente a `roon_readiness`, pero esta última comprueba más dependencias. | PENDIENTE |
| `roon_healthcheck` | Lectura | Confirma únicamente que el proceso RoonIA está vivo y puede responder. Adecuada para sondas liveness y monitorización muy básica. | No diagnostica base de datos, migraciones, MCP ni conexión con Roon. | PENDIENTE |
| `roon_readiness` | Lectura | Comprueba que base de datos, migraciones, Roon Core y catálogo MCP están preparados. Adecuada para despliegues y diagnóstico de arranque. | Más amplia que `roon_healthcheck`; comparte parte de la información de `roon_status`. | PENDIENTE |
| `roon_version` | Lectura | Informa de versión de la aplicación, commit/build disponible y runtime de Node. Usarla para soporte, despliegues y validación de una actualización. | No comprueba que la aplicación esté preparada ni que Roon funcione. | PENDIENTE |
| `roon_get_tools_manifest` | Lectura | Devuelve nombres, descripciones, campos de entrada, clasificación, hashes de esquema y URI de widget de todas las tools. Usarla para auditoría técnica o validación de un despliegue. | Es introspección administrativa y genera un resultado grande. Valorar ocultarla al modelo general y conservarla para diagnóstico. | PENDIENTE |

## 2. Widgets de ChatGPT y portal

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_get_now_playing_widget` | Lectura/widget | Construye el estado visual de reproducción actual, opcionalmente centrado en `selected_zone_id`. Usarla cuando se debe mostrar el widget Now Playing. | Se apoya en información parecida a `roon_list_zones`, pero devuelve un contrato visual y acciones de interfaz. | PENDIENTE |
| `roon_now_playing_widget_action` | Mutación/widget | Despacha botones del widget: play/pause, anterior, siguiente, volumen, mute, selección de zona y refresco. | Se pisa funcionalmente con playback, volumen y mute. Es útil para la app, pero agrupa muchas intenciones y podría ocultarse al modelo. | PENDIENTE |
| `roon_get_playlists_widget` | Lectura/widget | Devuelve una lista paginada de playlists virtuales preparada para navegación visual. No inicia reproducción. | Se parece a `roon_list_virtual_playlists`, pero su contrato está diseñado para interfaz. | PENDIENTE |
| `roon_get_playlist_detail_widget` | Lectura/widget | Abre el detalle paginado de una playlist en el widget, incluidas playlists recién creadas. | Se parece a `roon_get_virtual_playlist`; añade navegación, acciones y presentación visual. | PENDIENTE |
| `roon_playlist_widget_action` | Mutación/widget | Despacha botones para abrir, reproducir, encolar o refrescar playlists y pistas. No permite borrar desde el widget. | Solapa `roon_play_virtual_playlist`, `roon_play_media` y `roon_add_media_to_queue`. Valorar visibilidad solo para app. | PENDIENTE |
| `roon_get_media_search_widget` | Lectura/widget | Busca pistas, álbumes, artistas o playlists y devuelve resultados navegables para el widget. No reproduce automáticamente. | Usa el mismo dominio que `roon_search_media`, pero devuelve un contrato visual. | PENDIENTE |
| `roon_media_search_widget_action` | Mutación/widget | Despacha acciones de resultados: reproducir, encolar, abrir entidad, radio y ampliar búsqueda. | Agrupa funciones de varias tools tipadas. Útil para botones, potencialmente confusa para selección directa del modelo. | PENDIENTE |
| `roon_open_media_entity_widget` | Lectura/widget | Abre el detalle visual de un álbum, artista, pista o playlist mediante un `result_id` temporal. | Relacionada con `roon_get_media_details`, pero devuelve contenido navegable más rico. | PENDIENTE |
| `roon_get_image_url` | Lectura/widget | Convierte un `image_key` de Roon en una URL HTTP renderizable, evitando incluir base64 en la respuesta MCP. | Alternativa ligera a `roon_get_image`. Es normalmente la opción preferible para widgets. | PENDIENTE |

## 3. Zonas, transporte, agrupación y volumen

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_list_zones` | Lectura | Lista zonas Roon, estado, contenido actual y outputs. Puede incluir las imágenes en base64 mediante `include_image_data`. Usarla para resolver nombres a `zone_id`. | Con imágenes embebidas puede producir respuestas grandes. `roon_get_now_playing_widget` es preferible cuando se quiere UI. | PENDIENTE |
| `roon_control_playback` | Mutación audible | Controla una cola existente: play, pause, playpause, stop, next y previous. Admite `dry_run`. | No sirve para elegir música nueva ni reemplazar la cola; para eso usar búsqueda y `roon_play_media`. | PENDIENTE |
| `roon_change_volume` | Mutación | Cambia volumen a nivel de zona de forma absoluta, relativa o por pasos. Aplica límites seguros y puede requerir confirmación para superar el máximo configurado. | No usar cuando debe controlarse un output concreto; entonces corresponde `roon_change_output_volume`. | PENDIENTE |
| `roon_transfer_playback` | Mutación audible | Transfiere nativamente cola y estado de reproducción de una zona origen a otra zona destino. Admite `dry_run`. | No equivale a agrupar zonas ni debe emularse buscando y reconstruyendo la cola. | PENDIENTE |
| `roon_group_zones` | Mutación audible | Agrupa outputs o zonas para reproducir sincronizados, conservando la cola de la zona primaria. Admite `dry_run` y confirmación cuando procede. | No equivale a transferir reproducción. La zona primaria determina la cola que se conserva. | PENDIENTE |
| `roon_ungroup_zone` | Mutación audible | Separa completamente una zona agrupada y vuelve independientes todos sus outputs. Admite `dry_run`. | No sirve para retirar selectivamente un único miembro si la implementación solo soporta desagrupar todo. | PENDIENTE |
| `roon_seek` | Mutación | Salta a un segundo absoluto o avanza/retrocede una cantidad relativa de segundos dentro de la pista actual. | Es distinta de next/previous de `roon_control_playback`; requiere contenido que admita seek. | PENDIENTE |
| `roon_change_playback_settings` | Mutación | Cambia shuffle, auto-radio o repetición de una zona existente. | No inicia música y no controla transporte básico. | PENDIENTE |
| `roon_restart_queue` | Mutación audible | Reinicia la cola existente desde su primer elemento sin vaciarla ni reconstruirla. | No equivale a previous ni a reproducir de nuevo mediante búsqueda. | PENDIENTE |
| `roon_pause_all` | Mutación masiva | Pausa todas las zonas Roon. Solo usar ante una petición explícita global. | Solapa parcialmente múltiples llamadas a `roon_control_playback`, pero aporta una operación masiva intencional. | PENDIENTE |

## 4. Outputs físicos y controles avanzados

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_list_outputs` | Lectura | Lista outputs físicos y sus IDs estables, incluidos los no disponibles si se solicita. Es el paso previo para volumen, mute, power o controles de fuente a nivel de output. | `roon_list_zones` trabaja con zonas lógicas; no siempre es intercambiable. | PENDIENTE |
| `roon_mute_output` | Mutación | Silencia o reactiva un output físico concreto mediante `output_id`. | No usar para todas las salidas; existe `roon_mute_all`. Tampoco acepta directamente un `zone_id`. | PENDIENTE |
| `roon_change_output_volume` | Mutación | Cambia el volumen de un output concreto; los outputs incrementales requieren `relative` con valor `-1` o `1`. | Se diferencia de `roon_change_volume`, que actúa sobre la zona y aplica la política segura de zona. Revisar si debería aplicar también límites seguros. | PENDIENTE |
| `roon_mute_all` | Mutación masiva/destructiva | Silencia o reactiva todos los outputs mutables. Solo usar cuando el usuario lo pida expresamente para todo Roon. | Operación global; no sustituir una petición sobre una única zona u output. | PENDIENTE |
| `roon_output_power` | Mutación | Ejecuta standby, toggle standby o convenience switch sobre un output que exponga esos controles. Puede necesitar `control_key`. | No todos los outputs admiten estas acciones. No equivale a detener reproducción. | PENDIENTE |

## 5. Límites seguros de volumen

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_list_volume_limits` | Lectura | Lista límites seguros configurados, incluidos límites programados. | Devuelve resúmenes; para un registro completo usar `roon_get_volume_limit`. | PENDIENTE |
| `roon_get_volume_limit` | Lectura | Lee la configuración completa de un límite mediante `limit_id`. | Requiere conocer el ID, normalmente obtenido con la lista. | PENDIENTE |
| `roon_create_volume_limit` | Mutación | Crea un máximo seguro para una zona, output o destino virtual, opcionalmente con horario. | Configura política; no cambia el volumen actual. | PENDIENTE |
| `roon_update_volume_limit` | Mutación | Modifica destino, nombre, máximo, horario o estado habilitado de un límite existente. | No confundir deshabilitar con borrar. | PENDIENTE |
| `roon_delete_volume_limit` | Destructiva | Elimina definitivamente un límite configurado. | Al desaparecer el límite pueden permitirse volúmenes antes bloqueados; valorar confirmación explícita. | PENDIENTE |
| `roon_evaluate_volume_policy` | Lectura | Simula qué límite se aplicaría a un volumen solicitado, destino y momento determinados, sin tocar Roon. | No ejecuta el cambio. Útil para explicar bloqueos o validar horarios. | PENDIENTE |

## 6. Presets y zonas virtuales

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_list_zone_presets` | Lectura | Lista presets RoonIA y zonas virtuales del portal. | No lista el estado vivo de Roon; para eso usar `roon_list_zones`. | PENDIENTE |
| `roon_get_zone_preset` | Lectura | Obtiene la configuración completa de un preset por `preset_id`. | Requiere un ID procedente de la lista. | PENDIENTE |
| `roon_create_zone_preset` | Mutación | Guarda una configuración reutilizable de zonas, agrupación y parámetros asociados. No inicia música. | Crear el preset no lo aplica. | PENDIENTE |
| `roon_update_zone_preset` | Mutación | Edita un preset almacenado sin aplicarlo a Roon. | No cambia las zonas reales hasta llamar a `roon_apply_zone_preset`. | PENDIENTE |
| `roon_delete_zone_preset` | Destructiva | Elimina un preset guardado. | No debería alterar automáticamente una agrupación ya aplicada. | PENDIENTE |
| `roon_apply_zone_preset` | Mutación audible | Aplica un preset a zonas Roon reales, respetando límites de volumen. Puede requerir confirmación y admite `dry_run`. | No inicia música ni reemplaza colas. Puede reagrupar outputs y afectar a varias zonas. | PENDIENTE |

## 7. Búsqueda heredada y Browse genérico

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_search` | Lectura, heredada, app-only | Ejecuta búsqueda Roon sin tipos y devuelve referencias Browse de la sesión. Se conserva por compatibilidad antigua. | Sustituida para nuevas peticiones por `roon_search_media`. No se ha encontrado un consumidor interno actual. | PENDIENTE |
| `roon_play_by_query` | Mutación audible, heredada, app-only | Busca y reproduce directamente una consulta de texto en una zona. | Mezcla selección y reproducción; sustituida por `roon_search_media` + `roon_play_media`. Puede elegir un resultado distinto al esperado. | PENDIENTE |
| `roon_queue_by_query` | Mutación, heredada, app-only | Busca una consulta y la añade como siguiente o al final de la cola. | Sustituida por `roon_search_media` + `roon_add_media_to_queue`. | PENDIENTE |
| `roon_run_browse_action` | Mutación avanzada | Ejecuta una acción genérica con un `item_key` devuelto por la misma sesión Browse. Cubre jerarquías, prompts y ajustes sin tool tipada. | Es una vía de escape potente. No usar si existe una tool específica; los `item_key` no son IDs permanentes. | PENDIENTE |

## 8. Cola de reproducción

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_get_queue` | Lectura | Obtiene una instantánea limitada de la cola de una zona y sus IDs de elemento. | No devuelve necesariamente colas muy largas completas salvo que se aumente `max_item_count`. | PENDIENTE |
| `roon_play_queue_item_from_here` | Mutación audible | Empieza a reproducir desde un `queue_item_id` ya existente, conservando el resto de la cola desde ese punto. | Requiere un ID obtenido de `roon_get_queue`; no usar un `result_id` de búsqueda. | PENDIENTE |

## 9. Playlists virtuales: CRUD y carátula

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_list_virtual_playlists` | Lectura | Lista playlists locales con paginación; opcionalmente incluye páginas de pistas. | Para presentación visual usar `roon_get_playlists_widget`. Evitar incluir todas las pistas sin necesidad. | PENDIENTE |
| `roon_create_virtual_playlist` | Mutación | Crea una playlist local y puede resolver las identidades permanentes de las pistas iniciales. Admite `dry_run`. | No crea una playlist nativa dentro de Roon; se almacena en SQLite de RoonIA. | PENDIENTE |
| `roon_get_virtual_playlist` | Lectura | Obtiene una playlist concreta y sus pistas paginadas, con metadatos e identidad. | Para interfaz usar `roon_get_playlist_detail_widget`. | PENDIENTE |
| `roon_update_virtual_playlist` | Mutación | Cambia nombre o descripción de una playlist local. Admite `dry_run`. | No edita pistas ni carátula. | PENDIENTE |
| `roon_set_virtual_playlist_cover_image` | Mutación | Guarda una carátula JPEG, PNG o WebP suministrada como data URL o base64, hasta 5 MB. Admite `dry_run`. | Es una incorporación local aún no consolidada. No sirve para escoger automáticamente la imagen de una pista; la playlist ya genera collage si no hay carátula personalizada. | PENDIENTE |
| `roon_delete_virtual_playlist` | Destructiva | Borra una playlist virtual y sus pistas; requiere confirmación salvo `dry_run`. También elimina su carátula personalizada. | Borrado definitivo local. No afecta a playlists nativas de Roon. | PENDIENTE |

## 10. Playlists virtuales: edición de pistas

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_add_virtual_playlist_track` | Mutación | Añade una pista descrita mediante identidad persistente y trata de resolverla contra Roon. Admite posición y metadatos del usuario. | Para una selección ya obtenida de búsqueda es más exacta `roon_add_search_result_to_virtual_playlist`. | PENDIENTE |
| `roon_update_virtual_playlist_track` | Mutación | Modifica identidad, metadatos o posición de una pista existente. | Si solo se quiere ordenar toda la playlist, usar reorder o sort. Cambiar identidad puede exigir resolver de nuevo. | PENDIENTE |
| `roon_remove_virtual_playlist_track` | Destructiva | Elimina una pista concreta de una playlist y requiere confirmación salvo `dry_run`. | No elimina la canción de Roon ni de la biblioteca; solo de la playlist local. | PENDIENTE |
| `roon_replace_virtual_playlist_tracks` | Destructiva | Reemplaza de una vez toda la lista de pistas; requiere confirmación salvo `dry_run`. | Puede borrar todas las posiciones anteriores. Preferir add/update/remove para cambios parciales. | PENDIENTE |
| `roon_reorder_virtual_playlist_tracks` | Mutación | Establece el orden exacto pasando la lista completa y ordenada de `track_id`. Admite `dry_run`. | No ordena por criterios; para eso usar `roon_sort_virtual_playlist`. La lista debe representar el conjunto completo. | PENDIENTE |
| `roon_sort_virtual_playlist` | Mutación | Ordena automáticamente por metadatos de audio, posición, temporada/episodio o campos de `user_metadata`. Admite `dry_run`. | Se diferencia del reorder manual. Revisar los resultados antes de aplicar criterios con datos incompletos. | PENDIENTE |

## 11. Playlists virtuales: identidad, calidad e intercambio

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_resolve_virtual_playlist` | Mutación | Rebusca y actualiza identidades ausentes, antiguas, ambiguas o de baja confianza. Nunca considera permanentes los item keys de Roon. | Puede producir candidatos ambiguos; no sustituye la selección manual con `roon_set_virtual_playlist_track_match`. | PENDIENTE |
| `roon_validate_virtual_playlist` | Lectura | Detecta identidades no preparadas, referencias antiguas, coincidencias ambiguas, posiciones duplicadas, metadatos ausentes y duplicados probables, sin modificar. | Es una revisión general; `roon_deduplicate_virtual_playlist` está especializada en duplicados. | PENDIENTE |
| `roon_deduplicate_virtual_playlist` | Lectura | Detecta pistas duplicadas y propone qué hacer, sin borrar nada. | Solapa una parte de validate, pero ofrece análisis específico de duplicados. | PENDIENTE |
| `roon_export_virtual_playlist` | Lectura | Exporta una playlist completa como JSON, CSV o M3U. | Puede devolver bastante contenido. JSON es el formato completo para reimportar; CSV/M3U pueden perder estructura. | PENDIENTE |
| `roon_import_virtual_playlist` | Mutación | Crea o sobrescribe una playlist desde un payload JSON. Admite `dry_run`; una playlist existente requiere overwrite o confirmación. | Entrada amplia y potencialmente destructiva. Validar el payload antes de sobrescribir. | PENDIENTE |
| `roon_set_virtual_playlist_track_match` | Mutación | Asigna manualmente a una pista existente el `result_id` elegido por el usuario y guarda una identidad completa. | `result_id` e item key son temporales; la tool persiste una instantánea de identidad, no el ID temporal como identidad permanente. | PENDIENTE |
| `roon_add_search_result_to_virtual_playlist` | Mutación | Añade un `result_id` seleccionado a una playlist y lo convierte en identidad persistente con metadatos. | Es la variante exacta de add cuando ya existe un resultado de `roon_search_media`. | PENDIENTE |

## 12. Reproducción de playlists virtuales

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_play_virtual_playlist` | Mutación audible | Reconstruye referencias Roon desde las identidades persistentes y reproduce ahora, añade como siguiente o agrega al final. Admite límite y `dry_run`. | `play_now` puede reemplazar la cola; las identidades ambiguas o no resolubles deben manejarse antes. | PENDIENTE |

## 13. Búsqueda y selección tipada de música

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_search_media` | Lectura | Busca por tipos —pista, álbum, artista o playlist— y devuelve `result_id` temporales, fuente, calidad y confianza. Es el punto de entrada normal para elegir música nueva. | Los `result_id` caducan. No reproduce. Puede incluir imágenes base64, pero normalmente conviene pedir solo `image_key`. | PENDIENTE |
| `roon_expand_media_search` | Lectura | Amplía una búsqueda fallida quitando contexto, usando artista/título, búsqueda difusa o todas las estrategias. | No debería ser la primera búsqueda. Puede aumentar candidatos ambiguos. | PENDIENTE |
| `roon_get_media_details` | Lectura | Lee tipo, título, fuente, calidad y caducidad de un `result_id` actual. | Solo funciona mientras la sesión de búsqueda siga válida. `roon_open_media_entity_widget` ofrece detalle visual/navegable. | PENDIENTE |
| `roon_list_artist_releases` | Lectura | Lista álbumes de un artista seleccionado para resolver peticiones como «último disco» o «primeros álbumes». | Requiere un `result_id` de artista, no texto libre. | PENDIENTE |
| `roon_play_media` | Mutación audible/destructiva | Reproduce exactamente un `result_id` y reemplaza la cola de la zona. Para artistas reproduce su catálogo; admite `dry_run`. | No usar para radio de similares ni para añadir sin interrumpir. El reemplazo de cola es relevante. | PENDIENTE |
| `roon_start_radio` | Mutación audible | Inicia Roon Radio desde un artista, incluyendo artistas similares. | No equivale a reproducir solo el artista; para eso usar `roon_play_media`. | PENDIENTE |
| `roon_add_media_to_queue` | Mutación | Añade un `result_id` como siguiente o al final sin reemplazar la reproducción actual. Admite `dry_run`. | No inicia necesariamente la reproducción. Para reemplazar cola usar `roon_play_media`. | PENDIENTE |

## 14. Imágenes

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_get_image` | Lectura | Descarga una imagen Roon a tamaño solicitado y la devuelve como data URL base64. | Duplica parcialmente `roon_get_image_url` y genera respuestas grandes. Conservar solo si hay clientes que necesiten la imagen embebida. | PENDIENTE |

## 15. Gestión de extensiones

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_extension_manager_status` | Lectura | Informa del tipo de despliegue y de las capacidades disponibles para gestionar extensiones. | La implementación actual declara list/logs, pero restart/update/enable/disable como no disponibles. | PENDIENTE |
| `roon_list_extensions` | Lectura | Lista extensiones detectables de forma segura. | En la implementación actual solo construye una entrada local para RoonIA; puede aportar poco frente a status/version. | PENDIENTE |
| `roon_get_extension_details` | Lectura | Devuelve versión, despliegue, conexión y limitaciones de una extensión permitida. | Actualmente solo puede inspeccionar RoonIA; solapa `roon_version`, `roon_status` y manager status. | PENDIENTE |
| `roon_get_extension_logs` | Lectura | Devuelve logs sanitizados de una extensión permitida con filtros de nivel y límite. | Actualmente filtra los mismos logs técnicos de RoonIA que `roon_get_recent_logs`. | PENDIENTE |
| `roon_restart_extension` | Destructiva/no disponible | Solicita reiniciar una extensión tras `confirm:true`. | El backend actual siempre termina en `EXTENSION_MUTATION_UNAVAILABLE`; no puede reiniciar nada. | PENDIENTE |
| `roon_enable_extension` | Destructiva/no disponible | Solicita habilitar una extensión tras confirmación. | El backend actual siempre devuelve operación no disponible. | PENDIENTE |
| `roon_disable_extension` | Destructiva/no disponible | Solicita deshabilitar una extensión tras confirmación. | El backend actual siempre devuelve operación no disponible. | PENDIENTE |
| `roon_update_extension` | Destructiva/no disponible | Solicita actualizar una extensión tras confirmación. | El backend actual siempre devuelve operación no disponible. | PENDIENTE |

## 16. Auditoría, logs y diagnóstico

| Tool | Tipo | Qué hace y cuándo usarla | Relación o precaución | Decisión |
|---|---|---|---|---|
| `roon_list_action_logs` | Lectura | Lista acciones MCP, HTTP, portal o sistema ya sanitizadas. Permite filtrar errores y mutaciones. | Son registros de auditoría de acciones, no logs técnicos del proceso. | PENDIENTE |
| `roon_get_action_log` | Lectura | Devuelve el detalle sanitizado de una acción concreta mediante `action_id`. | Requiere obtener el ID en `roon_list_action_logs`. | PENDIENTE |
| `roon_clear_action_logs` | Destructiva | Borra el historial local de auditoría y exige `confirm:true`. | Elimina evidencia útil para soporte. Debe reservarse a una petición explícita administrativa. | PENDIENTE |
| `roon_get_recent_logs` | Lectura | Consulta logs técnicos sanitizados por nivel, componente, fecha y límite. | Puede solapar `roon_get_extension_logs`; no equivale a auditoría de acciones. | PENDIENTE |
| `roon_get_error_summary` | Lectura | Devuelve un resumen acotado de warnings y errores recientes sin cargar todos los logs. | Es un subconjunto práctico de `roon_get_recent_logs`; valorar si la comodidad justifica una tool separada. | PENDIENTE |
| `roon_diagnostics_bundle` | Lectura | Genera un paquete JSON sanitizado con estado, errores, acciones y opcionalmente esquemas de tools. | Puede reunir información de varias tools y producir una respuesta grande. Adecuada para soporte, no para preguntas cotidianas. | PENDIENTE |

## 17. Resumen para completar después de la decisión

| Resultado | Cantidad |
|---|---:|
| Mantener visibles al modelo | PENDIENTE |
| Mantener solo para app/widget | PENDIENTE |
| Fusionar o sustituir | PENDIENTE |
| Eliminar | PENDIENTE |
| Total revisado | 89 |

## 18. Comprobaciones antes de eliminar

Antes de aplicar las decisiones conviene comprobar, para cada tool marcada:

1. Si algún widget la invoca mediante `window.openai.callTool` o el bridge MCP
   Apps.
2. Si aparece en permisos de API keys o en `tool_settings` existentes.
3. Si clientes MCP externos dependen del nombre o del esquema actual.
4. Si eliminarla requiere retirar rutas HTTP, servicios o solamente el registro
   MCP.
5. Si las instrucciones globales del servidor o la documentación todavía la
   recomiendan.
6. Si la retirada cambia el widget URI, la versión publicada o necesita un
   periodo de compatibilidad.
