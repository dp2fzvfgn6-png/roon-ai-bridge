import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";
import { getZoneOrThrow } from "./roonZoneService";
import { requireTransport } from "./roonTransportService";

export const queueImplemented = true;

export type QueueAction = "play_from_here" | "add_next" | "add_to_queue";

export type QueueItem = {
  queue_item_id?: number | string;
  title?: string;
  subtitle?: string;
  image_key?: string | null;
  [key: string]: unknown;
};

export type QueueSnapshot = {
  zone_id: string;
  max_item_count: number;
  items: QueueItem[];
  raw: Record<string, unknown>;
};

function asQueueItems(msg: Record<string, unknown>): QueueItem[] {
  const candidates = [
    msg.items,
    msg.queue_items,
    msg.queue
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as QueueItem[];
  }

  return [];
}

export async function getQueueSnapshot(
  roonClient: RoonClient,
  zoneId: string,
  maxItemCount: number
): Promise<QueueSnapshot> {
  const transport = requireTransport(roonClient);
  const zone = getZoneOrThrow(roonClient, zoneId);
  const count = Math.max(1, Math.min(maxItemCount, 500));

  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription: { unsubscribe(callback?: (msg?: unknown) => void): void } | null = null;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      if (subscription) {
        try {
          subscription.unsubscribe(() => callback());
          return;
        } catch {
          callback();
          return;
        }
      }
      callback();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(new ApiError("QUEUE_NOT_READY", "Queue snapshot was not received", {
          zone_id: zoneId
        }))
      );
    }, 5000);

    subscription = transport.subscribe_queue(zone, count, (event: string | false, msg: unknown) => {
      if (settled) return;
      if (event === "Unsubscribed") return;

      const body =
        msg && typeof msg === "object" ? (msg as Record<string, unknown>) : {};
      const items = asQueueItems(body);

      if (event === false && items.length === 0) return;

      if (event && !["Subscribed", "Changed"].includes(event)) {
        clearTimeout(timer);
        finish(() =>
          reject(new ApiError("INTERNAL_ERROR", String(event), { zone_id: zoneId }))
        );
        return;
      }

      clearTimeout(timer);
      finish(() =>
        resolve({
          zone_id: zoneId,
          max_item_count: count,
          items,
          raw: body
        })
      );
    });
  });
}

export async function playQueueItemFromHere(
  roonClient: RoonClient,
  zoneId: string,
  queueItemId: string | number
): Promise<{ ok: true; zone_id: string; queue_item_id: string | number }> {
  const transport = requireTransport(roonClient);
  const zone = getZoneOrThrow(roonClient, zoneId);

  if (
    !(
      typeof queueItemId === "string" ||
      typeof queueItemId === "number"
    ) ||
    String(queueItemId).trim() === ""
  ) {
    throw new ApiError("INVALID_QUEUE_ITEM_ID", "queue_item_id is required");
  }

  await new Promise<void>((resolve, reject) => {
    transport.play_from_here(zone, queueItemId, (msg: unknown, body: unknown) => {
      const name =
        msg && typeof msg === "object" && "name" in msg
          ? String((msg as { name?: unknown }).name)
          : null;

      if (name && name !== "Success") {
        reject(new ApiError("INTERNAL_ERROR", name, { zone_id: zoneId, body }));
        return;
      }

      resolve();
    });
  });

  return {
    ok: true,
    zone_id: zoneId,
    queue_item_id: queueItemId
  };
}
