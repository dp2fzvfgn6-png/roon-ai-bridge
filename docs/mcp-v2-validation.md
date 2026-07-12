# MCP v2 Local Validation

Status: automated local validation complete; live Roon and ChatGPT validation
pending by design.

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

## Pending live validation

Do not deploy or reconnect ChatGPT in this phase. Before a future deployment:

1. Verify the deployed commit and reported version.
2. Verify `tools/list` schemas, visibility metadata and v10 widget templates.
3. Exercise semantic zone-name calls against Despacho.
4. Exercise search, ambiguous selection and exact playback through MCP.
5. Verify final playback, queue, volume and grouping state in Roon.
6. Exercise player, search, entity, queue and playlist exploration through the
   widget bridge.
7. Reconnect ChatGPT only after deployed widget validation.
