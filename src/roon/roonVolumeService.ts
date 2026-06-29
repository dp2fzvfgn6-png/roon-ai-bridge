import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";
import { RoonOutput, RoonZone } from "./roonTypes";
import { getZoneOrThrow } from "./roonZoneService";
import { requireTransport } from "./roonTransportService";

function volumeCapableOutputs(zone: RoonZone): RoonOutput[] {
  return (zone.outputs || []).filter((output) => output.volume);
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

  if (mode === "absolute") {
    const outOfRange = outputs.find((output) => {
      const volume = output.volume || {};
      return (
        typeof volume.min === "number" &&
        typeof volume.max === "number" &&
        (value < volume.min || value > volume.max)
      );
    });

    if (outOfRange) {
      throw new ApiError("INVALID_VOLUME_VALUE", "Volume value is outside output range", {
        output_id: outOfRange.output_id,
        output_name: outOfRange.display_name,
        min: outOfRange.volume?.min,
        max: outOfRange.volume?.max,
        value
      });
    }
  }
}

export async function changeZoneVolume(
  roonClient: RoonClient,
  zoneId: string,
  mode: "relative" | "absolute" | "relative_step",
  value: number
): Promise<RoonOutput[]> {
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

  return outputs;
}
