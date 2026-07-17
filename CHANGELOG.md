# Changelog

All notable production changes are documented here. Validation evidence for
each release lives under [`docs/`](docs/README.md).

## 0.18.0 Beta - Unreleased

- Added temporary working playlists for activity, mood and occasion requests.
  They use the same strict batched recording preflight as saved playlists, stay
  out of normal playlist listings and can replace or extend the Roon queue.
- Added explicit MCP intents to create, inspect and promote temporary playlists.
  Promotion preserves the playlist ID, verified tracks, ordering and artwork.
- Added per-playlist expiration with automatic database and custom-cover
  cleanup. New temporary playlists use the configurable 1-365 day lifetime;
  changing it does not rewrite existing expiration dates.
- Added the expiration setting under Portal > Ajustes > Sistema and a dedicated
  temporary-playlist manager under Música > Playlists that is visible only
  while Modo Debug is enabled.
- Added ordered, paginated track reads for playlists selected from the native
  Roon catalog, allowing a model to compare them with saved RoonIA playlists.

## 0.17.3 Beta - Unreleased

- Development continues on the `beta` branch from the v0.17.2 stable release.

## 0.17.2 - 2026-07-17

- Promoted the validated v0.17.2 beta line to the stable `main` channel.
- Refined automatic playlist collages to rotate every two seconds at random
  positions, changing one tile in 2x2 and 3x3 layouts and two tiles in 4x4
  layouts without fade or zoom transitions. Distinct artwork is sampled and
  kept unique within the visible grid whenever the playlist provides enough
  different covers.
- Reordered playlist card details to show the track count and last playback
  immediately after the title, followed by a naturally sized description.
- Added total playlist duration in hours and minutes to portal cards, marking
  partial totals when one or more tracks have no known duration.
- Replaced stacked portal toasts and stale update text in the header with one
  concise three-second action notification whose newest message takes priority.
- Added contextual feedback for playback, volume, grouping, queue, playlist,
  access and administration actions.
- Simplified the header version to omit the build and identify beta installs as
  `vX.Y.Z (beta)`.
- Reorganized System settings with a compact update block, conditional update
  availability, clearer live status labels and a separate service restart
  panel.
- Added a guided beta-exit flow: install the latest stable release immediately
  or retain the installed beta without receiving newer betas until `main`
  reaches the same version, then switch automatically to stable.
- Added configurable daily update checks, persisted version-check results and
  a permanent available-update notice in the header and System settings.
- Added a persistent Modo Debug in a separate diagnostics panel. It reveals
  technical System details, advanced OAuth diagnostics and the Registros tab
  without changing the service log level.
- Rebuilt model-created playlists as a batched preflight: title and artist are
  mandatory, confident album/year data act as identity hints, ambiguous or
  missing recordings are never persisted, reserves and two replenishment
  rounds can fill the requested size, and any final shortfall is reported.
- Playlist creation now deduplicates recordings, rejects unintended live,
  remix, cover and alternate versions, avoids adjacent tracks by the same
  artist and stores the complete available Roon observation separately from
  model-supplied metadata.
- Playlist playback now reconstructs fresh Roon references with the original
  successful title-and-artist query when enriched secondary credits or release
  context make the canonical metadata query too restrictive.
- Rebuilt manual media search so typed Roon categories run in independent
  sessions concurrently, while the portal renders each category as soon as it
  arrives and cancels stale searches.
- Replaced search skeleton rectangles with per-section activity indicators,
  restored the direct Roon `Mejor resultado`, and added silent background
  hydration with 12-item progressive `Ver más` expansion up to 100 results per
  category.
- Artist and album details now prefer exact native-library identities through
  a cached ordinal index, label their provenance and completeness, and retain
  the selected search session when a streaming result must be opened.
- Exact catalog references now take precedence while valid, preserving Roon's
  classified artist discography and complete streaming album contents even
  when individual track rows omit number or duration metadata.
- Manual result sections now keep Roon's own order rather than promoting local
  exact-title namesakes. `Mejor resultado` requires corroborating identity
  evidence, so Disclosure resolves to Roon's artist instead of an unrelated
  same-title album.
- Artist and album search results now traverse Roon `action_list` menus through
  safe entity-navigation actions before reading content. Artist fichas retain
  Roon's section labels and order, and streaming album fichas load their real
  ordered tracklists when exposed by Browse.
- Artist discographies now follow native `View All` continuations instead of
  stopping at Roon's preview shelf. Catalog releases are reopened with their
  exact album-and-artist identity so albums outside the local library retain
  access to their ordered streaming tracklists.
- Expired catalog detail sessions now retry through a fresh Roon search before
  considering a verified local-library fallback, preserving the complete
  streaming discography on repeated artist and album opens.
- Album detail recognizes counted English and Spanish track sections such as
  `3 Tracks` and `3 pistas`, and no longer presents long linked artist-credit
  lists as editorial descriptions.
- Artist detail now recovers streaming releases from Roon's Albums search when
  the artist object exposes only the local `0/1 Albums` count. Raw Roon-linked
  artist IDs are retained for exact attribution, homonyms are excluded and
  secondary-credit releases are separated as appearances.
- Catalog album detail follows bounded, identity-matched repeated list wrappers
  before reading tracks, matching the native Browse path used by releases such
  as `Caracal (Deluxe)` and `The Complete Animals`.
- Removed name-only discography fabrication and synthetic album ordering:
  unverified global matches are omitted or displayed separately as related
  results, actions are excluded from tracklists and track numbers are parsed
  only from Roon's structured data or native list prefixes.
- Search ambiguity now blocks recommendation for indistinguishable exact
  candidates, and artist-credit parsing preserves slash band names such as
  AC/DC.

## 0.17.1 - 2026-07-16

- Rebuilt the embedded widgets through `ui://roon-ai-bridge/v17/` with the
  portal visual system, app-only verified actions, stable state reconciliation
  and signed artwork delivery through the public MCP route.
- Added deterministic media search, richer artist discographies and complete
  multi-disc album track lists while preserving Roon's preferred result.
- Added strict playlist track resolution that prefers the intended recording,
  reports ambiguity and chooses TIDAL or the best known quality only among
  equivalent recordings.
- Added playlist artwork management, paginated widget views, recent-playback
  ordering and a clearer `Mi Música` portal experience.
- Added a locally advancing playback clock with seek support between live Roon
  snapshots.

## 0.17.0 - 2026-07-13

### Added

- Canonical MCP v2 facade with 30 intent tools, three model-visible widget
  entry points and one app-only navigation tool.
- Focused player, media explorer and library widgets under the cache-busted
  `ui://roon-ai-bridge/v11/` resource namespace.
- Portal connection management for ChatGPT OAuth and generic MCP clients.
- Artist releases, album tracks, deeper entity views and richer media search
  ranking.
- Persistent recording identity snapshots for virtual playlists, including
  fresh Roon reference reconstruction before playback.
- Standalone LXC update watcher with terminal status reporting and build-level
  update comparison.

### Changed

- Redesigned the administration portal and its active-zone playback flows.
- Replaced the broad legacy MCP catalog with one intent per model-visible
  tool; legacy MCP aliases are no longer exposed by the v2 facade.
- Improved search preference for clean studio recordings and explicit
  classification of live, remix, edit, remaster, binaural and other alternate
  versions.
- Strengthened Roon SDK normalization, state caching, grouping, transfer,
  queue, image, volume and transport behavior.
- Hardened API-key, OAuth, portal-authentication and tool-access boundaries.

### Fixed

- Prevented temporary Roon Browse identifiers from being treated as durable
  playlist identities.
- Preserved the queue when the first playlist recording cannot be resolved
  safely and unambiguously.
- Corrected portal controls and artwork loading after updates.
- Completed MCP Apps `tool-input` notification and ChatGPT `toolInput` global
  handling in the focused widgets.
- Made connection and update failures observable without exposing secrets.

### Upgrade notes

- Stable installations update from the `main` branch; beta installations use
  `beta` while beta updates are enabled.
- MCP v2 metadata and widget resources are cached by ChatGPT. After deployment,
  refresh the app and start a new conversation.
- See [release notes](docs/v0.17.0-release-notes.md) for compatibility details
  and [validation](docs/v0.17.0-validation.md) for release evidence.

## 0.16.0 - 2026-07-09

- Added operational diagnostics, action and technical logs, health/readiness
  endpoints and read-only extension inspection.

Earlier release history is recorded in the versioned validation documents in
[`docs/`](docs/README.md).
