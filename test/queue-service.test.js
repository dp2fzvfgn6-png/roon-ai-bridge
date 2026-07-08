const assert = require("node:assert/strict");
const test = require("node:test");

const { getQueueSnapshot } = require("../dist/roon/roonQueueService");

function queueClient(itemsByZone) {
  const zones = new Map(
    Object.keys(itemsByZone).map((zoneId) => [
      zoneId,
      { zone_id: zoneId, display_name: zoneId, state: "paused", outputs: [] }
    ])
  );
  return {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getZone: (zoneId) => zones.get(zoneId) || null,
    getTransport: () => ({
      subscribe_queue(zone, count, callback) {
        callback("Subscribed", {
          items: itemsByZone[zone.zone_id].slice(0, Math.max(count, 999))
        });
        return { unsubscribe(done) { if (done) done(); } };
      }
    })
  };
}

test("queue snapshots respect max_item_count", async () => {
  const result = await getQueueSnapshot(
    queueClient({
      office: Array.from({ length: 20 }, (_, index) => ({ queue_item_id: index }))
    }),
    "office",
    5
  );

  assert.equal(result.max_item_count, 5);
  assert.equal(result.items.length, 5);
});

test("queue snapshots allow empty queues and reject missing zones", async () => {
  const client = queueClient({ office: [] });
  const empty = await getQueueSnapshot(client, "office", 10);
  assert.deepEqual(empty.items, []);

  await assert.rejects(
    () => getQueueSnapshot(client, "missing", 10),
    (error) => error.code === "ZONE_NOT_FOUND"
  );
});
