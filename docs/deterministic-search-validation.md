# Deterministic media search validation

## Scope

This change aligns the HTTP portal, MCP search tool and compact media widget around one search contract:

- `best_match` contains Roon's preferred entity when it can be identified.
- `groups` separates artists, albums, EPs, mixed single/EP sections, singles, tracks and playlists.
- `results` remains available for backwards-compatible consumers.
- artist candidates are not removed when Roon reports `0 Albums`.
- artist and album metadata is exposed as navigable entity links.

No package version is changed by this work. The widget resource URI is moved to `ui://roon-ai-bridge/v16/*` because its rendered search and artist-detail behavior changed.

## Ranking contract

The Roon Browse search root is treated as the primary relevance/popularity signal. A root result is correlated with typed category candidates by normalized title, artist/subtitle and artwork. When several typed candidates represent that same direct result, the deterministic entity order is:

1. artist
2. album
3. EP
4. mixed single/EP
5. single
6. track
7. playlist

The entity order only resolves equivalent direct matches. It does not force an unrelated exact-title album above a track that Roon identified by artist and artwork. Without a root direct match, scoring is entity-neutral and Roon's native category order breaks ties. This native order is also the available popularity proxy for duplicate song titles; Browse does not expose a numeric popularity value.

Release classification uses explicit Roon metadata first, then the Roon discography section and finally title/subtitle inference. An explicit `Single` or `EP` title refines the otherwise mixed `Singles / EPs` section. An unknown release in the Albums category remains an album instead of being guessed from track count.

## Automated acceptance cases

- `Bad Bunny` selects the artist, including when its subtitle reports zero albums.
- `El Baifo` selects Quevedo's album above its same-title track.
- `La Mudanza` selects Bad Bunny's track above unrelated same-title songs and releases.
- equivalent artist/album/track candidates are not artificially boosted because they are tracks.
- explicit Album/EP/Single metadata wins over text heuristics.

## Post-deployment validation

After an explicit deployment, refresh the ChatGPT app and start a new conversation so it loads the v16 widget and changed tool metadata. Then validate through both `/api/roon/media/search` and `roon_search_media`:

1. Run the three acceptance queries above and inspect `best_match`, `groups` and the displayed order.
2. Open artist and album names from search rows, track lists and entity details.
3. Open an artist with albums, EPs and singles and compare section classification with Roon.
   Confirm each release shows artist, year and type, and that sections with more
   than 12 releases expose `Mostrar más` without truncating the service result.
4. Search a duplicate song title and confirm the same candidate Roon places at the search root is selected.
5. Open `EL BAIFO` and confirm its complete ordered track list is recovered even when Roon exposes the album result as an `action_list`.
6. Verify playback only after selecting the returned `result_id`; no automatic audible test is required for search validation.

Live classification can vary with the Roon Core catalog and streaming services. Any mismatch should be captured with the root Browse items and typed category items so the fingerprint rules can be refined without introducing query-specific exceptions.
