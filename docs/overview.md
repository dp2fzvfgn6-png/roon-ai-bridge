# Overview

Roon AI Bridge is a local Roon extension with a small HTTP API.

The v0.1 goal is intentionally narrow:

- Run in a dedicated Proxmox LXC.
- Use the same VLAN/subnet as Roon Core.
- Discover and connect to Roon Core over the LAN.
- Register and authorize the extension in Roon.
- List zones.
- Show now playing.
- Control playback.
- Control volume when the selected Roon output supports it.

v0.1 deliberately does not implement:

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
