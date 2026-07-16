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

### Model-created playlist preflight

`roon_save_playlist` accepts one batch containing primary proposals and
reserves. Every proposal includes `title` and `artist_credit`; `album_hint` and
`release_year_hint` are optional evidence that the model sends only when it is
confident and the detail helps distinguish the intended recording. The first
Roon query remains title plus artist. Album is added only by the controlled
fallback, and year is used for scoring rather than copied into the query.

The preflight runs before any playlist write. It validates the title, every
required artist or performance credit, the requested recording family and a
playable Roon identity. Standard and remastered releases are equivalent for a
standard request. Live, remix, cover, dub, acoustic and other alternate
recordings require an explicit matching `recording_intent`. A model-provided
`result_id` is temporary evidence and never bypasses these checks.

Candidates are resolved with bounded concurrency. Valid reserves fill rejected
or duplicated primaries, then the final accepted set is reordered so the same
artist is not adjacent. Only accepted, fully resolved tracks are written, in a
single transaction. Each stored row separates normalized `audio_metadata`,
model hints and provenance in `user_metadata`, and the raw search/album-detail
observation in `resolution.roon_observation`.

When `desired_count` cannot be met, the tool returns `status: "needs_input"`
with a short-lived `build_id` and does not create or modify a playlist. Server
instructions tell the model to submit fresh candidates autonomously. Exactly
two replenishment rounds are accepted. If the target is still not met after
the second round, the verified shorter playlist is saved and
`build_summary.missing_count` reports the shortfall. Build sessions live in
the running process for 30 minutes; after a restart or expiration the model
must start a new preflight.

### Batch playlist editing

`roon_edit_playlist_tracks` accepts an ordered batch of add, update, remove,
reorder or replace operations. This avoids one MCP round trip per track while
keeping playlist deletion in a separate destructive tool. Its operation
schemas are explicit so the model does not need to infer field names.

Add and replace operations use the same strict preflight and complete metadata
capture as playlist creation; unresolved candidates are reported as omitted
without being written. Identity-changing updates are resolved before returning.
An update with `changes.result_id` can repair one incorrect association
manually.
`roon_resolve_playlist` can retry unresolved entries, selected `track_ids` or
the complete playlist. Playlist mutations include `resolution_summary` and are
only returned with `verified: true` when every track is resolved or explicitly
selected. Explicit model selections record `selection_origin: "model"`; the
legacy `manual` status alone must not be described as human verification.
Generated playlist artwork uses an explicit two-step MCP flow.
`roon_prepare_playlist_cover` resolves the playlist by exact ID or normalized
name and returns its description, bounded track context, generation requirements
and required next steps before image generation begins. The server instructions
require this preflight before generated artwork.

`roon_set_playlist_cover` declares `image_file` through
`_meta["openai/fileParams"]`, so ChatGPT passes an authorized `file_id` and
temporary `download_url` instead of asking the model to serialize binary data as
Base64. The bridge accepts only public HTTPS file URLs, bounds download time and
bytes, redacts the temporary URL from logs and retains inline Base64 only for
legacy clients.

JPEG, PNG and WebP sources must be at least 768×768. RoonIA rejects smaller
thumbnails rather than storing a blurry cover, corrects orientation, center
crops, strips metadata and writes a verified square WebP at 1024×1024 and no
more than 750 KB. The tool result reports the stored dimensions, format, color
space and byte count.

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
