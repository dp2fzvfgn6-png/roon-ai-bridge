# MCP Server

v0.9 adds typed media tools, structured results and an interactive widget to the existing local/remote MCP server.

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

The remote endpoint accepts OAuth access tokens issued to ChatGPT. The administrative `API_TOKEN` remains valid for direct testing.

Implemented tools:

- `roon_status`
- `roon_list_zones`
- `roon_control_playback`
- `roon_change_volume`
- `roon_transfer_playback`
- `roon_search`
- `roon_play_by_query`
- `roon_get_queue`
- `roon_queue_by_query`
- `roon_play_queue_item_from_here`
- `roon_list_virtual_playlists`
- `roon_create_virtual_playlist`
- `roon_add_virtual_playlist_track`
- `roon_play_virtual_playlist`
- `roon_search_media`
- `roon_get_media_details`
- `roon_list_artist_releases`
- `roon_play_media`
- `roon_start_radio`
- `roon_add_media_to_queue`

Future phases still need resource-bound tokens, enforced scopes, revocation/refresh support and per-user authorization before broader app distribution.
