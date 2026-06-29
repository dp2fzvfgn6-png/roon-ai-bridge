# Architecture

The v0.10 code is intentionally modular even though the current feature set is still compact.

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
    roonMediaService.ts
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
      oauth.routes.ts
      media.routes.ts
  services/
    oauthService.ts
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
- `roonMediaService`: typed search, temporary media references and deterministic Browse actions.
- `api`: Express server and route definitions.
- `services`: OAuth persistence and application services such as virtual playlists.
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
6. `/health`, `/privacy`, OAuth discovery and OAuth endpoints stay public.
7. Other HTTP API routes pass through Bearer-token auth when enabled.
8. ChatGPT discovers OAuth metadata, dynamically registers a client, and obtains an access token with authorization code plus PKCE.
9. Roon authorization is completed separately in the Roon UI.
10. The transport service subscribes to zones.
11. The browse service is available when Roon exposes `RoonApiBrowse`.
12. API routes use Roon services to list zones, control playback, control volume, browse the library, search, play by query, manage the queue and play virtual playlists.
13. `src/mcp/index.ts` can be launched separately with `npm run mcp` to expose the same core capabilities as MCP stdio tools.
14. Typed search creates short-lived `result_id` references and re-resolves selected media in a fresh Roon Browse session before acting.
15. `POST /mcp` and `GET /mcp` expose the same MCP tool set over Streamable HTTP for ChatGPT app development.

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

v0.10 persists Roon authorization state in `data/roonstate.json`, local virtual playlists in `data/roonia.sqlite`, and private OAuth clients/codes/tokens in `data/oauth-store.json`. On first launch with an empty SQLite store, legacy playlists from `data/virtual-playlists.json` are imported automatically.
