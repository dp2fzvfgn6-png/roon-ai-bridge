# MCP v2 Local Validation

Status: automated local validation complete; live Roon and ChatGPT validation
pending by design.

## Contract checks

- `tools/list` exposes 29 tools.
- All descriptions start with `Use this when...`.
- Every tool declares a discriminated output schema.
- No tool has `openai/outputTemplate` or another widget template.
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
2. Verify `tools/list` schemas and absence of widget templates.
3. Exercise semantic zone-name calls against Despacho.
4. Exercise search, ambiguous selection and exact playback through MCP.
5. Verify final playback, queue, volume and grouping state in Roon.
6. Build the new widgets against these contracts.
7. Reconnect ChatGPT only after widget validation.
