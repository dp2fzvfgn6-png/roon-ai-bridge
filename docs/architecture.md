# Architecture

The API, MCP server and administration portal share one Roon client and data
store. The active MCP facade is an independent v2 subsystem with its own
contracts and intent orchestration.

```text
src/
  index.ts
  config/
    env.ts
  roon/
    roonClient.ts
    roonSdk.ts
    roonStateCache.ts
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
  bridge-v2/
    contracts.ts
    context.ts
    targetResolver.ts
    intentGateway.ts
    mcp/
      server.ts
      tools.ts
    widgets/
      resources.ts
      tools.ts
      viewService.ts
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
- `roonSdk`: typed callback boundary, request timeouts and shared state-verification helpers.
- `roonStateCache`: public subscription-event reducer for the live zone cache.
- `roonMediaService`: typed search, temporary media references and deterministic Browse actions.
- `api`: Express server and route definitions.
- `services`: OAuth persistence and application services such as virtual playlists.
- `db`: future persistence adapter and schema.
- `bridge-v2`: active local/remote MCP intent facade and focused widget layer.
- `mcp`: disconnected legacy facade retained pending a dependency audit.
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
13. `src/mcp/index.ts` launches the `bridge-v2` server with `npm run mcp` and exposes 30 canonical intents plus focused widget entry points over stdio.
14. Typed search creates short-lived `result_id` references and re-resolves selected media in a fresh Roon Browse session before acting.
15. `POST /mcp` and `GET /mcp` expose the same MCP v2 tools and cache-busted widget resources over Streamable HTTP.

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

Runtime port, update-channel and public bridge/portal URL overrides live in
`data/runtime-config.json`. Update requests and staged results use
`data/update-request.json` and `data/update-status.json` as a narrow handoff
between the app container and the LXC systemd watcher. The container build
receives the deployed Git commit so equal semantic versions can still be
compared and distinguished by build.
