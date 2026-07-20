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
- Playlist detail uses one title beside the artwork and shows total duration beside
  the track count. Partial duration totals are labelled as `al menos`.
- Playlist and track playback menus expose play now, insert at the start of the
  pending queue, and append to the end without opening another dialog.
- Playlist rows expose album and duration. Clicking the track identity opens a child
  detail view with artwork and catalog metadata while preserving the playlist below.
- Resolution states and stored binding metadata are hidden in normal use. They are
  rendered only in the track detail when portal debug mode is enabled.
- Playlist editing and track details are child dialogs: closing or cancelling them
  returns to the originating playlist. Track order can be changed in an explicit
  drag-and-drop mode and is persisted only after `Guardar orden`.

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
7. Open a playlist and confirm its name appears once, its duration accompanies the
   song count, and every row shows album and duration without resolution statuses.
8. Open the playlist and track playback arrows and confirm the three queue actions
   appear as anchored menus over the playlist dialog.
9. Open a song detail, return to the playlist, then open and cancel playlist editing.
   Confirm both child views return to the same playlist.
10. Enter `Reordenar`, drag at least two songs, save, reopen the playlist, and confirm
    the persisted order. Cancel a second reorder and confirm it leaves the order
    unchanged.
11. Compare normal and debug mode song details. Technical identity, resolution and
    Roon binding payloads must appear only in debug mode.
