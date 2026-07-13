# Widget v12 Validation

Status: local implementation, browser validation and automated validation complete;
deployment validation pending.

## Contract

- Resources use the cache-busted `ui://roon-ai-bridge/v12/` namespace.
- `roon_ui_navigate` remains app-only for non-mutating exploration.
- `roon_ui_action` is app-only and maps every user click to an existing
  canonical intent permission before delegating to `IntentGateway`.
- Action results contain the operation status, verification flag, warnings and
  a fresh player snapshot in one MCP response.
- MCP Apps `tools/call`, `ui/notifications/tool-input` and
  `ui/notifications/tool-result` are supported alongside ChatGPT
  `window.openai` compatibility globals.

## Interaction and rendering

- The visual system reuses the portal colors, square controls, typography,
  borders and inline RoonIA vector logo.
- Buttons show local busy state and never replace the full widget with a
  loader.
- Playback time advances locally every 250 ms and is reconciled silently with
  Roon every six seconds while visible.
- Silent player updates patch artwork, text, controls, queue and progress
  without remounting the document or resetting scroll.
- The progress control supports absolute seek through the private action tool.

## Validation commands

```powershell
pnpm run widget:preview
pnpm run test
pnpm run build
git diff --check
```

Local browser validation covered the live playback clock, pause/resume,
relative volume, search results, album drill-down and track rendering. The
complete automated suite passes 105 tests and the TypeScript build succeeds.

After deployment, refresh the ChatGPT app and start a new conversation so the
host loads the v12 resources and updated app-only tool descriptors.
