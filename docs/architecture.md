# Architecture

The v0.5 code is intentionally modular even though the current feature set is small.

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
- `mcp`: future MCP notes and tool placeholders.
- `security`: future auth/security notes.
- `utils`: common logging, errors and validation.

## Current Runtime Flow

1. `src/index.ts` loads config.
2. Logger is created.
3. Roon client starts discovery.
4. Express starts on `PORT`.
5. Roon authorization is completed in the Roon UI.
6. The transport service subscribes to zones.
7. The browse service is available when Roon exposes `RoonApiBrowse`.
8. API routes use Roon services to list zones, control playback, control volume, browse the library, search, play by query, manage the queue and play virtual playlists.

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

v0.5 persists Roon authorization state in `data/roonstate.json` and local virtual playlists in `data/virtual-playlists.json`.
