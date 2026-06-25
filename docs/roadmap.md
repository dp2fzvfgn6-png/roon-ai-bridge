# Roadmap

- v0.1: basic control.
- v0.2: browse/library.
- v0.3: search/play by query.
- v0.4: queue management.
- v0.5: virtual playlists.
- v0.6: MCP server.
- v0.7: HTTP API key auth for reverse proxy use.
- v0.8: ChatGPT App / final integration.

## v0.1 Implemented

- Roon extension registration.
- Roon authorization persistence.
- Roon Core connection.
- Zone listing.
- Now playing display.
- Playback control.
- Volume control when supported.
- Local HTTP API.
- Proxmox LXC installer.
- LXC update script.

## v0.1 Validated

See [v0.1 Validation](v0.1-validation.md).

Validated as working:

- List zones.
- Now playing.
- Play.
- Pause.
- Next.
- Previous.
- Relative volume.
- Absolute volume.
- Grouped zone: Salon + 2.

## v0.2 Scope

- Add `node-roon-api-browse`.
- Implement `GET /roon/library`.
- Support root browse, item drill-down, basic hierarchy selection and pagination.
- Keep search, queue and playlists out of scope.

## v0.2 Validated

See [v0.2 Validation](v0.2-validation.md).

Validated as working:

- Roon browse service readiness.
- Root library browse.
- Album hierarchy browse.
- Album item drill-down.
- UTF-8 JSON output.

## Not In Scope For v0.2

- Public internet exposure.
- Auth.
- MCP.
- OpenAI.
- ChatGPT.
- Cloudflare Tunnel.
- Search.
- Queue management.
- Playlists.
- TIDAL direct integration.

## v0.3 Scope

- Implement `GET /roon/search?q=...`.
- Implement `POST /roon/play`.
- Use Roon browse search, not OpenAI or external search.
- Select the first plausible playable result.
- Return clear errors when the query is empty, produces no result or exposes no playback action.
- Keep advanced ranking, queue management and playlists out of scope.

## Not In Scope For v0.3

- Public internet exposure.
- Auth.
- MCP.
- OpenAI.
- ChatGPT.
- Cloudflare Tunnel.
- Queue management.
- Playlists.
- TIDAL direct integration.
- Advanced result ranking.

## v0.3 Validated

See [v0.3 Validation](v0.3-validation.md).

Validated as working:

- Roon browse search.
- Play by query.
- Search/play against Roon-connected services exposed by Roon, including TIDAL.

## v0.4 Scope

- Implement `GET /roon/queue/:zone_id`.
- Implement `POST /roon/queue/:zone_id`.
- Support `play_from_here` for queue items.
- Support `add_next` and `add_to_queue` from a query when Roon exposes those browse actions.
- Keep virtual playlists, auth, MCP and OpenAI out of scope.

## Not In Scope For v0.4

- Public internet exposure.
- Auth.
- MCP.
- OpenAI.
- ChatGPT.
- Cloudflare Tunnel.
- Virtual playlists.
- Advanced queue editing and reordering.
- Direct TIDAL integration.

## v0.4 Validated

See [v0.4 Validation](v0.4-validation.md).

Validated as working:

- Queue snapshots.
- Queue action inspection.
- Add next from query.
- Add to end of queue from query.
- Play from queue item.

## v0.5 Scope

- Implement local virtual playlists.
- Store playlists in `data/virtual-playlists.json`.
- Store tracks as stable Roon search queries.
- Add and remove playlist tracks.
- Play or enqueue playlists with `add_to_queue`, `add_next` or `play_now`.
- Keep real Roon playlist editing, TIDAL playlist sync, auth, MCP and OpenAI out of scope.

## Not In Scope For v0.5

- Public internet exposure.
- Auth.
- MCP.
- OpenAI.
- ChatGPT.
- Cloudflare Tunnel.
- Direct TIDAL integration.
- Creating real Roon playlists.
- Creating or syncing TIDAL playlists.

## v0.5 Validated

See [v0.5 Validation](v0.5-validation.md).

## v0.6 Scope

- Add a local MCP stdio server.
- Keep the HTTP API unchanged.
- Expose MCP tools for status, zones, playback, volume, search, queue and virtual playlists.
- Keep MCP local/trusted only.
- Keep auth, Cloudflare, ChatGPT app packaging and external playlist sync out of scope.

## Not In Scope For v0.6

- Public internet exposure.
- Cloudflare Tunnel.
- Auth.
- ChatGPT App packaging.
- Direct TIDAL playlist creation or sync.
- A hosted HTTP MCP endpoint.

## v0.6 Validated

See [v0.6 Validation](v0.6-validation.md).

## v0.7 Scope

- Add optional Bearer-token authentication for the HTTP API.
- Keep `/health` public for proxy health checks.
- Protect `/roon/*`, `/playlists`, `/history`, `/preferences` and fallback routes when auth is enabled.
- Fail startup if `ENABLE_AUTH=true` and `API_TOKEN` is empty.
- Document use behind Nginx Proxy Manager.
- Keep MCP stdio local-only.

## Not In Scope For v0.7

- Nginx Proxy Manager automation.
- Cloudflare Tunnel.
- ChatGPT Actions schema.
- Remote/hosted MCP.
- Per-user permissions or scoped tokens.
