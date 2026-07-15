# Widget v17 Artwork Routing Validation

Widget v17 invalidates the previous ChatGPT resource cache after correcting
artwork delivery through the public MCP route.

## Behavior

- Widget artwork URLs use the public `/mcp` path so the reverse proxy sends
  image requests to the API instead of the administration portal.
- Authenticated installations keep using time-limited HMAC signatures without
  exposing the API token.
- Roon image keys and custom playlist cover IDs are carried as encoded query
  parameters.
- A playlist without a custom cover uses the first available Roon track image
  for its hero artwork.
- The former `/widget-assets/*` routes remain available for compatibility.

## Automated Validation

Run:

```powershell
pnpm run test
pnpm run build
```

Focused regression coverage is in `test/widget-assets.test.js`,
`test/widget-resource.test.js`, `test/widgets-v2.test.js` and
`test/mcp-tool-manifest.test.js`.

## Live Validation

After an explicit deployment, refresh the ChatGPT app and start a new
conversation so it loads `ui://roon-ai-bridge/v17/*`.

1. Open a playlist without a custom cover and verify its hero uses Roon art.
2. Verify several track rows show their own covers.
3. Open a playlist with a custom cover and verify that cover is shown.
4. Confirm the image requests use
   `https://roonia.ipchome.com/mcp?widget_asset=...` and return an image content
   type rather than the portal HTML.
