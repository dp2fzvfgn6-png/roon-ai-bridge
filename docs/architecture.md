# Architecture

The v0.8 code is intentionally modular even though the current feature set is small.

```text
src/
  index.ts
  config/
    env.ts
  roon/
    roonClient.ts
    roonTransportService.ts
    roonBrowseService.ts
    roonZoneService.ts
    roonQueueService.ts
    roonPlaybackService.ts
    roonVolumeService.ts
    roonTypes.ts
  api/
    server.ts
    routes/
      health.routes.ts
      roon.routes.ts
      zones.routes.ts
      playback.routes.ts
      volume.routes.ts
      library.routes.ts
      queue.routes.ts
      playlists.routes.ts
  services/
    playlistService.ts
    historyService.ts
    preferencesService.ts
  db/
    database.ts
    schema.sql
  mcp/
    README.md
    index.ts
    server.ts
    mcpContext.ts
    mcpTools.ts
    tools.todo.ts
  security/
    README.md
  utils/
    logger.ts
    errors.ts
    validation.ts
```

## Layers

- `config`: environment parsing and runtime settings.
- `roon`: Roon Core discovery, transport service, zone mapping, playback and volume.
- `api`: Express server and route definitions.
- `services`: future application services.
- `db`: future persistence adapter and schema.
- `mcp`: local/remote MCP server, Apps SDK widget resource and Roon tool definitions.
- `security`: future auth/security notes.
- `utils`: common logging, errors and validation.

## Current Runtime Flow

1. `src/index.ts` loads config.
2. Logger is created.
3. If `ENABLE_AUTH=true`, `API_TOKEN` is required before startup continues.
4. Roon client starts discovery.
5. Express starts on `PORT`.
6. `/health` stays public.
7. Other HTTP API routes pass through Bearer-token auth when enabled.
8. Roon authorization is completed in the Roon UI.
9. The transport service subscribes to zones.
10. The browse service is available when Roon exposes `RoonApiBrowse`.
11. API routes use Roon services to list zones, control playback, control volume, browse the library, search, play by query, manage the queue and play virtual playlists.
12. `src/mcp/index.ts` can be launched separately with `npm run mcp` to expose the same core capabilities as MCP stdio tools.
13. `POST /mcp` and `GET /mcp` expose the same MCP tool set over Streamable HTTP for ChatGPT app development.

## Persistence Plan

`db/schema.sql` prepares future SQLite tables:

- `app_settings`
- `roon_cores`
- `zones_cache`
- `virtual_playlists`
- `virtual_playlist_tracks`
- `play_history`
- `command_history`
- `user_preferences`
- `search_cache`

v0.8 persists Roon authorization state in `data/roonstate.json` and local virtual playlists in `data/virtual-playlists.json`.
