# MCP Server

The active MCP endpoint is implemented by `src/bridge-v2`. The previous
`src/mcp/mcpTools.ts` catalog is retained temporarily as disconnected legacy
code and is not registered by either Streamable HTTP or stdio.

The v2 facade is intentionally data-only. No tool advertises a widget resource
or `openai/outputTemplate`; interactive components will be built in a later
phase after the contracts are stable.

## Design rules

- One model-visible tool represents one user intent.
- Zones and outputs accept `{ id }` or `{ name }`; clients must not list state
  merely to translate a name into an ID.
- Playback and enqueue tools accept either a temporary `result_id` or a query.
  Search and target resolution happen inside the intent call.
- Ambiguous media never causes playback. The result has `status: "ambiguous"`
  and returns candidates for an explicit follow-up choice.
- Every result uses the same discriminated envelope.
- `content` contains only a concise summary. Reusable data is returned once in
  `structuredContent`.
- Destructive operations require `confirm: true`.
- No unavailable extension-management operations are advertised.

## Result envelope

```json
{
  "status": "completed",
  "operation": "roon_play_media",
  "summary": "Media start accepted in Despacho.",
  "verified": false,
  "data": {},
  "references": {},
  "warnings": []
}
```

Possible statuses are `completed`, `ambiguous`, `confirmation_required`,
`not_available` and `failed`.

## Active tools

System and transport:

- `roon_get_state`
- `roon_control_playback`
- `roon_set_volume`
- `roon_control_output`
- `roon_set_playback_options`
- `roon_set_grouping`
- `roon_transfer_playback`

Media and queue:

- `roon_search_media`
- `roon_get_media_entity`
- `roon_play_media`
- `roon_enqueue_media`
- `roon_start_radio`
- `roon_get_queue`
- `roon_play_queue_item`

Virtual playlists:

- `roon_list_playlists`
- `roon_get_playlist`
- `roon_save_playlist`
- `roon_edit_playlist_tracks`
- `roon_delete_playlist`
- `roon_play_playlist`
- `roon_analyze_playlist`
- `roon_resolve_playlist`
- `roon_export_playlist`
- `roon_import_playlist`

Configuration and operations:

- `roon_get_configuration`
- `roon_save_configuration`
- `roon_delete_configuration`
- `roon_apply_zone_preset`
- `roon_run_diagnostics`

## Running locally

```powershell
pnpm run build
pnpm run mcp
```

`POST /mcp` exposes the same catalog over Streamable HTTP. ChatGPT is currently
disconnected intentionally; reconnect and live evaluation belong to a later
phase after the widget work.
