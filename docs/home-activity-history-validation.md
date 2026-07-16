# Home activity history validation

## Scope

The home activity section is split into two responsive columns:

- Listening history shows artwork, track metadata, the Roon zone and time.
- Search history shows the complete query without artwork or a redundant type label.

Each column initially exposes five entries and loads ten more at a time without
leaving the home page.

## Persistence and retention

`home_history` remains the SQLite source of truth. Entries are retained
independently by type:

- `play`: the newest 500 track starts.
- `search`: the newest 100 portal queries.

The Roon zone subscription records a listening entry when a playing zone starts
a different track. Seek updates, pause/resume cycles and other updates for the
same track are ignored. A seek reset for a repeated track is treated as a new
listen.

## Automated coverage

The focused history tests validate independent retention, type filtering,
offset pagination, zone metadata, artwork metadata and transition de-duplication.
The portal test validates both columns, progressive loading controls and wrapped
search text. The full test suite and TypeScript build remain the release gate.
