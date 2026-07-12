import { AppConfig } from "../config/env";
import { createDatabase, SqliteDatabase } from "../db/database";
import { RoonClient } from "../roon/roonClient";
import { ApiError } from "../utils/errors";
import { requireTransport } from "../roon/roonTransportService";
import { roonSdkCall } from "../roon/roonSdk";

type StoredVolumeSettings = {
  output_id: string;
  display_name: string | null;
  minimum_value: number | null;
  maximum_value: number | null;
  preferred_value: number | null;
  updated_at: string;
};

function optionalNumber(value: unknown): number | null {
  if (value === null || value === "" || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiError("INVALID_VOLUME_VALUE", "Volume value must be numeric");
  }
  return parsed;
}

export class OutputVolumeSettingsService {
  private readonly database: SqliteDatabase;

  constructor(config: AppConfig, database?: SqliteDatabase) {
    this.database = database || createDatabase(config);
  }

  list(roonClient: RoonClient): Record<string, unknown>[] {
    const stored = this.database.db
      .prepare(
        `SELECT output_id, display_name, minimum_value, maximum_value,
                preferred_value, updated_at FROM output_volume_settings`
      )
      .all() as StoredVolumeSettings[];
    const byId = new Map(stored.map((item) => [item.output_id, item]));
    return roonClient.getOutputs().map((output) => ({
      output_id: output.output_id,
      display_name: output.display_name,
      current_volume: output.volume || null,
      settings: byId.get(output.output_id) || {
        output_id: output.output_id,
        display_name: output.display_name,
        minimum_value: null,
        maximum_value: null,
        preferred_value: null,
        updated_at: null
      }
    }));
  }

  save(
    roonClient: RoonClient,
    outputId: string,
    input: Record<string, unknown>
  ): StoredVolumeSettings {
    const output = roonClient.getOutput(outputId);
    if (!output) throw new ApiError("OUTPUT_NOT_FOUND", "Output not found");
    const minimum = optionalNumber(input.minimum_value);
    const maximum = optionalNumber(input.maximum_value);
    const preferred = optionalNumber(input.preferred_value);
    if (minimum !== null && maximum !== null && minimum > maximum) {
      throw new ApiError(
        "INVALID_VOLUME_VALUE",
        "minimum_value cannot exceed maximum_value"
      );
    }
    if (
      preferred !== null &&
      ((minimum !== null && preferred < minimum) ||
        (maximum !== null && preferred > maximum))
    ) {
      throw new ApiError(
        "INVALID_VOLUME_VALUE",
        "preferred_value must be inside the configured limits"
      );
    }
    const now = new Date().toISOString();
    this.database.db
      .prepare(
        `INSERT INTO output_volume_settings (
          output_id, display_name, minimum_value, maximum_value,
          preferred_value, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(output_id) DO UPDATE SET
          display_name = excluded.display_name,
          minimum_value = excluded.minimum_value,
          maximum_value = excluded.maximum_value,
          preferred_value = excluded.preferred_value,
          updated_at = excluded.updated_at`
      )
      .run(
        outputId,
        output.display_name,
        minimum,
        maximum,
        preferred,
        now
      );
    return {
      output_id: outputId,
      display_name: output.display_name,
      minimum_value: minimum,
      maximum_value: maximum,
      preferred_value: preferred,
      updated_at: now
    };
  }

  validateZoneAbsoluteValue(
    roonClient: RoonClient,
    zoneId: string,
    value: number
  ): void {
    const zone = roonClient.getZone(zoneId);
    if (!zone) throw new ApiError("ZONE_NOT_FOUND", "Zone not found");
    for (const output of zone.outputs || []) {
      const settings = this.database.db
        .prepare(
          `SELECT minimum_value, maximum_value
           FROM output_volume_settings WHERE output_id = ?`
        )
        .get(output.output_id) as
        | { minimum_value: number | null; maximum_value: number | null }
        | undefined;
      if (!settings) continue;
      if (
        (settings.minimum_value !== null && value < settings.minimum_value) ||
        (settings.maximum_value !== null && value > settings.maximum_value)
      ) {
        throw new ApiError(
          "INVALID_VOLUME_VALUE",
          "Requested volume is outside the configured output limits",
          {
            output_id: output.output_id,
            minimum_value: settings.minimum_value,
            maximum_value: settings.maximum_value,
            value
          }
        );
      }
    }
  }

  async applyPreferred(
    roonClient: RoonClient,
    outputId: string
  ): Promise<Record<string, unknown>> {
    const output = roonClient.getOutput(outputId);
    if (!output) throw new ApiError("OUTPUT_NOT_FOUND", "Output not found");
    const settings = this.database.db
      .prepare(
        `SELECT output_id, display_name, minimum_value, maximum_value,
                preferred_value, updated_at
         FROM output_volume_settings WHERE output_id = ?`
      )
      .get(outputId) as StoredVolumeSettings | undefined;
    if (!settings || settings.preferred_value === null) {
      throw new ApiError(
        "INVALID_VOLUME_VALUE",
        "No preferred volume is configured for this output"
      );
    }
    const transport = requireTransport(roonClient);
    const preferredValue = settings.preferred_value;
    await roonSdkCall<void>(
      "Roon preferred volume change",
      (callback) => transport.change_volume(
        output,
        "absolute",
        preferredValue,
        callback
      ),
      { output_id: outputId, value: preferredValue }
    );
    return {
      ok: true,
      output_id: outputId,
      preferred_value: settings.preferred_value
    };
  }
}
