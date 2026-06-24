# Overview

Roon AI Bridge is a local Roon extension with a small HTTP API.

The current v0.2 goal is intentionally narrow:

- Run in a dedicated Proxmox LXC.
- Use the same VLAN/subnet as Roon Core.
- Discover and connect to Roon Core over the LAN.
- Register and authorize the extension in Roon.
- List zones.
- Show now playing.
- Control playback.
- Control volume when the selected Roon output supports it.
- Browse the Roon library at a basic level.

v0.2 deliberately does not implement:

- OpenAI
- ChatGPT
- MCP
- Cloudflare Tunnel
- Authentication
- Search
- TIDAL direct integration
- Queue management
- Playlists

The project is still structured for those future phases so it does not need to be rewritten later.
