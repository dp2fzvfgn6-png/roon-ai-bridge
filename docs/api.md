# HTTP API

Default port: `3000`.

## Authentication

Authentication is optional and controlled by `.env`:

```env
ENABLE_AUTH=true
API_TOKEN=<long random token>
```

When enabled, `/health` and `/privacy` are public. Every Roon, playlist, history, preferences and MCP endpoint requires:

```bash
curl http://localhost:3000/roon/status \
  -H "Authorization: Bearer <API_TOKEN>"
```

Missing or invalid tokens return `401` with the standard error format.

## OAuth For ChatGPT Apps

OAuth metadata:

```bash
curl http://localhost:3000/.well-known/oauth-protected-resource
curl http://localhost:3000/.well-known/oauth-authorization-server
```

Dynamic client registration:

```bash
curl -X POST http://localhost:3000/oauth/register \
  -H "Content-Type: application/json" \
  -d '{"client_name":"ChatGPT","redirect_uris":["https://chatgpt.com/connector/oauth/example"]}'
```

Authorization endpoint:

```text
http://localhost:3000/oauth/authorize
```

Token endpoint:

```text
http://localhost:3000/oauth/token
```

The approval page asks for `OAUTH_APPROVAL_PIN`. If that variable is empty, it falls back to `API_TOKEN`.

## Health

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "ok": true,
  "service": "roon-ai-bridge"
}
```

## Privacy Notice

```bash
curl http://localhost:3000/privacy
```

This endpoint is public and can be used as the privacy policy URL when configuring a ChatGPT app.

## Roon Status

```bash
curl http://localhost:3000/roon/status
```

Response:

```json
{
  "core_connected": true,
  "core_name": "Roon Core",
  "transport_ready": true,
  "browse_ready": true,
  "zones_count": 2
}
```

## Capabilities

```bash
curl http://localhost:3000/roon/capabilities
```

## Library Browse

Browse root:

```bash
curl "http://localhost:3000/roon/library"
```

Browse a specific hierarchy:

```bash
curl "http://localhost:3000/roon/library?hierarchy=albums&count=50"
```

Library items now include a normalized `media` object with song-level metadata such as artist, album, track number, duration, release year and `cover.image_key` when Roon exposes those fields.

Open an item from a previous response:

```bash
curl "http://localhost:3000/roon/library?item_key=<ITEM_KEY>&zone_id=<ZONE_ID>"
```

Go back one browse level:

```bash
curl "http://localhost:3000/roon/library?pop_levels=1"
```

Reset to browse root:

```bash
curl "http://localhost:3000/roon/library?pop_all=true"
```

Supported library hierarchies:

- `browse`
- `albums`
- `artists`
- `genres`
- `composers`
- `internet_radio`
- `playlists`

## Typed Media Search

```bash
curl -G "http://localhost:3000/roon/media/search" \
  --data-urlencode "q=Bad Bunny" \
  --data-urlencode "types=track,album,artist" \
  --data-urlencode "zone_id=<ZONE_ID>" \
  --data-urlencode "source_preference=streaming_first"
```

Supported types:

- `track`
- `album`
- `artist`
- `playlist`

Every result includes a temporary `result_id`. Use it within 20 minutes:

```bash
curl "http://localhost:3000/roon/media/<RESULT_ID>"

curl -X POST "http://localhost:3000/roon/media/<RESULT_ID>/play" \
  -H "Content-Type: application/json" \
  -d '{"zone_id":"<ZONE_ID>","mode":"replace_queue"}'
```

Playback modes:

- `replace_queue`
- `play_next`
- `append`

For artist results, normal playback uses the artist catalog. Similar-music radio is explicit:

```bash
curl -X POST "http://localhost:3000/roon/media/<RESULT_ID>/radio" \
  -H "Content-Type: application/json" \
  -d '{"zone_id":"<ZONE_ID>"}'
```

Artist releases:

```bash
curl "http://localhost:3000/roon/media/<ARTIST_RESULT_ID>/releases?zone_id=<ZONE_ID>"
```

## Legacy Search

```bash
curl "http://localhost:3000/roon/search?q=massive%20attack&count=10"
```

Optional parameters:

- `zone_id`: includes zone context for playback-capable browse actions.
- `offset`: defaults to `0`.
- `count`: defaults to `25`, max `100`.
- `session_key`: keeps related browse/search calls in the same Roon browse session.

## Legacy Play By Query

```bash
curl -X POST http://localhost:3000/roon/play \
  -H "Content-Type: application/json" \
  -d '{"zone_id":"<ZONE_ID>","query":"massive attack mezzanine"}'
```

The implementation searches Roon, selects the first plausible playable result, then follows Roon browse actions until playback starts or no playback action is found.

## Queue

Read queue snapshot:

```bash
curl "http://localhost:3000/roon/queue/<ZONE_ID>?max_item_count=50"
```

Play from a queue item:

```bash
curl -X POST http://localhost:3000/roon/queue/<ZONE_ID> \
  -H "Content-Type: application/json" \
  -d '{"action":"play_from_here","queue_item_id":"<QUEUE_ITEM_ID>"}'
```

Add a query result next:

```bash
curl -X POST http://localhost:3000/roon/queue/<ZONE_ID> \
  -H "Content-Type: application/json" \
  -d '{"action":"add_next","query":"bad bunny"}'
```

Add a query result to the queue:

```bash
curl -X POST http://localhost:3000/roon/queue/<ZONE_ID> \
  -H "Content-Type: application/json" \
  -d '{"action":"add_to_queue","query":"bad bunny"}'
```

Inspect queue/play actions exposed by Roon for a query:

```bash
curl -X POST http://localhost:3000/roon/queue/<ZONE_ID> \
  -H "Content-Type: application/json" \
  -d '{"action":"inspect_actions","query":"bad bunny"}'
```

The add actions depend on Roon exposing matching browse actions for the selected result. `add_to_queue` only executes an explicit end-of-queue action; if Roon only exposes an ambiguous `Add to Queue` action that behaves like add-next, the API returns `QUEUE_ACTION_NOT_FOUND` with `available_actions`.

## Virtual Playlists

List virtual playlists:

```bash
curl http://localhost:3000/playlists
```

Create a virtual playlist:

```bash
curl -X POST http://localhost:3000/playlists \
  -H "Content-Type: application/json" \
  -d '{"playlist_id":"bad-bunny-test","name":"Bad Bunny Test","tracks":[{"query":"bad bunny dakiti"},{"query":"bad bunny neverita"}]}'
```

Get one virtual playlist:

```bash
curl http://localhost:3000/playlists/bad-bunny-test
```

Add a track:

```bash
curl -X POST http://localhost:3000/playlists/bad-bunny-test/tracks \
  -H "Content-Type: application/json" \
  -d '{"query":"bad bunny monaco","title":"MONACO","artist":"Bad Bunny","image_key":"cover-123"}'
```

Update playlist metadata:

```bash
curl -X PATCH http://localhost:3000/playlists/bad-bunny-test \
  -H "Content-Type: application/json" \
  -d '{"name":"Bad Bunny Test v0.10","description":"SQLite playlist"}'
```

Replace every track in a playlist:

```bash
curl -X PUT http://localhost:3000/playlists/bad-bunny-test/tracks \
  -H "Content-Type: application/json" \
  -d '{"tracks":[{"query":"bad bunny dakiti","title":"Dákiti"},{"query":"bad bunny monaco","title":"MONACO"}]}'
```

Update one track:

```bash
curl -X PATCH http://localhost:3000/playlists/bad-bunny-test/tracks/<TRACK_ID> \
  -H "Content-Type: application/json" \
  -d '{"query":"bad bunny monaco live","title":"MONACO (Live)","position":1}'
```

Reorder tracks:

```bash
curl -X POST http://localhost:3000/playlists/bad-bunny-test/tracks/reorder \
  -H "Content-Type: application/json" \
  -d '{"track_ids":["<TRACK_ID_2>","<TRACK_ID_1>"]}'
```

Remove a track:

```bash
curl -X DELETE http://localhost:3000/playlists/bad-bunny-test/tracks/<TRACK_ID>
```

Play or enqueue a virtual playlist:

```bash
curl -X POST http://localhost:3000/playlists/bad-bunny-test/play \
  -H "Content-Type: application/json" \
  -d '{"zone_id":"<ZONE_ID>","mode":"add_to_queue"}'
```

Supported play modes:

- `add_to_queue`
- `add_next`
- `play_now`

Virtual playlists are local to Roon AI Bridge and are stored in `data/roonia.sqlite`. On first start, legacy data from `data/virtual-playlists.json` is migrated automatically if the SQLite store is still empty. Tracks are still played through stable search queries, with optional saved metadata including cover `image_key`.

## MCP Tools

v0.6 added core local features through an MCP stdio server. v0.8 exposes the same MCP server over HTTP at `/mcp`, and v0.8.1 adds OAuth for a private ChatGPT app.

Remote MCP endpoint:

```text
https://roonia.ipchome.com/mcp
```

ChatGPT uses an OAuth access token. Direct administrative tests can use the static `API_TOKEN`.

Run from `/opt/roon-ai-bridge` after building:

```bash
DATA_DIR=/opt/roon-ai-bridge/data ENABLE_BROWSE=true npm run mcp
```

Implemented tools:

- `roon_status`
- `roon_list_zones`
- `roon_control_playback`
- `roon_change_volume`
- `roon_transfer_playback`
- `roon_group_zones`
- `roon_ungroup_zone`
- `roon_search`
- `roon_play_by_query`
- `roon_get_queue`
- `roon_queue_by_query`
- `roon_play_queue_item_from_here`
- `roon_list_virtual_playlists`
- `roon_create_virtual_playlist`
- `roon_get_virtual_playlist`
- `roon_update_virtual_playlist`
- `roon_delete_virtual_playlist`
- `roon_add_virtual_playlist_track`
- `roon_update_virtual_playlist_track`
- `roon_remove_virtual_playlist_track`
- `roon_replace_virtual_playlist_tracks`
- `roon_reorder_virtual_playlist_tracks`
- `roon_play_virtual_playlist`
- `roon_search_media`
- `roon_get_media_details`
- `roon_list_artist_releases`
- `roon_play_media`
- `roon_start_radio`
- `roon_add_media_to_queue`
- `roon_list_outputs`
- `roon_seek`
- `roon_mute_output`
- `roon_change_output_volume`
- `roon_mute_all`
- `roon_pause_all`
- `roon_output_power`
- `roon_change_playback_settings`
- `roon_restart_queue`
- `roon_run_browse_action`
- `roon_get_image`

## Administration Portal API

The portal on port `3001` uses protected same-origin endpoints:

- `GET /api/auth/status`
- `POST /api/auth/setup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/session`
- `GET /api/dashboard`
- `GET /api/admin/settings`
- `GET /api/admin/system`
- `PATCH /api/admin/system/ports`
- `POST /api/admin/system/check-update`
- `POST /api/admin/system/update`
- `POST /api/admin/system/restart`
- `GET /api/admin/api-keys`
- `POST /api/admin/api-keys`
- `DELETE /api/admin/api-keys/:key_id`
- CRUD and apply routes below `/api/admin/zone-presets`
- Read/write/apply routes below `/api/admin/output-volumes`

It also exposes existing Roon routes below `/api/roon/*` and playlist routes
below `/api/playlists/*`. Every portal API endpoint requires
`Authorization: Bearer <ADMIN_TOKEN>`.

```bash
curl -X POST http://localhost:3001/api/admin/api-keys \
  -H "Authorization: Bearer $PORTAL_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Home automation","role":"control"}'
```

Roles:

- `read`: read-only access to the main HTTP API.
- `control`: reads and mutating Roon/playlist requests.
- `admin`: control plus access to the portal and API-key management.

The creation response contains `token` once. List responses expose only
`key_prefix`; revocation is permanent.

## Advanced Transport And Outputs

- `GET /roon/outputs`
- `POST /roon/zones/:zone_id/seek`
- `POST /roon/zones/:zone_id/settings`
- `POST /roon/zones/:zone_id/queue/restart`
- `POST /roon/outputs/:output_id/mute`
- `POST /roon/outputs/:output_id/volume`
- `POST /roon/outputs/:output_id/power`
- `POST /roon/mute-all`
- `POST /roon/pause-all`
- `GET /roon/images/:image_key`
- `POST /roon/browse/action`

Power actions are `standby`, `toggle_standby` and `convenience_switch`. Seek
modes are `absolute` and `relative`. Playback settings accept `shuffle`,
`auto_radio` and `loop`.

`POST /roon/browse/action` executes an `item_key` in its existing Browse
session and can include `input` for `input_prompt`. Responses preserve native
`list`, `message`, `none`, `replace_item` and `remove_item` effects.

Queue restart plays from the first item returned by Roon; it does not clear or
rebuild the queue.

## Zones

```bash
curl http://localhost:3000/roon/zones
```

## Playback Control

```bash
curl -X POST http://localhost:3000/roon/zones/<ZONE_ID>/control \
  -H "Content-Type: application/json" \
  -d '{"command":"playpause"}'
```

Supported commands:

- `play`
- `pause`
- `playpause`
- `stop`
- `next`
- `previous`

## Zone Playback Transfer

```bash
curl -X POST http://localhost:3000/roon/zones/transfer \
  -H "Content-Type: application/json" \
  -d '{"source_zone_id":"<SOURCE_ZONE_ID>","target_zone_id":"<TARGET_ZONE_ID>"}'
```

The endpoint uses Roon's native `transfer_zone` command to move the current
queue and playback state. It does not reconstruct the queue from metadata.

## Zone Grouping

Preserve the primary zone queue and group compatible additional zones:

```bash
curl -X POST http://localhost:3000/roon/zones/group \
  -H "Content-Type: application/json" \
  -d '{"primary_zone_id":"<PRIMARY_ZONE_ID>","additional_zone_ids":["<ZONE_ID_2>","<ZONE_ID_3>"]}'
```

Fully split every output in a grouped zone:

```bash
curl -X POST http://localhost:3000/roon/zones/<GROUPED_ZONE_ID>/ungroup
```

Both operations wait for the Roon zone subscription to confirm the final
topology and return `state_verified: true`. Grouping preserves the queue of the
primary zone and replaces the independent queues of added zones.

## Volume

Relative:

```bash
curl -X POST http://localhost:3000/roon/zones/<ZONE_ID>/volume \
  -H "Content-Type: application/json" \
  -d '{"mode":"relative","value":1}'
```

Absolute:

```bash
curl -X POST http://localhost:3000/roon/zones/<ZONE_ID>/volume \
  -H "Content-Type: application/json" \
  -d '{"mode":"absolute","value":35}'
```

The API checks whether the zone has outputs with Roon volume control.

## Prepared 501 Endpoints

These endpoints exist but are not implemented in v0.8.1:

- `GET /history`
- `GET /preferences`

## Error Format

```json
{
  "error": {
    "code": "ZONE_NOT_FOUND",
    "message": "Zone not found",
    "details": {}
  }
}
```

Planned error codes:

- `ROON_NOT_CONNECTED`
- `ROON_NOT_AUTHORIZED`
- `AUTH_REQUIRED`
- `AUTH_INVALID`
- `TRANSPORT_NOT_READY`
- `BROWSE_NOT_READY`
- `INVALID_SEARCH_QUERY`
- `SEARCH_NO_RESULTS`
- `PLAYBACK_ACTION_NOT_FOUND`
- `QUEUE_NOT_READY`
- `INVALID_QUEUE_ACTION`
- `INVALID_QUEUE_ITEM_ID`
- `QUEUE_ACTION_NOT_FOUND`
- `PLAYLIST_NOT_FOUND`
- `PLAYLIST_TRACK_NOT_FOUND`
- `INVALID_PLAYLIST`
- `INVALID_PLAYLIST_TRACK`
- `INVALID_PLAYLIST_PLAY_MODE`
- `ZONE_NOT_FOUND`
- `OUTPUT_NOT_FOUND`
- `UNSUPPORTED_COMMAND`
- `VOLUME_NOT_SUPPORTED`
- `INVALID_VOLUME_MODE`
- `INVALID_VOLUME_VALUE`
- `NOT_IMPLEMENTED`
- `INTERNAL_ERROR`
