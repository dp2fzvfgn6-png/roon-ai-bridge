import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";
import { getZoneOrThrow } from "./roonZoneService";
import { requireTransport } from "./roonTransportService";

export type ZoneTransferResult = {
  ok: true;
  source_zone_id: string;
  source_zone_name: string;
  target_zone_id: string;
  target_zone_name: string;
  transferred: "queue_and_playback";
};

export async function transferZonePlayback(
  roonClient: RoonClient,
  sourceZoneId: string,
  targetZoneId: string
): Promise<ZoneTransferResult> {
  const transport = requireTransport(roonClient);
  const sourceZone = getZoneOrThrow(roonClient, sourceZoneId);
  const targetZone = getZoneOrThrow(roonClient, targetZoneId);

  if (sourceZone.zone_id === targetZone.zone_id) {
    throw new ApiError(
      "UNSUPPORTED_COMMAND",
      "Source and target zones must be different",
      {
        source_zone_id: sourceZoneId,
        target_zone_id: targetZoneId
      }
    );
  }

  await new Promise<void>((resolve, reject) => {
    transport.transfer_zone(sourceZone, targetZone, (error: unknown) => {
      if (error) {
        reject(
          new ApiError("INTERNAL_ERROR", `Roon zone transfer failed: ${String(error)}`, {
            source_zone_id: sourceZoneId,
            target_zone_id: targetZoneId
          })
        );
        return;
      }
      resolve();
    });
  });

  return {
    ok: true,
    source_zone_id: sourceZone.zone_id,
    source_zone_name: sourceZone.display_name,
    target_zone_id: targetZone.zone_id,
    target_zone_name: targetZone.display_name,
    transferred: "queue_and_playback"
  };
}
