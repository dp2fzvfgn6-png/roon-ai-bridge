# Strict track resolution validation

## Scope

Catalog discovery remains shared between the HTTP portal, widgets and MCP, but
automatic playlist association now uses `TrackResolutionService`. The resolver:

- searches only Roon track results;
- scores title, artist, album and requested recording version before source;
- avoids live, remix and cover variants unless requested;
- prefers TIDAL, then the best known audio quality, among equivalent recordings;
- preserves ambiguity when available metadata cannot prove two candidates are
  the same recording;
- reapplies the same policy when temporary Roon references are reconstructed for
  playback.

The portal keeps broad discovery ordering. Its playlist-track playback fallback
uses `streaming_first` instead of `library_first`.

## MCP result contract

`roon_save_playlist`, `roon_edit_playlist_tracks` and
`roon_resolve_playlist` return `resolution_summary`. `verified` is true only
when `resolution_summary.unresolved` is zero. A saved but incomplete playlist
returns `status: "completed"`, `verified: false` and a warning so persistence is
not confused with recording verification.

Explicit result selections keep the compatible `manual` resolution status and
add `selection_origin`. MCP v2 writes `model`; portal search-result additions
write `portal_user`.

## Automated validation

Run:

```powershell
pnpm run test
pnpm run build
```

Focused coverage verifies:

1. An equivalent TIDAL FLAC candidate wins over a local MP3.
2. A wrong artist or unintended live version cannot win because it is on TIDAL.
3. Title-only matches for different artists remain ambiguous.
4. Playlist resolution searches only the track category.
5. Playback reconstructs fresh references with the streaming-first policy.
6. MCP playlist mutations do not claim verification while tracks remain
   ambiguous, missing or failed.

## Post-deployment validation

After an explicitly requested deployment, refresh the ChatGPT app and start a
new conversation so changed tool metadata is loaded. Create a small playlist
containing studio tracks with known live, cover and local-MP3 alternatives.
Confirm through the MCP tool output that:

- every selected title and artist is correct;
- TIDAL is selected when the same recording exists both in TIDAL and locally;
- the chosen quality is reported when Roon exposes it;
- uncertain source or recording identity remains visible instead of being
  described as manually verified;
- final playback resolves the same recording policy and does not reuse stored
  temporary item keys.
