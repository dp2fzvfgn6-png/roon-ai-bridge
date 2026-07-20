# Widget v19 Library, Queue and Zones Validation

Widget v19 adds three focused read-only MCP Apps surfaces while preserving the
existing now-playing, media and playlist widgets. The complete render catalog
is now:

- `roon_show_now_playing`
- `roon_show_zones`
- `roon_show_queue`
- `roon_show_media`
- `roon_show_playlist`
- `roon_show_playlist_library`

All six tools publish `_meta.ui.resourceUri` plus the ChatGPT compatibility
alias `_meta["openai/outputTemplate"]` under:

```text
ui://roon-ai-bridge/v19/
```

## New view contracts

### Playlist library

`roon_show_playlist_library` returns paginated saved playlists only. Each card
contains a stable playlist ID, cover or first-track artwork fallback,
description, track count, known total duration, last playback and update time.
Temporary working playlists remain outside this library.

### Queue

`roon_show_queue` resolves an exact zone name or ID and requests one bounded
Roon queue snapshot. It returns zone context, current media, stable queue item
IDs, normalized title/artist/album, artwork and known duration. It performs no
queue or playback mutation. The shared queue service derives those normalized
fields from Roon's native `three_line`, `two_line` and `one_line` display
metadata while retaining the original fields for compatibility.

### Zones

`roon_show_zones` returns every zone ordered by playback state, including its
current media, grouped outputs, volume and mute state, playback options and the
active safe-volume limit resolved for each output. It does not control volume,
grouping or playback.

## Privacy and host behavior

Presentation payloads and embedded artwork remain in result `_meta.widget`.
Model-visible `structuredContent` contains only status, operation, summary,
view and generation time. The shared HTML listens for the MCP Apps
`ui/notifications/tool-result` bridge and ChatGPT compatibility globals. It
contains no `tools/call`, controls, forms, polling or timers.

## Automated validation

Focused tests cover:

- playlist-library pagination and cover selection;
- zone-name resolution and queue-item normalization from native Roon display
  lines;
- all-zone state counts, grouped outputs and active safe limits;
- six v19 resource URIs, metadata and read-only markup;
- six model-visible render tools and read-only credential exposure;
- private artwork hydration without Base64 in model-visible content.

Run:

```powershell
pnpm run test
pnpm run build
git diff --check
```

After an explicit deployment, refresh the ChatGPT app configuration and start
a new conversation so cached tool metadata and v18 resources are discarded.
