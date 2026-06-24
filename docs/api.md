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

Supported v0.2 hierarchies:

- `browse`
- `albums`
- `artists`
- `genres`
- `composers`
- `internet_radio`

Search hierarchy remains out of scope until v0.3.

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

These endpoints exist but are not implemented in v0.2:

- `GET /roon/search?q=...`
- `POST /roon/play`
- `GET /roon/queue/:zone_id`
- `POST /roon/queue/:zone_id`
- `GET /playlists`
- `POST /playlists`
- `POST /playlists/:playlist_id/play`
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
- `ZONE_NOT_FOUND`
- `OUTPUT_NOT_FOUND`
- `UNSUPPORTED_COMMAND`
- `VOLUME_NOT_SUPPORTED`
- `INVALID_VOLUME_MODE`
- `INVALID_VOLUME_VALUE`
- `NOT_IMPLEMENTED`
- `INTERNAL_ERROR`
