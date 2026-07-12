# Roon SDK reliability boundary

RoonIA wraps the callback-based public Roon SDK behind `src/roon/roonSdk.ts`.
The boundary defines only the Transport, Browse and Image methods used by the
application and prevents the rest of the codebase from depending on SDK
implementation details.

## Runtime guarantees

- Every request-style SDK callback has an eight-second timeout.
- Late callbacks are ignored after a request has settled.
- Timeout failures use `ROON_REQUEST_TIMEOUT` and HTTP status 504.
- Zone state is built from public `Subscribed`, `Changed` and `Unsubscribed`
  events. RoonIA does not read the SDK's private `_zones` cache.
- A callback acknowledges that Roon accepted a command; it does not by itself
  prove the final state.
- Playback, grouping, transfers, observable volume changes and zone presets
  verify their final cached state before setting `state_verified: true`.
- Commands whose outcome is not observable through the SDK return
  `state_verified: false`.

## Volume behavior

Roon outputs with `volume.type: "incremental"` only accept SDK mode `relative`
with value `-1` or `1`, as required by `node-roon-api-transport`. Grouped volume
changes are sent sequentially. If an output fails after previous outputs were
changed, the error reports `partially_applied` and `applied_output_ids`.

## Local validation

Run:

```powershell
pnpm run test
pnpm run build
```

Focused tests cover SDK timeouts and late callbacks, public zone subscription
events, queue callback loss, incremental volume validation, partial grouped
volume application, transfer verification, playback and grouping.
