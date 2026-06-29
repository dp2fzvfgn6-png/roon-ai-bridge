import crypto from "crypto";
import { AppConfig } from "../config/env";
import { createDatabase, SqliteDatabase } from "../db/database";
import { RoonClient } from "../roon/roonClient";
import { RoonOutput, RoonZone } from "../roon/roonTypes";
import { ApiError } from "../utils/errors";
import { requireTransport } from "../roon/roonTransportService";

export type ZonePreset = {
  preset_id: string;
  name: string;
  primary_output_id: string;
  output_ids: string[];
  volume_values: Record<string, number>;
  created_at: string;
  updated_at: string;
};

type PresetRow = {
  preset_id: string;
  name: string;
  primary_output_id: string;
  output_ids_json: string;
  volume_values_json: string | null;
  created_at: string;
  updated_at: string;
};

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("INVALID_ZONE_PRESET", `${field} is required`);
  }
  return value.trim();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ApiError("INVALID_ZONE_PRESET", "output_ids must be an array");
  }
  const ids = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  if (new Set(ids).size !== ids.length || ids.length < 2) {
    throw new ApiError(
      "INVALID_ZONE_PRESET",
      "A preset requires at least two unique output IDs"
    );
  }
  return ids;
}

function outputIds(zone: RoonZone): string[] {
  return (zone.outputs || []).map((output) => output.output_id);
}

function callbackCall(
  invoke: (callback: (error: string | false) => void) => void,
  operation: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    invoke((error) => {
      if (error) {
        reject(new ApiError("INTERNAL_ERROR", `${operation} failed`, { error }));
      } else {
        resolve();
      }
    });
  });
}

export class ZonePresetService {
  private readonly database: SqliteDatabase;

  constructor(config: AppConfig, database?: SqliteDatabase) {
    this.database = database || createDatabase(config);
  }

  list(): ZonePreset[] {
    return (
      this.database.db
        .prepare(
          `SELECT preset_id, name, primary_output_id, output_ids_json,
                  volume_values_json, created_at, updated_at
           FROM zone_presets ORDER BY name ASC`
        )
        .all() as PresetRow[]
    ).map((row) => this.mapRow(row));
  }

  create(
    roonClient: RoonClient,
    input: {
      name?: unknown;
      primary_output_id?: unknown;
      output_ids?: unknown;
      capture_volumes?: unknown;
    }
  ): ZonePreset {
    const name = stringValue(input.name, "name").slice(0, 80);
    const outputIdsValue = stringArray(input.output_ids);
    const primary = stringValue(input.primary_output_id, "primary_output_id");
    if (!outputIdsValue.includes(primary)) {
      throw new ApiError(
        "INVALID_ZONE_PRESET",
        "primary_output_id must be included in output_ids"
      );
    }
    outputIdsValue.forEach((id) => this.outputOrThrow(roonClient, id));
    const volumes: Record<string, number> = {};
    if (input.capture_volumes !== false) {
      for (const id of outputIdsValue) {
        const value = roonClient.getOutput(id)?.volume?.value;
        if (typeof value === "number") volumes[id] = value;
      }
    }
    const now = new Date().toISOString();
    const presetId = crypto.randomUUID();
    this.database.db
      .prepare(
        `INSERT INTO zone_presets (
          preset_id, name, primary_output_id, output_ids_json,
          volume_values_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        presetId,
        name,
        primary,
        JSON.stringify(outputIdsValue),
        JSON.stringify(volumes),
        now,
        now
      );
    return this.get(presetId);
  }

  update(
    presetId: string,
    input: { name?: unknown; volume_values?: unknown }
  ): ZonePreset {
    const current = this.get(presetId);
    const name =
      input.name === undefined
        ? current.name
        : stringValue(input.name, "name").slice(0, 80);
    const volumes =
      input.volume_values &&
      typeof input.volume_values === "object" &&
      !Array.isArray(input.volume_values)
        ? input.volume_values
        : current.volume_values;
    this.database.db
      .prepare(
        `UPDATE zone_presets
         SET name = ?, volume_values_json = ?, updated_at = ?
         WHERE preset_id = ?`
      )
      .run(name, JSON.stringify(volumes), new Date().toISOString(), presetId);
    return this.get(presetId);
  }

  delete(presetId: string): void {
    const result = this.database.db
      .prepare("DELETE FROM zone_presets WHERE preset_id = ?")
      .run(presetId) as { changes?: number };
    if (!result.changes) {
      throw new ApiError("ZONE_PRESET_NOT_FOUND", "Zone preset not found");
    }
  }

  async apply(
    roonClient: RoonClient,
    presetId: string
  ): Promise<Record<string, unknown>> {
    const preset = this.get(presetId);
    const transport = requireTransport(roonClient);
    const orderedIds = [
      preset.primary_output_id,
      ...preset.output_ids.filter((id) => id !== preset.primary_output_id)
    ];
    const outputs = orderedIds.map((id) => this.outputOrThrow(roonClient, id));
    for (const output of outputs) {
      const compatible = output.can_group_with_output_ids;
      if (
        Array.isArray(compatible) &&
        outputs.some(
          (candidate) =>
            candidate.output_id !== output.output_id &&
            !compatible.includes(candidate.output_id)
        )
      ) {
        throw new ApiError(
          "OUTPUTS_NOT_GROUPABLE",
          "Preset outputs are not mutually groupable",
          { output_id: output.output_id }
        );
      }
    }
    const affectedZones = roonClient
      .getZones()
      .filter((zone) => outputIds(zone).some((id) => orderedIds.includes(id)));

    for (const zone of affectedZones.filter((item) => item.state === "playing")) {
      await callbackCall(
        (callback) => transport.control(zone, "pause", callback),
        "pause before preset"
      );
    }
    for (const zone of affectedZones.filter((item) => (item.outputs || []).length > 1)) {
      await callbackCall(
        (callback) => transport.ungroup_outputs(zone.outputs, callback),
        "ungroup before preset"
      );
    }
    await callbackCall(
      (callback) => transport.group_outputs(outputs, callback),
      "apply zone preset"
    );

    const deadline = Date.now() + 6000;
    let groupedZone: RoonZone | null = null;
    while (Date.now() < deadline) {
      groupedZone =
        roonClient
          .getZones()
          .find((zone) =>
            orderedIds.every((id) => outputIds(zone).includes(id))
          ) || null;
      if (groupedZone) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!groupedZone) {
      throw new ApiError(
        "ZONE_GROUP_STATE_NOT_CHANGED",
        "Preset grouping was not confirmed by Roon"
      );
    }

    for (const output of outputs) {
      const value = preset.volume_values[output.output_id];
      if (typeof value !== "number" || !output.volume) continue;
      await callbackCall(
        (callback) => transport.change_volume(output, "absolute", value, callback),
        "restore preset volume"
      );
    }
    return {
      ok: true,
      preset_id: presetId,
      zone_id: groupedZone.zone_id,
      output_ids: orderedIds,
      state_verified: true
    };
  }

  private get(presetId: string): ZonePreset {
    const row = this.database.db
      .prepare(
        `SELECT preset_id, name, primary_output_id, output_ids_json,
                volume_values_json, created_at, updated_at
         FROM zone_presets WHERE preset_id = ?`
      )
      .get(presetId) as PresetRow | undefined;
    if (!row) {
      throw new ApiError("ZONE_PRESET_NOT_FOUND", "Zone preset not found");
    }
    return this.mapRow(row);
  }

  private mapRow(row: PresetRow): ZonePreset {
    return {
      preset_id: row.preset_id,
      name: row.name,
      primary_output_id: row.primary_output_id,
      output_ids: JSON.parse(row.output_ids_json),
      volume_values: row.volume_values_json
        ? JSON.parse(row.volume_values_json)
        : {},
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private outputOrThrow(roonClient: RoonClient, outputId: string): RoonOutput {
    const output = roonClient.getOutput(outputId);
    if (!output) {
      throw new ApiError("OUTPUT_NOT_FOUND", "Output not found", {
        output_id: outputId
      });
    }
    return output;
  }
}
