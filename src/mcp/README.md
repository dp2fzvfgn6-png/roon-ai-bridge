# MCP Server

v0.6 adds a local MCP stdio server.

It is intentionally not exposed as a public HTTP endpoint. A local MCP client can launch it as a command from the LXC or another trusted shell that has access to the project.

Build first:

```bash
npm run build
```

Run from the project directory:

```bash
DATA_DIR=/opt/roon-ai-bridge/data ENABLE_BROWSE=true npm run mcp
```

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

Future phases still need an authorization policy before exposing MCP beyond trusted local execution.
