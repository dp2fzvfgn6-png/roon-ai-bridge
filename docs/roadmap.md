# Roadmap

- v0.1: basic control.
- v0.2: browse/library.
- v0.3: search/play by query.
- v0.4: queue management.
- v0.5: virtual playlists.
- v0.6: MCP server.
- v0.7: auth + Cloudflare Tunnel.
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
