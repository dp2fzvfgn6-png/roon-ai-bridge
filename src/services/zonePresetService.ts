import crypto from "crypto";
import { AppConfig } from "../config/env";
import { createDatabase, SqliteDatabase } from "../db/database";
import { RoonClient } from "../roon/roonClient";
import { RoonOutput, RoonZone } from "../roon/roonTypes";
import { requireTransport } from "../roon/roonTransportService";
import { evaluateZoneVolumePolicy } from "../safety/volumeSafety";
import { VolumeLimitService } from "./volumeLimitService";
import { confirmationRequiredResponse } from "../safety/actionSafety";
import { ApiError } from "../utils/errors";
import { roonSdkCall, waitForRoonState } from "../roon/roonSdk";

export type PresetTargetRef = {
  type: "output_id" | "zone_id" | "output_name" | "zone_name";
  value: string;
};

export type ZonePreset = {
  preset_id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  virtual_zone: {
    enabled: boolean;
    display_name: string;
    show_in_portal: boolean;
    show_in_roon_if_supported: false;
  };
  grouping: {
    enabled: boolean;
    primary_zone_ref: PresetTargetRef | null;
    members: PresetTargetRef[];
  };
  volumes: Array<{ target_ref: PresetTargetRef; volume: number }>;
  playback: { action: "keep_current" | "pause" };
  queue: { action: "keep_current" };
  portal_metadata: Record<string, unknown>;
  primary_output_id?: string | null;
  output_ids?: string[];
  volume_values?: Record<string, number>;
  created_at: string;
  updated_at: string;
};

type PresetRow = {
  preset_id: string;
  name: string;
  description: string | null;
  enabled: number;
  config_json: string | null;
  primary_output_id: string | null;
  output_ids_json: string | null;
  volume_values_json: string | null;
  created_at: string;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function slug(value: string): string {
  const base = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || crypto.randomUUID();
}

function normalizeName(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("INVALID_ZONE_PRESET", `${field} is required`);
  }
  return value.trim();
}

function parseRef(value: unknown, field: string): PresetTargetRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError("INVALID_ZONE_PRESET", `${field} is required`);
  }
  const raw = value as Record<string, unknown>;
  const type = requiredString(raw.type, `${field}.type`) as PresetTargetRef["type"];
  if (!["output_id", "zone_id", "output_name", "zone_name"].includes(type)) {
    throw new ApiError("INVALID_ZONE_PRESET", `${field}.type is invalid`);
  }
  return { type, value: requiredString(raw.value, `${field}.value`) };
}

function callbackCall(
  invoke: (callback: (error: string | false) => void) => void,
  operation: string
): Promise<void> {
  return roonSdkCall<void>(operation, invoke);
}

function outputIds(zone: RoonZone): string[] {
  return (zone.outputs || []).map((output) => output.output_id);
}

function volumeContext(output: RoonOutput | null): Record<string, unknown> | null {
  if (!output?.volume) return null;
  return {
    volume_type: output.volume.type || null,
    raw_value: output.volume.value ?? null,
    min: output.volume.min ?? null,
    max: output.volume.max ?? null,
    step: output.volume.step ?? null,
    hard_limit: (output.volume as Record<string, unknown>).hard_limit_max ?? null,
    soft_limit: output.volume.max ?? null
  };
}

export class ZonePresetService {
  private readonly database: SqliteDatabase;

  constructor(config: AppConfig, database?: SqliteDatabase) {
    this.database = database || createDatabase(config);
  }

  list(): ZonePreset[] {
    return (this.database.db
      .prepare(
        `SELECT preset_id, name, description, enabled, config_json, primary_output_id,
                output_ids_json, volume_values_json, created_at, updated_at
         FROM zone_presets ORDER BY name ASC`
      )
      .all() as PresetRow[]).map((row) => this.mapRow(row));
  }

  get(presetId: string): ZonePreset {
    const row = this.database.db
      .prepare(
        `SELECT preset_id, name, description, enabled, config_json, primary_output_id,
                output_ids_json, volume_values_json, created_at, updated_at
         FROM zone_presets WHERE preset_id = ?`
      )
      .get(presetId) as PresetRow | undefined;
    if (!row) throw new ApiError("ZONE_PRESET_NOT_FOUND", "Zone preset not found");
    return this.mapRow(row);
  }

  create(roonClient: RoonClient, input: Record<string, unknown>): ZonePreset {
    const prepared = { ...input };
    if (
      prepared.capture_volumes !== false &&
      prepared.volume_values === undefined &&
      Array.isArray(prepared.output_ids)
    ) {
      prepared.volume_values = Object.fromEntries(
        prepared.output_ids
          .map((id) => String(id))
          .map((id) => [id, roonClient.getOutput(id)?.volume?.value])
          .filter(([, value]) => typeof value === "number")
      );
    }
    const preset = this.parseInput(prepared);
    const presetId = typeof input.preset_id === "string" && input.preset_id.trim()
      ? slug(input.preset_id)
      : slug(preset.name);
    const now = nowIso();
    const legacy = this.legacySnapshot(roonClient, preset);
    this.database.db
      .prepare(
        `INSERT INTO zone_presets (
          preset_id, name, description, enabled, config_json, primary_output_id,
          output_ids_json, volume_values_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        presetId,
        preset.name,
        preset.description,
        preset.enabled ? 1 : 0,
        JSON.stringify({ ...preset, preset_id: presetId, created_at: now, updated_at: now }),
        legacy.primary_output_id,
        JSON.stringify(legacy.output_ids),
        JSON.stringify(legacy.volume_values),
        now,
        now
      );
    return this.get(presetId);
  }

  update(presetId: string, input: Record<string, unknown>): ZonePreset {
    const current = this.get(presetId);
    const merged = this.parseInput({ ...current, ...input }, current);
    const now = nowIso();
    this.database.db
      .prepare(
        `UPDATE zone_presets
         SET name = ?, description = ?, enabled = ?, config_json = ?, primary_output_id = ?,
             output_ids_json = ?, volume_values_json = ?, updated_at = ?
         WHERE preset_id = ?`
      )
      .run(
        merged.name,
        merged.description,
        merged.enabled ? 1 : 0,
        JSON.stringify({ ...merged, preset_id: presetId, updated_at: now }),
        merged.grouping.primary_zone_ref?.type === "output_id" ? merged.grouping.primary_zone_ref.value : null,
        JSON.stringify(merged.grouping.members.filter((item) => item.type === "output_id").map((item) => item.value)),
        JSON.stringify(Object.fromEntries(merged.volumes.filter((item) => item.target_ref.type === "output_id").map((item) => [item.target_ref.value, item.volume]))),
        now,
        presetId
      );
    return this.get(presetId);
  }

  delete(presetId: string): void {
    const result = this.database.db
      .prepare("DELETE FROM zone_presets WHERE preset_id = ?")
      .run(presetId) as { changes?: number };
    if (!result.changes) throw new ApiError("ZONE_PRESET_NOT_FOUND", "Zone preset not found");
  }

  async apply(
    roonClient: RoonClient,
    presetId: string,
    options: { dryRun?: boolean; confirm?: boolean; volumeLimitService?: VolumeLimitService } = {}
  ): Promise<Record<string, unknown>> {
    const preset = this.get(presetId);
    if (!preset.enabled) throw new ApiError("ZONE_PRESET_DISABLED", "Zone preset is disabled");

    const before = this.snapshot(roonClient);
    const plan = this.plan(roonClient, preset, options.volumeLimitService, Boolean(options.dryRun));
    const unsafe = plan.volume_policy.outputs.find((policy) => policy.requires_confirmation);
    const responseBase = {
      ok: true,
      preset_id: presetId,
      dry_run: Boolean(options.dryRun),
      resolved_targets: plan.resolved_targets,
      planned_changes: plan.planned_changes,
      before,
      warnings: plan.warnings
    };

    if (unsafe && !options.confirm) {
      return confirmationRequiredResponse(
        "roon_apply_zone_preset",
        "volume_above_safe_limit",
        `El preset supera el límite seguro activo para ${unsafe.output_name}.`,
        {
          preset_id: presetId,
          output_id: unsafe.output_id,
          output_name: unsafe.output_name,
          safe_limit: unsafe.safe_limit,
          projected_value: unsafe.projected_value
        },
        { preset_id: presetId, dry_run: false, confirm: true },
        `El preset supera el límite seguro activo para ${unsafe.output_name}.`
      );
    }

    if (options.dryRun) {
      return {
        ...responseBase,
        after: plan.expected_after
      };
    }

    const transport = requireTransport(roonClient);
    if (preset.playback.action === "pause") {
      for (const zone of plan.affected_zones.filter((zone) => zone.state === "playing")) {
        await callbackCall((callback) => transport.control(zone, "pause", callback), "pause preset zone");
      }
    }

    if (preset.grouping.enabled && plan.group_outputs.length > 1) {
      await callbackCall(
        (callback) => transport.group_outputs(plan.group_outputs, callback),
        "apply zone preset grouping"
      );
    }

    for (const item of plan.volume_outputs) {
      await callbackCall(
        (callback) => transport.change_volume(item.output, "absolute", item.volume, callback),
        "apply zone preset volume"
      );
    }

    const pausedOutputIds = preset.playback.action === "pause"
      ? plan.affected_zones.flatMap((zone) => outputIds(zone))
      : [];
    const expectedGroupIds = preset.grouping.enabled
      ? plan.group_outputs.map((output) => output.output_id)
      : [];
    const stateVerified = await waitForRoonState(
      () => {
        const volumesMatch = plan.volume_outputs.every((item) => {
          const actual = roonClient.getOutput(item.output.output_id)?.volume?.value;
          return typeof actual === "number" && Math.abs(actual - item.volume) < 0.001;
        });
        const groupingMatches = expectedGroupIds.length < 2 || roonClient.getZones().some((zone) => {
          const members = new Set(outputIds(zone));
          return expectedGroupIds.every((outputId) => members.has(outputId));
        });
        const playbackMatches = pausedOutputIds.every((outputId) =>
          roonClient.getZones().some((zone) =>
            outputIds(zone).includes(outputId) && zone.state !== "playing"
          )
        );
        return volumesMatch && groupingMatches && playbackMatches ? true : null;
      },
      (verified) => verified
    );

    return {
      ...responseBase,
      dry_run: false,
      state_verified: stateVerified === true,
      after: this.snapshot(roonClient)
    };
  }

  private plan(
    roonClient: RoonClient,
    preset: ZonePreset,
    volumeLimitService?: VolumeLimitService,
    allowUnavailable = false
  ) {
    const warnings: string[] = [];
    const memberOutputs = preset.grouping.enabled
      ? preset.grouping.members
          .map((ref) => allowUnavailable
            ? this.tryResolveOutput(roonClient, ref, warnings)
            : this.resolveOutput(roonClient, ref))
          .filter((output): output is RoonOutput => Boolean(output))
      : preset.grouping.members
          .map((ref) => this.tryResolveOutput(roonClient, ref, warnings))
          .filter((output): output is RoonOutput => Boolean(output));
    const primaryOutput = preset.grouping.primary_zone_ref
      ? allowUnavailable
        ? this.tryResolveOutput(roonClient, preset.grouping.primary_zone_ref, warnings)
        : this.resolveOutput(roonClient, preset.grouping.primary_zone_ref)
      : memberOutputs[0];
    const groupOutputs = primaryOutput
      ? [
          primaryOutput,
          ...memberOutputs.filter((output) => output.output_id !== primaryOutput.output_id)
        ]
      : memberOutputs;
    const volumeOutputs = preset.volumes
      .map((item) => {
        const output = allowUnavailable
          ? this.tryResolveOutput(roonClient, item.target_ref, warnings)
          : this.resolveOutput(roonClient, item.target_ref);
        return output ? { output, volume: item.volume } : null;
      })
      .filter((item): item is { output: RoonOutput; volume: number } => Boolean(item));
    const affectedIds = new Set([
      ...groupOutputs.map((output) => output.output_id),
      ...volumeOutputs.map((item) => item.output.output_id)
    ]);
    const affectedZones = roonClient.getZones().filter((zone) =>
      outputIds(zone).some((id) => affectedIds.has(id))
    );
    const policies = volumeOutputs.map((item) => {
      const zone = affectedZones.find((candidate) => outputIds(candidate).includes(item.output.output_id)) || {
        zone_id: item.output.zone_id || item.output.output_id,
        display_name: item.output.display_name,
        state: "unknown",
        outputs: [item.output]
      };
      return evaluateZoneVolumePolicy(
        zone,
        [item.output],
        "absolute",
        item.volume,
        volumeLimitService?.activeSafetyLimits()
      ).outputs[0];
    });

    return {
      warnings,
      affected_zones: affectedZones,
      group_outputs: groupOutputs,
      volume_outputs: volumeOutputs,
      volume_policy: {
        requires_confirmation: policies.some((policy) => policy.requires_confirmation),
        outputs: policies
      },
      resolved_targets: [...affectedIds].map((outputId) => {
        const output = roonClient.getOutput(outputId);
        const zone = roonClient.getZones().find((candidate) => outputIds(candidate).includes(outputId));
        return {
          output_id: outputId,
          output_name: output?.display_name || null,
          zone_id: zone?.zone_id || output?.zone_id || null,
          zone_name: zone?.display_name || null
        };
      }),
      planned_changes: {
        grouping: {
          enabled: preset.grouping.enabled,
          output_ids: groupOutputs.map((output) => output.output_id)
        },
        volumes: volumeOutputs.map((item) => ({
          output_id: item.output.output_id,
          output_name: item.output.display_name,
          volume: item.volume,
          volume_context: volumeContext(item.output),
          policy: policies.find((policy) => policy.output_id === item.output.output_id)
        })),
        playback: preset.playback,
        queue: preset.queue
      },
      expected_after: {
        note: "Dry-run only; Roon state is not changed.",
        output_volumes: volumeOutputs.map((item) => ({
          output_id: item.output.output_id,
          value: item.volume,
          volume_context: volumeContext(item.output)
        }))
      }
    };
  }

  private tryResolveOutput(roonClient: RoonClient, ref: PresetTargetRef, warnings: string[]): RoonOutput | null {
    try {
      return this.resolveOutput(roonClient, ref);
    } catch {
      warnings.push(`Output not currently available for ${ref.type}:${ref.value}`);
      return null;
    }
  }

  private resolveOutput(roonClient: RoonClient, ref: PresetTargetRef): RoonOutput {
    if (ref.type === "output_id") {
      const output = roonClient.getOutput(ref.value);
      if (!output) throw new ApiError("OUTPUT_NOT_AVAILABLE", "No se encontró el output configurado.", { target_ref: ref });
      return output;
    }
    if (ref.type === "zone_id") {
      const zone = roonClient.getZone(ref.value);
      const output = zone?.outputs?.[0];
      if (!output) throw new ApiError("OUTPUT_NOT_AVAILABLE", "No se encontró la zona configurada.", { target_ref: ref });
      return output;
    }
    if (ref.type === "output_name") {
      const output = roonClient.getOutputs().find((item) => normalizeName(item.display_name) === normalizeName(ref.value));
      if (!output) throw new ApiError("OUTPUT_NOT_AVAILABLE", "No se encontró el output configurado.", { target_ref: ref });
      return output;
    }
    const zone = roonClient.getZones().find((item) => normalizeName(item.display_name) === normalizeName(ref.value));
    const output = zone?.outputs?.[0];
    if (!output) throw new ApiError("OUTPUT_NOT_AVAILABLE", "No se encontró la zona configurada.", { target_ref: ref });
    return output;
  }

  private legacySnapshot(roonClient: RoonClient, preset: ZonePreset): {
    primary_output_id: string | null;
    output_ids: string[];
    volume_values: Record<string, number>;
  } {
    let primaryOutputId: string | null = null;
    if (preset.grouping.enabled && preset.grouping.primary_zone_ref) {
      primaryOutputId = this.resolveOutput(roonClient, preset.grouping.primary_zone_ref).output_id;
    } else if (preset.grouping.primary_zone_ref?.type === "output_id") {
      primaryOutputId = preset.grouping.primary_zone_ref.value;
    }

    const output_ids = preset.grouping.members
      .map((ref) => {
        if (ref.type === "output_id") return ref.value;
        if (preset.grouping.enabled) return this.resolveOutput(roonClient, ref).output_id;
        return null;
      })
      .filter((value): value is string => Boolean(value));
    const volume_values = Object.fromEntries(
      preset.volumes.map((item) => {
        const outputId = item.target_ref.type === "output_id"
          ? item.target_ref.value
          : this.resolveOutput(roonClient, item.target_ref).output_id;
        return [outputId, item.volume];
      })
    );
    return { primary_output_id: primaryOutputId, output_ids, volume_values };
  }

  private parseInput(input: Record<string, unknown>, fallback?: ZonePreset): ZonePreset {
    const name = requiredString(input.name ?? fallback?.name, "name").slice(0, 80);
    const description = input.description === undefined
      ? fallback?.description || null
      : typeof input.description === "string" && input.description.trim()
        ? input.description.trim()
        : null;
    const enabled = input.enabled === undefined ? fallback?.enabled ?? true : input.enabled !== false;

    const legacyOutputIds = Array.isArray(input.output_ids)
      ? input.output_ids.map((id) => ({ type: "output_id", value: String(id) } as PresetTargetRef))
      : null;
    const groupingInput = typeof input.grouping === "object" && input.grouping !== null
      ? input.grouping as Record<string, unknown>
      : {};
    const groupingEnabled = groupingInput.enabled === undefined
      ? (legacyOutputIds ? legacyOutputIds.length > 1 : fallback?.grouping.enabled ?? false)
      : groupingInput.enabled !== false;
    const members = Array.isArray(groupingInput.members)
      ? groupingInput.members.map((item, index) => parseRef(item, `grouping.members.${index}`))
      : legacyOutputIds || fallback?.grouping.members || [];
    const primary = groupingInput.primary_zone_ref
      ? parseRef(groupingInput.primary_zone_ref, "grouping.primary_zone_ref")
      : typeof input.primary_output_id === "string"
        ? { type: "output_id", value: input.primary_output_id } as PresetTargetRef
        : fallback?.grouping.primary_zone_ref || members[0] || null;

    const volumesInput = Array.isArray(input.volumes)
      ? input.volumes.map((item, index) => {
          const raw = item as Record<string, unknown>;
          return {
            target_ref: parseRef(raw.target_ref, `volumes.${index}.target_ref`),
            volume: Number(raw.volume)
          };
        })
      : input.volume_values && typeof input.volume_values === "object"
        ? Object.entries(input.volume_values as Record<string, unknown>).map(([outputId, value]) => ({
            target_ref: { type: "output_id", value: outputId } as PresetTargetRef,
            volume: Number(value)
          }))
        : fallback?.volumes || [];
    if (volumesInput.some((item) => !Number.isFinite(item.volume) || item.volume < 0)) {
      throw new ApiError("INVALID_ZONE_PRESET", "volumes must contain non-negative numeric values");
    }

    const playbackRaw = typeof input.playback === "object" && input.playback !== null
      ? (input.playback as Record<string, unknown>).action
      : input.playback;
    const playbackAction = playbackRaw === "pause" ? "pause" : fallback?.playback.action || "keep_current";

    return {
      preset_id: fallback?.preset_id || "",
      name,
      description,
      enabled,
      virtual_zone: {
        enabled: (input.virtual_zone as any)?.enabled ?? fallback?.virtual_zone.enabled ?? true,
        display_name: (input.virtual_zone as any)?.display_name || fallback?.virtual_zone.display_name || name,
        show_in_portal: (input.virtual_zone as any)?.show_in_portal ?? fallback?.virtual_zone.show_in_portal ?? true,
        show_in_roon_if_supported: false
      },
      grouping: { enabled: groupingEnabled, primary_zone_ref: primary, members },
      volumes: volumesInput,
      playback: { action: playbackAction },
      queue: { action: "keep_current" },
      portal_metadata: (input.portal_metadata as Record<string, unknown>) || fallback?.portal_metadata || {},
      created_at: fallback?.created_at || nowIso(),
      updated_at: nowIso()
    };
  }

  private mapRow(row: PresetRow): ZonePreset {
    if (row.config_json) {
      const parsed = JSON.parse(row.config_json) as ZonePreset;
      const outputIdsValue = parsed.grouping.members
        .filter((item) => item.type === "output_id")
        .map((item) => item.value);
      const volumeValues = Object.fromEntries(
        parsed.volumes
          .filter((item) => item.target_ref.type === "output_id")
          .map((item) => [item.target_ref.value, item.volume])
      );
      return {
        ...parsed,
        preset_id: row.preset_id,
        name: row.name,
        description: row.description,
        enabled: Boolean(row.enabled),
        primary_output_id: row.primary_output_id || (
          parsed.grouping.primary_zone_ref?.type === "output_id"
            ? parsed.grouping.primary_zone_ref.value
            : null
        ),
        output_ids: outputIdsValue,
        volume_values: volumeValues,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    }
    const outputIdsValue = row.output_ids_json ? JSON.parse(row.output_ids_json) as string[] : [];
    const volumes = row.volume_values_json ? JSON.parse(row.volume_values_json) as Record<string, number> : {};
    return {
      preset_id: row.preset_id,
      name: row.name,
      description: row.description,
      enabled: Boolean(row.enabled),
      virtual_zone: {
        enabled: true,
        display_name: row.name,
        show_in_portal: true,
        show_in_roon_if_supported: false
      },
      grouping: {
        enabled: outputIdsValue.length > 1,
        primary_zone_ref: row.primary_output_id ? { type: "output_id", value: row.primary_output_id } : null,
        members: outputIdsValue.map((id) => ({ type: "output_id", value: id }))
      },
      volumes: Object.entries(volumes).map(([outputId, volume]) => ({
        target_ref: { type: "output_id", value: outputId },
        volume
      })),
      playback: { action: "keep_current" },
      queue: { action: "keep_current" },
      portal_metadata: {},
      primary_output_id: row.primary_output_id,
      output_ids: outputIdsValue,
      volume_values: volumes,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private snapshot(roonClient: RoonClient): Record<string, unknown> {
    return {
      zones: roonClient.getZones().map((zone) => ({
        zone_id: zone.zone_id,
        zone_name: zone.display_name,
        state: zone.state,
        outputs: (zone.outputs || []).map((output) => ({
          output_id: output.output_id,
          output_name: output.display_name,
          volume: output.volume?.value ?? null
        }))
      }))
    };
  }
}
