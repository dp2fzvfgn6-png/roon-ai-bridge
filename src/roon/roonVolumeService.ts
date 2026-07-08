import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";
import { RoonOutput, RoonZone } from "./roonTypes";
import { getZoneOrThrow } from "./roonZoneService";
import { requireTransport } from "./roonTransportService";

export type VolumeOutputState = {
  output_id: string;
  display_name: string;
  volume: RoonOutput["volume"];
};

export type VolumeChangeResult = {
  ok: true;
  zone_id: string;
  zone_name: string;
  mode: "relative" | "absolute" | "relative_step";
  value: number;
  outputs: VolumeOutputState[];
};

function volumeCapableOutputs(zone: RoonZone): RoonOutput[] {
  return (zone.outputs || []).filter((output) => output.volume);
}

function volumeLimit(
  output: RoonOutput,
  key: "min" | "max",
  hardKey: "hard_limit_min" | "hard_limit_max"
): number | null {
  const volume = output.volume || {};
  const hard = volume[hardKey] as unknown;
  if (typeof hard === "number" && Number.isFinite(hard)) return hard;
  const soft = volume[key];
  return typeof soft === "number" && Number.isFinite(soft) ? soft : null;
}

function projectedVolume(
  output: RoonOutput,
  mode: "relative" | "absolute" | "relative_step",
  value: number
): number | null {
  const volume = output.volume || {};
  const current = typeof volume.value === "number" ? volume.value : null;
  if (mode === "absolute") return value;
  if (current === null) return null;
  if (mode === "relative_step") {
    const step = typeof volume.step === "number" && volume.step > 0 ? volume.step : 1;
    return current + value * step;
  }
  return current + value;
}

function validateVolume(
  outputs: RoonOutput[],
  mode: "relative" | "absolute" | "relative_step",
  value: number
): void {
  if (outputs.length === 0) {
    throw new ApiError("VOLUME_NOT_SUPPORTED", "Volume is not supported by this zone");
  }

  const incrementalOutputs = outputs.filter(
    (output) => output.volume?.type === "incremental"
  );
  if (mode === "absolute" && incrementalOutputs.length > 0) {
    throw new ApiError(
      "VOLUME_NOT_SUPPORTED",
      "Absolute volume is not supported for incremental-only outputs",
      {
        outputs: incrementalOutputs.map((output) => output.display_name)
      }
    );
  }

  for (const output of outputs) {
    const projected = projectedVolume(output, mode, value);
    if (projected === null) continue;
    const min = volumeLimit(output, "min", "hard_limit_min");
    const max = volumeLimit(output, "max", "hard_limit_max");
    if ((min !== null && projected < min) || (max !== null && projected > max)) {
      throw new ApiError("INVALID_VOLUME_VALUE", "Volume value is outside output range", {
        output_id: output.output_id,
        output_name: output.display_name,
        min,
        max,
        current: output.volume?.value,
        requested_value: value,
        projected_value: projected,
        mode
      });
    }
  }
}

function outputState(output: RoonOutput): VolumeOutputState {
  return {
    output_id: output.output_id,
    display_name: output.display_name,
    volume: output.volume
  };
}

export async function changeZoneVolume(
  roonClient: RoonClient,
  zoneId: string,
  mode: "relative" | "absolute" | "relative_step",
  value: number
): Promise<VolumeChangeResult> {
  const transport = requireTransport(roonClient);
  const zone = getZoneOrThrow(roonClient, zoneId);
  const outputs = volumeCapableOutputs(zone);

  validateVolume(outputs, mode, value);

  await Promise.all(
    outputs.map(
      (output) =>
        new Promise<void>((resolve, reject) => {
          transport.change_volume(output, mode, value, (error: unknown) => {
            if (error) {
              reject(
                new ApiError("INTERNAL_ERROR", String(error), {
                  output_id: output.output_id,
                  mode,
                  value
                })
              );
              return;
            }
            resolve();
          });
        })
    )
  );

  const refreshedZone = roonClient.getZone(zoneId) || zone;
  return {
    ok: true,
    zone_id: zoneId,
    zone_name: refreshedZone.display_name,
    mode,
    value,
    outputs: volumeCapableOutputs(refreshedZone).map(outputState)
  };
}
