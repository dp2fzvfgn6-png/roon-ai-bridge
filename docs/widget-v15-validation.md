# Widget v15 Validation

## Scope

Widget v15 replaces the interactive player shell with three minimal,
read-only presentation surfaces under `ui://roon-ai-bridge/v15/`:

- `roon_show_now_playing` shows every active playing zone, or one requested
  zone, with artwork, song, artist, album and the volume/mute state of every
  output in the group.
- `roon_show_media` shows categorized search results when no media type is
  supplied. When the request names one type, an unambiguous artist, album or
  track expands in the same call. Artist views contain popular songs, albums,
  EPs and singles; album views contain their songs.
- `roon_show_playlist` shows cover, name, description and bounded track rows
  with individual artwork.

All three use the administration portal palette and inline RoonIA logo. They
contain no buttons, forms, timers, widget state, outgoing `tools/call` messages
or `window.openai.callTool` compatibility calls. Artwork is lazy-loaded and,
when API authentication is enabled, uses short-lived signed widget asset URLs
without exposing the API token.

## Automated validation

Run:

```powershell
pnpm run test
pnpm run build
```

Focused tests verify:

- idle zones are omitted and explicit zone filtering is respected;
- every grouped output retains its individual volume and mute state;
- signed artwork URLs do not reveal credentials;
- unambiguous typed media matches expand while generic or ambiguous searches
  remain a categorized result grid;
- playlist cover, description and per-track artwork are returned;
- all three MCP resources use v15 and contain no interactive or polling code;
- the manifest exposes 30 canonical tools plus three read-only widget tools.

## Post-deployment validation

After an explicit deployment, refresh the ChatGPT app and start a new
conversation so it reloads tool metadata and the v15 resource URI. Exercise the
same MCP tools ChatGPT will call:

1. Ask `¿Qué está sonando?` and confirm all and only active zones are shown.
2. Ask `¿Qué está sonando en el Despacho?` and confirm only Despacho appears.
3. Ask for an artist and an album and confirm adaptive sections and artwork.
4. Ask for one virtual playlist and confirm its description and song artwork.

Live verification remains pending until the user explicitly requests a deploy.
