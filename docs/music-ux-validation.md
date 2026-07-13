# Music UX validation

This document covers the portal music-library and playlist presentation change.

## Intended behavior

- The former `Explorar` tab is presented as `Mi Música`.
- The landing view uses real Roon artwork and offers direct entry points for albums,
  artists, genres, composers, Roon playlists and internet radio.
- Roon's generic `settings` hierarchy is not exposed in this consumer music view;
  bridge configuration remains under `Ajustes`.
- Deeper library levels preserve breadcrumb, back and `Mi Música` navigation.
- Playlist descriptions are clamped to four visible lines. Cards reserve the same
  description height so artwork remains aligned as a regular grid.
- Playlists can be ordered alphabetically or by their last successful `play_now`
  playback. Never-played playlists follow played playlists and use name as a stable
  secondary order.

## Data compatibility

Existing SQLite databases are migrated in place with a nullable
`virtual_playlists.last_played_at` column. Editing a playlist does not change that
value. Failed or queue-only operations do not mark the playlist as recently played.

## Local validation

Run:

```powershell
pnpm run test
pnpm run build
```

Then verify the portal at desktop and mobile widths:

1. Open `Música > Playlists` and confirm every description shows no more than four
   lines and all covers begin on aligned grid rows.
2. Switch between `Reproducidas recientemente` and `Alfabéticamente` and confirm the
   order changes without a reload.
3. Successfully play a playlist with `Reproducir`, reload, and confirm it appears
   first in recent order.
4. Open `Música > Mi Música`, enter each destination and navigate at least two levels
   deep. Confirm back and home navigation remain understandable.
5. Confirm no `Settings` or `Ajustes` entry is shown inside `Mi Música`.
6. Repeat at 390 px width and check that destination cards, shelves, library results
   and playlist controls remain usable.
