# MCP v2 Local Validation

Status: deployed Roon/MCP validation complete for v0.17.0; the v0.17.1
playlist additions below have automated local validation only.

## Contract checks

- `tools/list` exposes 34 tools: 31 canonical intents and three model-visible
  widget entry points.
- All descriptions start with `Use this when...`.
- Every tool declares a discriminated output schema.
- Only the three widget entry points advertise an `openai/outputTemplate`.
- Legacy names such as `roon_status`, `roon_list_zones`,
  `roon_play_by_query` and widget action tools are absent.
- Zone and output inputs accept semantic names or stable IDs.

## Behavior checks

- Accent-insensitive exact zone-name resolution is covered.
- Query-to-play performs one internal search followed by one action.
- Ambiguous search returns candidates and performs no playback.
- Playlist creation and batch additions resolve text entries before returning.
- A playable search `result_id` is materialized as an exact manual playlist
  association instead of being stored as text only.
- Selected playlist tracks and full playlists can be re-resolved, and an exact
  `result_id` can repair one incorrect track association.
- Generated playlist covers first use `roon_prepare_playlist_cover` to resolve
  playlist context and image requirements before generation.
- `roon_set_playlist_cover` accepts ChatGPT-authorized file references through
  `_meta["openai/fileParams"]`, with legacy Base64 retained for compatibility.
- Custom JPEG, PNG and WebP covers smaller than 768×768 are rejected; accepted
  images are normalized to a verified 1024×1024 square WebP no larger than
  750 KB.
- Existing HTTP, OAuth, portal, playlist, media, safety, grouping and transfer
  regression tests continue to pass.

## Commands

```powershell
pnpm run test
pnpm run build
git diff --check
```

## Deployed validation

On 2026-07-13, the v0.17.0 deployment reported 34 tools with the expected
schemas, descriptions, visibility and v11 templates. Real MCP calls resolved
Despacho by name, searched `Max Cooper Repetition`, inspected its queue and
opened the player widget. No playback, queue, grouping or volume mutation was
required. See [v0.17.0 Validation](v0.17.0-validation.md) for full evidence.

ChatGPT must still be refreshed and opened in a new conversation to discard
previously cached tool metadata and widget resources.
