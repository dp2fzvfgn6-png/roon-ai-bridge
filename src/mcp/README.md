# MCP Server

v0.6 adds a local MCP stdio server. v0.8 adds a remote Streamable HTTP MCP endpoint for ChatGPT app development.

A local MCP client can launch stdio as a command from the LXC or another trusted shell that has access to the project.

Build first:

```bash
npm run build
```

Run from the project directory:

```bash
DATA_DIR=/opt/roon-ai-bridge/data ENABLE_BROWSE=true npm run mcp
```

Remote MCP endpoint:

```text
https://roonia.ipchome.com/mcp
```

The remote endpoint is protected by the same Bearer token middleware as the HTTP API.

Implemented tools:

- `roon_status`
- `roon_list_zones`
- `roon_control_playback`
- `roon_change_volume`
- `roon_search`
- `roon_play_by_query`
- `roon_get_queue`
- `roon_queue_by_query`
- `roon_play_queue_item_from_here`
- `roon_list_virtual_playlists`
- `roon_create_virtual_playlist`
- `roon_add_virtual_playlist_track`
- `roon_play_virtual_playlist`

Future phases still need OAuth and per-user authorization before broader app distribution.
