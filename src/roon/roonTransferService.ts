import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";
import { getZoneOrThrow } from "./roonZoneService";
import { requireTransport } from "./roonTransportService";
import { roonSdkCall, waitForRoonState } from "./roonSdk";
import { RoonZone } from "./roonTypes";
import { getQueueSnapshot, QueueItem } from "./roonQueueService";

export type ZoneTransferResult = {
  ok: true;
  source_zone_id: string;
  source_zone_name: string;
  target_zone_id: string;
  target_zone_name: string;
  transferred: "queue_and_playback";
  state_verified: true;
  final_target_state: RoonZone;
};

function queueIdentity(item: QueueItem): string {
  const { queue_item_id: queueItemId, ...content } = item;
  return Object.keys(content).length > 0
    ? JSON.stringify(content)
    : `queue-item:${String(queueItemId ?? "unknown")}`;
}

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

  const expectedTitle = sourceZone.now_playing?.three_line?.line1 || null;
  const sourceQueue = await getQueueSnapshot(roonClient, sourceZoneId, 100);
  await roonSdkCall<void>(
    "Roon zone transfer",
    (callback) => transport.transfer_zone(sourceZone, targetZone, callback),
    { source_zone_id: sourceZoneId, target_zone_id: targetZoneId }
  );
  const finalTarget = await waitForRoonState(
    () => roonClient.getZone(targetZoneId),
    (candidate) =>
      candidate.state === sourceZone.state &&
      (!expectedTitle || candidate.now_playing?.three_line?.line1 === expectedTitle)
  );
  if (!finalTarget) {
    throw new ApiError(
      "PLAYBACK_STATE_NOT_CHANGED",
      "Roon accepted the transfer but the target zone state could not be verified",
      { source_zone_id: sourceZoneId, target_zone_id: targetZoneId }
    );
  }
  const targetQueue = await getQueueSnapshot(roonClient, targetZoneId, 100);
  const queueVerified = sourceQueue.items.length === targetQueue.items.length &&
    sourceQueue.items.every((item, index) =>
      queueIdentity(item) === queueIdentity(targetQueue.items[index])
    );
  if (!queueVerified) {
    throw new ApiError(
      "PLAYBACK_STATE_NOT_CHANGED",
      "Roon accepted the transfer but the target queue could not be verified",
      {
        source_zone_id: sourceZoneId,
        target_zone_id: targetZoneId,
        source_queue_count: sourceQueue.items.length,
        target_queue_count: targetQueue.items.length
      }
    );
  }

  return {
    ok: true,
    source_zone_id: sourceZone.zone_id,
    source_zone_name: sourceZone.display_name,
    target_zone_id: targetZone.zone_id,
    target_zone_name: targetZone.display_name,
    transferred: "queue_and_playback",
    state_verified: true,
    final_target_state: finalTarget
  };
}
