# Overview

Roon AI Bridge is a local Roon extension with an HTTP API, administration
portal and a data-only MCP v2 intent facade.

The current v0.9 goal is intentionally narrow:

- Run in a dedicated Proxmox LXC.
- Use the same VLAN/subnet as Roon Core.
- Discover and connect to Roon Core over the LAN.
- Register and authorize the extension in Roon.
- List zones.
- Show now playing.
- Control playback.
- Control volume when the selected Roon output supports it.
- Browse the Roon library at a basic level.
- Search Roon through the browse service.
- Start playback from a simple query.
- Read queue snapshots and perform basic queue actions.
- Store and play local virtual playlists.
- Expose 29 intent-oriented MCP tools over stdio and Streamable HTTP.
- Resolve zone/output names and query-to-action flows inside one MCP call.
- Optionally protect the HTTP API with a Bearer API token.
- Authorize a private ChatGPT app with OAuth authorization code and PKCE.
- Publish a simple privacy notice for app setup.
- Search media by track, album, artist or playlist.
- Use temporary references for deterministic playback and queue actions.
- Keep artist-catalog playback distinct from similar-music radio.
- Return one uniform structured MCP result envelope without attached widgets.

ChatGPT is intentionally disconnected during the MCP v2 and widget redesign.
The widget and ChatGPT reconnection are later validation phases.

v0.9 deliberately does not implement:

- OpenAI API calls from the bridge
- public app-directory submission
- per-user accounts, refresh tokens or granular OAuth scopes
- Cloudflare Tunnel
- TIDAL direct integration
- direct Roon or TIDAL playlist creation
- hardened multi-user authorization

The project is still structured for those future phases so it does not need to be rewritten later.
