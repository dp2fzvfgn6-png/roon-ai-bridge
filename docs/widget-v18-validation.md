# Widget v18 Embedded Artwork Validation

Widget v18 removes the widget's dependency on public image routing. The public
reverse proxy serves portal HTML when query parameters are added to `/mcp`, so
v17 image requests could not reach the bridge even though their signatures and
API handler were valid.

## Behavior

- Roon artwork is loaded server-side as a compact 160x160 JPEG thumbnail.
- Repeated image keys are loaded once and reused across the widget payload.
- At most six artwork requests run concurrently.
- Custom playlist covers and Roon thumbnails are embedded as `data:` URLs only
  in tool-result `_meta.widget`, which is private to the component.
- `structuredContent` and model-visible text never contain Base64 image data.
- Failed individual images fall back to a visible media icon without failing
  the complete widget.
- Operational logs report requested, embedded and failed artwork counts.

## Automated Validation

Run:

```powershell
pnpm run test
pnpm run build
```

Focused coverage is in `test/widget-artwork.test.js`,
`test/widget-resource.test.js`, `test/widgets-v2.test.js` and
`test/mcp-tool-manifest.test.js`.

## Live Validation

After an explicit deployment, refresh the ChatGPT app and start a new
conversation so it loads `ui://roon-ai-bridge/v18/*`.

1. Show a playlist containing repeated album covers and confirm every row has
   artwork while repeated keys are deduplicated in the server log.
2. Show a playlist with a custom cover and confirm its hero artwork renders.
3. Confirm the tool result keeps Base64 data under `_meta.widget` only.
4. Confirm the widget still renders metadata and fallbacks if one Roon image
   cannot be loaded.
