# HTTP API

Default port: `3000`.

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

## Search

```bash
curl "http://localhost:3000/roon/search?q=massive%20attack&count=10"
```

Optional parameters:

- `zone_id`: includes zone context for playback-capable browse actions.
- `offset`: defaults to `0`.
- `count`: defaults to `25`, max `100`.
- `session_key`: keeps related browse/search calls in the same Roon browse session.

## Play By Query

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
  -d '{"query":"bad bunny monaco","title":"MONACO","artist":"Bad Bunny"}'
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

Virtual playlists are local to Roon AI Bridge and are stored in `data/virtual-playlists.json`. Tracks are stored as stable search queries, not Roon browse `item_key` values.

## MCP Tools

v0.6 also exposes the core local features through an MCP stdio server. It is not hosted over HTTP.

Run from `/opt/roon-ai-bridge` after building:

```bash
DATA_DIR=/opt/roon-ai-bridge/data ENABLE_BROWSE=true npm run mcp
```

Implemented tools:

- `roon_status`
- `roon_list_zones`
- `roon_control_playback`
- `roon_change_volume`
- `roon_search`
- `roon_play_by_query`
- `roon_get_queue`
- `roon_queue_by_query`
- `roon_play_queue_item_from_here`
- `roon_list_virtual_playlists`
- `roon_create_virtual_playlist`
- `roon_add_virtual_playlist_track`
- `roon_play_virtual_playlist`

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

These endpoints exist but are not implemented in v0.6:

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
