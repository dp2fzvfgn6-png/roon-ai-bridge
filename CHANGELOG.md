# Changelog

All notable production changes are documented here. Validation evidence for
each release lives under [`docs/`](docs/README.md).

## 0.17.1 Beta - Unreleased

- Development continues on the `beta` branch from the validated v0.17.0 tag.

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
