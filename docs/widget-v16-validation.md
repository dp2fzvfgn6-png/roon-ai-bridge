# Widget v16 Search And Discography Validation

Widget v16 invalidates the previous ChatGPT resource cache after changing the
media-search and artist-detail contracts.

## Behavior

- `artists` and `links.artists` preserve separately navigable collaborators
  when Roon supplies structured credits or a safely separable credit line.
- artist detail reads Roon discography sections and rejects mere substring
  matches such as `Gabriella Quevedo` for the artist `Quevedo`.
- albums, EPs and singles are returned separately; a mixed Single/EP section
  uses explicit metadata first, then exact MusicBrainz type/year metadata, and
  track count only as a deterministic fallback.
- album detail follows counted track-list and disc levels and loads every page
  up to the requested limit; streaming `action_list` results use Roon's shared
  cover and artist fingerprint to recover the full ordered Tracks category.
- missing artwork uses a neutral media-type icon.
- the best-result presentation is compact instead of spanning the full widget.

## Automated Validation

Run:

```powershell
pnpm run test
pnpm run build
```

The focused regression coverage is in `test/media-classification.test.js`,
`test/media-search.test.js`, `test/widget-resource.test.js` and
`test/widgets-v2.test.js`.

## Live Validation

After an explicit deployment, refresh the ChatGPT app and start a new
conversation so it loads `ui://roon-ai-bridge/v16/*`. Check an artist with
collaborations, an artist with a homonymous surname, a multi-track album and a
mixed Singles/EPs discography through the same MCP media tool ChatGPT calls.
