# Widget v2 Local Validation

Status: implementation and automated local validation complete. Deployment,
live Roon validation and ChatGPT reconnection remain pending by design.

## Surface contract

- `roon_open_player` mounts the player resource with zones, now playing,
  grouped outputs, volume and a queue preview.
- `roon_open_media_explorer` mounts search plus artist, album and track detail.
- `roon_open_library` mounts queue, playlist index and playlist detail.
- `roon_ui_navigate` is app-only and handles internal drilldown without a model
  turn.
- Domain buttons reuse canonical MCP tools; the widget has no parallel action
  dispatcher catalog.
- Full presentation payloads are carried in result `_meta.widget`; concise
  summaries and reusable identifiers remain in `structuredContent`.

The resources are:

- `ui://roon-ai-bridge/v10/player.html`
- `ui://roon-ai-bridge/v10/media-explorer.html`
- `ui://roon-ai-bridge/v10/library.html`

They support the MCP Apps JSON-RPC bridge and ChatGPT
`window.openai.toolInput`, `toolOutput`, `toolResponseMetadata`, `callTool` and
`setWidgetState` compatibility globals. Artwork is loaded by URL rather than
embedded as base64. Player and queue polling runs every five seconds only while
the widget document is visible.

## Local visual exercise

The MCP Apps host simulator was used to verify:

- desktop player layout, transport controls, artwork, progress and queue;
- search for Radiohead, artist biography/popular tracks/albums and drilldown to
  the Kid A track list;
- playlist index, Deep Focus detail, per-track actions and zone selection;
- compact-width reflow without losing the semantic controls.

The simulator is available with:

```powershell
pnpm run widget:preview
```

## Automated checks

```powershell
pnpm run test
pnpm run build
git diff --check
```

Tests cover resource metadata and bridge compatibility, player view mapping,
artist/album exploration, playlist navigation, zone context, app-only tool
visibility and the complete MCP manifest.

## Pending live validation

After an explicit deployment request:

1. Confirm `tools/list` exposes 34 tools with the expected visibility metadata.
2. Read all three v10 resources through MCP.
3. Exercise widget actions against Despacho without increasing volume.
4. Verify final playback, queue and selected-zone state in Roon.
5. Reconnect the ChatGPT app, refresh it and start a new conversation.
6. Evaluate tool selection, internal drilldown, real-time refresh and widget
   rendering from the actual ChatGPT host.
