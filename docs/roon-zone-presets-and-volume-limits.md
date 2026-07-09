# RoonIA zone presets and volume limits

## Roon virtual zone viability

RoonIA does not create real Roon zones for presets.

The Roon JavaScript API separates two concepts:

- Roon provides services used by extensions, including Transport, which can list
  and manage existing zones, group outputs, control playback, adjust volume and
  standby.
- Extensions can provide services back to Roon, such as status, settings, volume
  control and source control.

The SDK documentation describes Transport as managing zones that already exist
in Roon, and the provided extension services as status/settings/device control.
It does not expose a supported API for an extension to create a new visible Roon
zone unless the extension participates as a real output/device integration.

Decision: presets are RoonIA entities. They may be shown as portal-only
"virtual zones", but RoonIA will not attempt to fake a Roon zone in the Roon UI.
If a future Roon API exposes a supported service or browse entry for commands,
presets can be surfaced there as commands, not as real playback zones.

Sources reviewed:

- https://github.com/RoonLabs/node-roon-api
- https://github.com/RoonLabs/node-roon-api-transport
- local installed SDK docs under `node_modules/node-roon-api-transport/docs`

## Persistence

`zone_presets` now stores the complete preset model in `config_json` while
keeping legacy columns for compatibility:

- `preset_id`
- `name`
- `description`
- `enabled`
- `config_json`
- legacy `primary_output_id`, `output_ids_json`, `volume_values_json`
- `created_at`
- `updated_at`

When a preset is created with the modern `grouping.primary_zone_ref` schema,
RoonIA also writes the legacy `primary_output_id` column. `output_id` refs are
stored directly. `zone_id` refs are resolved to the zone's first output at
creation time; if the zone is unavailable or has no outputs, RoonIA returns a
typed validation error instead of an internal SQLite error. Presets with
`grouping.enabled=false` may omit `primary_output_id`.

`volume_limits` stores configurable safe limits:

- `limit_id`
- `target_type`
- `target_value`
- `name`
- `safe_max`
- `schedule_json`
- `enabled`
- `created_at`
- `updated_at`

Initial editable limits are seeded once for Salon/Salón, Despacho and Cocina.
MCP and HTTP volume changes use the same active limit list. Internal fallback
limits, when used outside the configured service, expose the synthetic id
`__default_global__` and source `default_global`.

Volume dry-runs and responses expose the output's real volume scale with
`volume_type`, raw value, min/max/step, hard/soft limits and a normalized
percentage only when Roon reports a safe numeric scale.

`roon_list_outputs` returns known output metadata, including whether each
output is currently available, last seen time where known, volume capability,
volume type and grouping compatibility. This reflects Roon's dynamic output
visibility and avoids treating disappeared outputs as internal failures.

## HTTP endpoints

Zone presets:

- `GET /zone-presets`
- `POST /zone-presets`
- `GET /zone-presets/:preset_id`
- `PUT /zone-presets/:preset_id`
- `PATCH /zone-presets/:preset_id`
- `DELETE /zone-presets/:preset_id`
- `POST /zone-presets/:preset_id/apply`
- `POST /zone-presets/:preset_id/dry-run`

Volume limits:

- `GET /volume-limits`
- `POST /volume-limits`
- `GET /volume-limits/:limit_id`
- `PUT /volume-limits/:limit_id`
- `PATCH /volume-limits/:limit_id`
- `DELETE /volume-limits/:limit_id`
- `POST /volume-limits/evaluate`

The portal exposes the same routes under `/api`.

## MCP tools

Zone preset tools:

- `roon_create_zone_preset`
- `roon_list_zone_presets`
- `roon_get_zone_preset`
- `roon_update_zone_preset`
- `roon_delete_zone_preset`
- `roon_apply_zone_preset`

Volume limit tools:

- `roon_list_volume_limits`
- `roon_get_volume_limit`
- `roon_create_volume_limit`
- `roon_update_volume_limit`
- `roon_delete_volume_limit`
- `roon_evaluate_volume_policy`

## Examples

Evaluate a scheduled limit:

```json
{
  "target_ref": { "type": "output_name", "value": "Salón" },
  "requested_volume": 30,
  "at": "2026-07-09T23:00:00+02:00"
}
```

Apply a preset in dry-run mode:

```json
{
  "preset_id": "cena_suave",
  "dry_run": true
}
```

Applying a preset does not start playback and does not replace queues. If a
planned volume exceeds the active safe limit, RoonIA returns a confirmation
payload instead of applying it.
