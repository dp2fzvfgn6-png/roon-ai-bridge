# MCP v2 Architecture

## Purpose

MCP v2 replaces the previous 89-tool facade with 30 canonical intent tools and
three focused read-only widget entry points. It is a
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
- `widgets/tools.ts` owns three model-visible read-only display entry points.
- `widgets/resources.ts` owns the cache-busted MCP Apps HTML resources.

The widget layer contains no mutations, controls or polling. `roon_show_now_playing`,
`roon_show_media` and `roon_show_playlist` each produce one bounded view model.
Full presentation payloads live in result `_meta`; model-visible
`structuredContent` stays concise.

### Search and resolution boundary

Roon Browse access and media normalization remain shared, but discovery and
automatic association use different application policies:

```text
RoonMediaService (catalog and temporary references)
  -> discovery search (HTTP portal, widgets and roon_search_media)
  -> TrackResolutionService (playlist association and playback reconstruction)
```

Discovery search preserves broad categorized results for a person or model to
inspect. `TrackResolutionService` requests tracks only, requires a sufficiently
strong title/artist/version identity, and treats source and quality as a second
selection stage. It may prefer TIDAL over a local copy only when the candidates
represent the same recording; a higher-quality cover, live version or wrong
artist can never outrank the correct recording.

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
keeping playlist deletion in a separate destructive tool. Its operation
schemas are explicit so the model does not need to infer field names.

Creation, addition, replacement and identity-changing updates resolve stored
text against Roon before returning. A playable `result_id` from
`roon_search_media` is preferred because it records the exact selected track;
an update with `changes.result_id` repairs one incorrect association manually.
`roon_resolve_playlist` can retry unresolved entries, selected `track_ids` or
the complete playlist. Playlist mutations include `resolution_summary` and are
only returned with `verified: true` when every track is resolved or explicitly
selected. Explicit model selections record `selection_origin: "model"`; the
legacy `manual` status alone must not be described as human verification.
`roon_set_playlist_cover` accepts a supplied or generated
JPEG, PNG or WebP image and normalizes it to a square, metadata-free WebP of at
most 768×768 and 750 KB before storing it. Its model-facing description asks
image generation to start from a 768×768 square sRGB WebP, keep important
content centered and target less than 750 KB.

### Lightweight visual responses

`roon_show_now_playing` renders only active playing zones and can resolve an
optional named zone in the same call. Grouped zones expose every output and its
individual volume. `roon_show_media` returns categorized results for a generic
query and expands an unambiguous artist, album or track in one call when one
explicit type is supplied. `roon_show_playlist` resolves an exact name or ID
and returns cover, description and bounded song rows. The iframe only hydrates
the returned data and never calls another tool.

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
