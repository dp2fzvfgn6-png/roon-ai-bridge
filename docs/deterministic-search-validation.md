# Deterministic media search validation

## Scope

This change aligns the HTTP portal, MCP search tool and compact media widget around one search contract:

- `best_match` contains Roon's preferred entity when it can be identified.
- `groups` separates artists, albums, EPs, mixed single/EP sections, singles, tracks and playlists.
- `results` remains available for backwards-compatible consumers.
- artist candidates are not removed when Roon reports `0 Albums`.
- artist and album metadata is exposed as navigable entity links.
- typed categories use independent Roon sessions and can execute concurrently.
- `selection_required`, rather than `ambiguous` alone, is the authority for
  deciding whether a result may be selected automatically.

No package version is changed by this work. The widget resource URI is moved to `ui://roon-ai-bridge/v16/*` because its rendered search and artist-detail behavior changed.

## Ranking contract

The Roon Browse search root is treated as a relevance signal. A root result is
correlated with typed category candidates by normalized title,
artist/subtitle and artwork. When several typed candidates represent that same
direct result, the deterministic entity order is:

1. artist
2. album
3. EP
4. mixed single/EP
5. single
6. track
7. playlist

The entity order only resolves equivalent entities. Two same-type exact
candidates with the same visible identity remain selection-required even when
one appears as a direct root result. Without a root direct match, scoring is
entity-neutral and Roon's native category order breaks non-close ties. Browse
does not expose a numeric popularity value.

Release classification uses explicit Roon metadata first, then the Roon discography section and finally title/subtitle inference. An explicit `Single` or `EP` title refines the otherwise mixed `Singles / EPs` section. An unknown release in the Albums category remains an album instead of being guessed from track count.

## Automated acceptance cases

- `Bad Bunny` selects the artist, including when its subtitle reports zero albums.
- `El Baifo` selects Quevedo's album above its same-title track.
- `La Mudanza` selects Bad Bunny's track above unrelated same-title songs and releases.
- equivalent artist/album/track candidates are not artificially boosted because they are tracks.
- explicit Album/EP/Single metadata wins over text heuristics.
- independent typed sessions overlap instead of serializing their latency.
- duplicate exact recordings never receive an automatic recommendation.
- `AC/DC` remains one artist credit while a spaced `/` can separate credits.

## Detail trust contract

- Search references retain the original Roon session and item identity for
  their TTL. A session is consumed by at most one traversal; later operations
  resolve a fresh, fingerprint-checked candidate.
- Album and artist details first reopen the exact retained search reference
  when it is still valid, preserving the selected streaming-catalog entity and
  its Roon action tree. Cached `albums` and `artists` root indexes are the
  verified fallback. Their item keys are never reused because they are
  session-local; only normalized identity and absolute ordinal are cached for
  ten minutes. A fresh session loads that ordinal and verifies title, artist
  and artwork before opening it. Index drift triggers one refresh and retry.
- Native library details report `data_origin=roon_library`; streaming search
  traversal reports `roon_search_session`. `completeness`, `ordered` and
  `identity_verified` make uncertainty explicit.
- A tracklist contains only rows inside a verified album contents or Tracks
  list. Playback actions and album entities are excluded. Native `1. Title`
  and `1-2 Title` prefixes are parsed and removed from the visible title, but
  streaming rows do not require numbers or durations when the enclosing Roon
  list already establishes their album context.
- A global track search can populate `related_tracks`, but it cannot populate
  the ordered `tracks` collection or synthesize track numbers.
- A global artist-name album search is never promoted to a discography. If
  Roon exposes no verified releases, the response is intentionally partial.

## Portal latency contract

The manual portal starts artist (6), album (6), track (12) and playlist (6)
requests together. Each section has its own circular loading and failure state,
stale requests are aborted and late responses from an older generation are
ignored. Once those first rows are visible, categories with more results are
hydrated silently up to 100 entries. `available_counts` reports Roon's list
size and each `Ver más` action reveals at most 12 additional entries, which is
two desktop rows for six-column card sections.

The portal reconstructs one global “Mejor resultado” from the direct,
non-ambiguous recommendation returned by each typed Roon search. This does not
add a fifth search request. The block remains hidden when no category supplies
a safe direct match. Search editions are deduplicated conservatively with
source, year, version and artwork in the identity.

The visible category groups preserve Roon's own ordinal order. Local match
scores remain available to strict playback and playlist consumers through the
flat `results` collection, but they never reorder the artist, release or track
sections displayed by the portal. A title-only namesake cannot claim Roon's
best-result identity: artwork, artist credit or explicit entity type must also
corroborate it.

Search entities marked `action_list` are action menus, not detail pages. Artist
and album fichas follow only recognized non-mutating entity-navigation actions
before reading discography or track content. Roon discography section labels
and order are retained in `release_sections`; nested sections and flat header
layouts are both supported.

## Post-deployment validation

After an explicit deployment, refresh the ChatGPT app and start a new conversation so it loads the v16 widget and changed tool metadata. Then validate through both `/api/roon/media/search` and `roon_search_media`:

1. Run the three acceptance queries above and inspect `best_match`, `groups` and the displayed order.
2. Open artist and album names from search rows, track lists and entity details.
3. Open an artist with albums, EPs and singles and compare the provenance label
   and every release with Roon. A missing verified section must remain empty.
4. Search a duplicate song title and confirm close exact candidates require a
   selection instead of receiving a recommendation.
5. Open one local-library album and confirm its ordered native list. Then open
   a streaming album whose action tree has no verified tracklist and confirm
   search matches appear only under `Resultados relacionados`, without
   invented numbers.
6. Verify playback only after selecting the returned `result_id`; no automatic audible test is required for search validation.

Live classification can vary with the Roon Core catalog and streaming services. Any mismatch should be captured with the root Browse items and typed category items so the fingerprint rules can be refined without introducing query-specific exceptions.
