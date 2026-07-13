# MCP v2 Architecture

## Purpose

MCP v2 replaces the previous 89-tool facade with 30 canonical intent tools,
three focused widget entry points and two app-only interaction tools. It is a
breaking contract with no legacy aliases. The HTTP API, portal and persisted
user data remain outside this replacement.

## Layers

```text
MCP protocol
  -> tool registry, widget resources and uniform result mapper
Application intentions
  -> semantic target and media resolution
Roon and persistence adapters
  -> native Roon transport/browse and SQLite data
```

The implementation lives in `src/bridge-v2`:

- `contracts.ts` defines target/media references and the result envelope.
- `targetResolver.ts` resolves exact accent-insensitive zone/output names or IDs.
- `intentGateway.ts` implements complete user intentions.
- `mcp/tools.ts` owns schemas, annotations and the 30-tool intent catalog.
- `mcp/server.ts` owns server instructions and HTTP/stdio construction.
- `widgets/viewService.ts` creates bounded, presentation-ready view models.
- `widgets/tools.ts` owns three model entry points plus app-only navigation and actions.
- `widgets/resources.ts` owns the cache-busted MCP Apps HTML resources.

The widget layer does not duplicate domain mutations. `roon_ui_action` maps a
user click to the canonical intent gateway and returns verified state in the
same call, while `roon_ui_navigate` handles read-only in-widget drilldown.
Full view payloads live in result `_meta`; model-visible `structuredContent`
stays concise.

## Efficient flows

### Direct transport

`roon_control_playback({ zone: { name: "Despacho" }, action: "pause" })`
resolves the name and performs the command in one call.

### Query and play

`roon_play_media` accepts a query, performs typed search internally and acts
only when the search has one recommended result that does not require
selection. Otherwise it returns candidates with `status: "ambiguous"` and
does not mutate Roon.

### Deep exploration

`roon_search_media` returns temporary references. `roon_get_media_entity`
uses the selected reference to retrieve artist releases/popular tracks or an
album track list through Roon Browse.

### Batch playlist editing

`roon_edit_playlist_tracks` accepts an ordered batch of add, update, remove,
reorder or replace operations. This avoids one MCP round trip per track while
keeping playlist deletion in a separate destructive tool.

### Interactive exploration

`roon_open_media_explorer` mounts search results. Selecting an artist, album or
track calls app-only `roon_ui_navigate`, so exploration does not require a new
model/tool round trip. Playback and queue buttons call `roon_ui_action`, whose
handler delegates to the same intent gateway used by model-visible tools.
Player and queue reconciliation runs only while the document is visible; the
player clock progresses locally between silent reconciliations.

## Result semantics

`status` describes protocol outcome; `verified` separately describes whether
the final external state was observed. `completed` therefore never implies
verification by itself. Errors are returned in the same envelope with
`status: "failed"` and `isError: true` at MCP level.

`structuredContent` contains the envelope once. Text content is a short human
summary and never repeats the full JSON payload.

## Compatibility boundary

The old `src/mcp/server.ts`, `mcpTools.ts` and widget resource remain in the
tree only for legacy HTTP/portal dependencies and historical tests. Neither
`/mcp` nor `pnpm run mcp` instantiates the old server. They can be deleted after
a dedicated dependency audit.
