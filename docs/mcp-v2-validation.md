# MCP v2 Local Validation

Status: automated and deployed Roon/MCP validation complete for v0.17.0.

## Contract checks

- `tools/list` exposes 34 tools: 30 canonical intents, three model-visible
  widget entry points and one app-only navigation tool.
- All descriptions start with `Use this when...`.
- Every tool declares a discriminated output schema.
- Only the three widget entry points advertise an `openai/outputTemplate`.
- `roon_ui_navigate` declares app-only visibility and no output template.
- Legacy names such as `roon_status`, `roon_list_zones`,
  `roon_play_by_query` and widget action tools are absent.
- Zone and output inputs accept semantic names or stable IDs.

## Behavior checks

- Accent-insensitive exact zone-name resolution is covered.
- Query-to-play performs one internal search followed by one action.
- Ambiguous search returns candidates and performs no playback.
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
