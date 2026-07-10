# Architecture

The v0.12 code keeps the API, MCP server and administration portal on one
shared Roon client and service graph.

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
  portal/
    server.ts
  services/
    oauthService.ts
    playlistService.ts
    portalAuthService.ts
    systemManagementService.ts
    zonePresetService.ts
    outputVolumeSettingsService.ts
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

Static portal assets live in `portal/` and are copied into the Docker image.
The main API listens on `3000`; the portal listens on `3001`. Both servers run
inside the same Node.js process so they observe the same Roon subscription,
playlists and API-key database without registering a second extension.

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

Virtual playlist identity is owned by RoonIA. `track_id` is permanent and each
row stores a semantic recording snapshot plus a versioned fingerprint in
SQLite. Roon Browse `item_key` and media `result_id` values are explicitly
ephemeral: playback searches and scores fresh candidates from the stored
identity, rejects ambiguous matches, then performs the action in a fresh Browse
session. `play_now` resolves the first track before replacing the existing
queue.

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

v0.12 persists Roon authorization state in `data/roonstate.json`, local virtual
playlists, portal users/sessions, zone presets, volume policies and hashed
managed API keys in `data/roonia.sqlite`, and private
OAuth clients/codes/tokens in `data/oauth-store.json`. On first launch with an
empty SQLite store, legacy playlists from `data/virtual-playlists.json` are
imported automatically.

Playlist rows created before the identity model are enriched on service start.
The migration preserves `track_id`, user metadata and audio metadata, and marks
any persisted Roon Browse reference as stale and non-reusable.

Runtime port overrides live in `data/runtime-config.json`. Update requests and
results use `data/update-request.json` and `data/update-status.json` as a narrow
handoff between the app container and the LXC systemd watcher.
