# Architecture Refactor Plan

## Purpose

The v0.18.0 beta line will reduce the cost and risk of changing RoonIA without
changing its user-visible behavior. The work is an incremental reorganization,
not a rewrite.

The current architecture already has useful boundaries: HTTP routes, Roon
adapters, application services, the portal and the MCP v2 facade. The refactor
will preserve those boundaries while removing obsolete code and splitting the
few modules that currently carry too many responsibilities.

## Implementation Status

The first safe architecture pass is complete on the v0.18.0 beta line:

- The baseline, public-contract guards and final regression workflow are in
  place.
- The disconnected legacy MCP implementation has been removed.
- Application construction now has a typed composition root.
- Portal backend routes are split by responsibility.
- The portal mini-player is the first extracted browser feature; remaining
  feature groups stay in `app.js` until a future change needs them.
- Media contracts/search policy, playlist contracts/cover policy and MCP
  transport intentions have been extracted behind their stable facades.
- Architecture and current-state documentation describe the resulting layout.

The remaining extraction candidates below are deliberately a roadmap, not a
requirement to keep moving code. They should be taken only when a functional
change benefits from the boundary and can prove behavior with focused tests.

## Invariants

Every phase must preserve these external contracts unless a separate feature
change explicitly says otherwise:

- The HTTP paths, request bodies, response bodies and homogeneous error format.
- The portal's behavior, authentication model and visual design.
- The MCP tool names, descriptions, schemas, annotations, result envelopes and
  widget resource URIs.
- Roon command safety, final-state verification and media ambiguity handling.
- The SQLite schema, stored playlist identity and existing user data.
- The main process model: API, portal and MCP share one Roon client and the same
  application services.
- The current deployment and update workflow.

No phase implies permission to deploy, commit, push or change the LXC. Those
actions remain separate and explicit.

## Initial Pressure Points

These were the conditions recorded before implementation; the status section
above identifies which boundaries were addressed in this beta.

- `src/mcp` contains a disconnected legacy facade alongside the active
  `src/bridge-v2` implementation. Only a diagnostics context type and one
  legacy safety-test helper still depend on it.
- `src/index.ts` manually assembles a large context and injects the diagnostics
  service through an `any` cast after construction.
- `src/portal/server.ts` owns authentication, dashboard, history, connection,
  system, access-management and Roon proxy endpoints in one file.
- `portal/app.js` holds shared state and more than 200 functions. Its existing
  function groups already define useful feature boundaries.
- `RoonMediaService` combines media contracts, normalization, scoring, browse
  navigation, temporary references, entity reading and Roon actions.
- `PlaylistService` combines playlist contracts, SQLite access, lifecycle,
  metadata, identity, cover processing, resolution and playback.
- `IntentGateway` exposes a good facade but implements transport, media,
  playlist, configuration and diagnostics orchestration in one class.
- Some current architecture documents still describe implemented components as
  future work or retain v0.9-era status text.

## Delivery Strategy

Each phase keeps the existing public facade in place while moving one bounded
responsibility behind it. Imports are updated only after the extracted module
has focused tests. The complete test suite and TypeScript build must pass at
the end of every phase.

### Phase 0: Baseline and Contract Guards

1. Run the complete test suite and build on the clean v0.18.0 beta baseline.
2. Record the active MCP manifest and make its contract assertions explicit.
3. Confirm the portal endpoint inventory and the static source tests that need
   to follow files when the frontend is split.
4. Record the current Git status, diff checks and generated-file behavior.

Acceptance:

- `pnpm run test` and `pnpm run build` pass before structural edits begin.
- The MCP contract and portal route inventory have automated guards.

### Phase 1: Remove the Legacy MCP Boundary

1. Replace the diagnostics dependency on `McpContext` with a delivery-neutral,
   narrow manifest context.
2. Move the active stdio entry point beside `src/bridge-v2/mcp` and update the
   package script.
3. Port the remaining legacy MCP safety assertion to the active v2 tool layer.
4. Delete the disconnected legacy server, tool catalog, widget resource,
   context and completed TODO marker.
5. Update architecture, MCP and SDK inventory documentation.

Acceptance:

- HTTP and stdio expose the same active MCP manifest as before.
- No runtime or test import references the removed catalog.
- The complete safety and MCP tests pass.

### Phase 2: Application Composition and Contexts

1. Introduce a typed application composition module that constructs shared
   services in dependency order.
2. Define focused context contracts for HTTP, portal, MCP and diagnostics from
   the shared application services.
3. Remove the diagnostics `any` injection and avoid optional dependencies when
   the running application always requires them.
4. Keep `src/index.ts` limited to configuration, process startup and listeners.

Acceptance:

- No cyclic service construction and no post-construction context mutation.
- API, portal and MCP still receive the same service instances.
- Existing test contexts remain easy to construct with narrow dependencies.

### Phase 3: Portal Server Modules

Keep `createPortalServer` as the public facade and extract routers for:

- health, session and authentication;
- dashboard and user activity history;
- connections and OAuth administration;
- users, API keys and MCP tool access;
- system preferences, updates and restart requests;
- zone presets and output-volume administration;
- mounting the shared Roon and playlist routers.

Acceptance:

- The endpoint inventory, authorization order, security headers and response
  shapes are unchanged.
- Portal server tests are split by router instead of growing one fixture.

### Phase 4: Portal Frontend Modules

Use browser-native modules and keep the portal build-free. Extract features in
small steps:

- shared DOM, API, state, formatting, modal and notification utilities;
- session, authentication and navigation;
- home and listening/search history;
- search, media entities and Roon library browsing;
- playlists and playlist-track editing;
- zones, queues, grouping and the persistent mini player;
- connections, users, API keys and tool access;
- system preferences, diagnostics and updates.

Styles may be split by the same feature boundaries after JavaScript behavior is
stable. No framework migration is part of this plan.

Acceptance:

- Portal interaction tests target behavior or the owning module rather than
  assuming every function lives in `portal/app.js`.
- The preview server, CSP, cache busting and static Docker copy continue to
  work without a frontend build step.
- The portal layout and interactions are visually checked at desktop and
  narrow widths.

### Phase 5: Media Boundary

Keep `RoonMediaService` as the compatibility facade while extracting:

- media contracts and reference types;
- Roon item normalization and metadata inference;
- relevance, recording-version and source-quality scoring;
- temporary reference storage and expiry;
- browse-session navigation and entity readers;
- Roon media action execution.

Acceptance:

- Search ordering, ambiguity decisions and public result identifiers are
  unchanged for the existing fixtures.
- Artist, album, playlist, library and action tests pass independently.
- Pure normalization and scoring logic no longer requires a Roon client.

### Phase 6: Playlist Boundary

Keep `PlaylistService` as the compatibility facade while extracting:

- playlist and track contracts;
- metadata and identity normalization;
- SQLite playlist/track repository operations;
- temporary-playlist lifecycle;
- custom-cover storage and verification;
- analysis, import/export and ordering policies;
- Roon resolution and playlist playback orchestration.

Acceptance:

- The database schema and persisted JSON/SQLite compatibility remain intact.
- Existing playlist IDs, track IDs, ordering, covers and resolution metadata
  survive round trips unchanged.
- Repository tests can run without Roon and playback tests can use a narrow
  playlist repository interface.

### Phase 7: MCP v2 Intent Modules

Keep `IntentGateway` as the stable facade and delegate to focused handlers for:

- state and transport;
- media and queue;
- saved and temporary playlists;
- configuration and zone presets;
- diagnostics and import/export operations.

Acceptance:

- Tool registration and all model-visible contracts remain byte-for-byte or
  semantically equivalent where generated ordering is not significant.
- One user intent remains represented by one model-visible tool.

### Phase 8: Documentation and Final Validation

1. Update the architecture and overview documents to describe the resulting
   layout and dependency direction.
2. Separate current operational documentation from historical release
   validation records without deleting release evidence.
3. Run the complete tests, build, diff checks and status review.
4. Produce a v0.18.0 architecture validation document.

## Change Discipline

- Structural and functional changes must not share a commit.
- Extract pure functions before moving stateful orchestration.
- Preserve a facade when moving a widely imported class or module.
- Add focused tests before deleting the old implementation path.
- Stop and reassess if a phase requires an API, MCP, database or portal contract
  change; that is feature work and needs its own decision.
- Do not run two refactor phases concurrently when they edit the same facade.

## Recommended First Implementation Slice

Begin with Phase 0 and Phase 1. They have the smallest user-visible risk,
remove approximately three thousand lines of inactive code and clarify which
MCP boundary the rest of the application must depend on. Application
composition should follow before portal or core modules are moved.
