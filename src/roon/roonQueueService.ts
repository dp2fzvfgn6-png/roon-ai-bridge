import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";
import { getZoneOrThrow } from "./roonZoneService";
import { requireTransport } from "./roonTransportService";
import { roonSdkCall } from "./roonSdk";

export const queueImplemented = true;

export type QueueAction = "play_from_here" | "add_next" | "add_to_queue";

export type QueueItem = {
  queue_item_id?: number | string;
  title?: string;
  subtitle?: string;
  artist?: string;
  album?: string;
  image_key?: string | null;
  one_line?: QueueItemDisplayLines;
  two_line?: QueueItemDisplayLines;
  three_line?: QueueItemDisplayLines;
  [key: string]: unknown;
};

type QueueItemDisplayLines = {
  line1?: string;
  line2?: string;
  line3?: string;
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
    if (Array.isArray(candidate)) return candidate.map(normalizeQueueItem);
  }

  return [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function displayLines(value: unknown): QueueItemDisplayLines {
  return value && typeof value === "object"
    ? value as QueueItemDisplayLines
    : {};
}

function normalizeQueueItem(value: unknown): QueueItem {
  const item = value && typeof value === "object"
    ? value as QueueItem
    : {};
  const oneLine = displayLines(item.one_line);
  const twoLine = displayLines(item.two_line);
  const threeLine = displayLines(item.three_line);
  const title = text(item.title) || text(threeLine.line1) || text(twoLine.line1) || text(oneLine.line1);
  const artist = text(item.artist) || text(threeLine.line2) || text(twoLine.line2);
  const album = text(item.album) || text(threeLine.line3);
  const subtitle = text(item.subtitle) || artist;

  return {
    ...item,
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(album ? { album } : {}),
    ...(subtitle ? { subtitle } : {})
  };
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
          subscription.unsubscribe();
        } catch {
          // The snapshot result is still valid even if cleanup fails.
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
          items: items.slice(0, count),
          raw: body
        })
      );
    });
    if (settled && subscription) {
      try {
        subscription.unsubscribe();
      } catch {
        // Synchronous subscription callbacks may settle before assignment.
      }
    }
  });
}

export async function playQueueItemFromHere(
  roonClient: RoonClient,
  zoneId: string,
  queueItemId: string | number,
  options: { timeoutMs?: number } = {}
): Promise<{
  ok: true;
  zone_id: string;
  queue_item_id: string | number;
  state_verified: false;
}> {
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

  await roonSdkCall<void>(
    "Roon play queue item",
    (callback) => transport.play_from_here(zone, queueItemId, (message) => {
      const name = message?.name || "NetworkError";
      callback(name === "Success" ? false : name, undefined);
    }),
    { zone_id: zoneId, queue_item_id: queueItemId },
    { timeoutMs: options.timeoutMs }
  );

  return {
    ok: true,
    zone_id: zoneId,
    queue_item_id: queueItemId,
    state_verified: false
  };
}
