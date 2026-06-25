# Overview

Roon AI Bridge is a local Roon extension with a small HTTP API and optional MCP stdio server.

The current v0.7 goal is intentionally narrow:

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
- Expose local MCP stdio tools for trusted local clients.
- Optionally protect the HTTP API with a Bearer API token.

v0.7 deliberately does not implement:

- OpenAI
- ChatGPT
- hosted or remote MCP
- Cloudflare Tunnel
- TIDAL direct integration
- direct Roon or TIDAL playlist creation
- scoped per-user authorization

The project is still structured for those future phases so it does not need to be rewritten later.
