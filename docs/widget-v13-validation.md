# Widget v13 Validation

Status: local implementation and automated validation complete; deployment and
live ChatGPT validation remain pending.

## Fixes covered

- Resources use the cache-busted `ui://roon-ai-bridge/v13/` namespace.
- Widget navigation and actions call the standard MCP Apps `tools/call` bridge
  first, with `window.openai.callTool` retained only as a compatibility fallback.
- Both app-only tools advertise widget accessibility to ChatGPT.
- Artwork uses short-lived HMAC-signed URLs so an iframe image request can load
  without exposing the OAuth bearer token or making the authenticated image API
  public.
- Playback time advances locally every 250 ms and the visible player reconciles
  its state with Roon every six seconds without remounting the document.
- User-facing now-playing requests are routed to `roon_open_player`; the generic
  state tool is reserved for programmatic state and diagnostics.

## Validation commands

```powershell
pnpm run test
pnpm run build
git diff --check
```

The complete suite passes 110 tests and the TypeScript build succeeds. Coverage
includes signature tampering and expiry, a real HTTP artwork request without a
Bearer header, resource metadata and both app-only tool descriptors.

## Required live validation

After deployment, refresh the ChatGPT app and start a new conversation so the
host reloads the v13 resource URI and updated tool metadata. In Despacho:

1. Ask `¿Qué está sonando?` and confirm the player appears immediately.
2. Confirm main and queue artwork load.
3. Observe the elapsed time for at least ten seconds.
4. Pause and resume, then verify the audible and visual state.
5. Exercise previous/next only when doing so will not disrupt a wanted queue.
6. Change volume by one step without increasing it beyond the starting level.
7. Open the queue and perform one search to validate app-only navigation.
