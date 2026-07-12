const test = require("node:test");
const assert = require("node:assert/strict");
const { transferZonePlayback } = require("../dist/roon/roonTransferService");

function createClient(onTransfer) {
  const zones = new Map([
    [
      "office",
      {
        zone_id: "office",
        display_name: "Despacho",
        state: "playing",
        outputs: []
      }
    ],
    [
      "kitchen",
      {
        zone_id: "kitchen",
        display_name: "Cocina",
        state: "stopped",
        outputs: []
      }
    ]
  ]);
  const queues = new Map([
    ["office", [{ queue_item_id: 1, title: "Track one", subtitle: "Artist" }]],
    ["kitchen", []]
  ]);

  return {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getTransport: () => ({
      subscribe_queue(zone, count, callback) {
        callback("Subscribed", { items: (queues.get(zone.zone_id) || []).slice(0, count) });
        return { unsubscribe(done) { if (done) done(); } };
      },
      transfer_zone(source, target, callback) {
        onTransfer(source, target);
        target.state = source.state;
        target.now_playing = source.now_playing;
        queues.set(target.zone_id, [...(queues.get(source.zone_id) || [])]);
        callback(false);
      }
    }),
    getZone: (zoneId) => zones.get(zoneId) || null
  };
}

test("transfers the native Roon queue and playback between zones", async () => {
  const calls = [];
  const client = createClient((source, target) => calls.push({ source, target }));

  const result = await transferZonePlayback(client, "office", "kitchen");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].source.zone_id, "office");
  assert.equal(calls[0].target.zone_id, "kitchen");
  assert.deepEqual(result, {
    ok: true,
    source_zone_id: "office",
    source_zone_name: "Despacho",
    target_zone_id: "kitchen",
    target_zone_name: "Cocina",
    transferred: "queue_and_playback",
    state_verified: true,
    final_target_state: calls[0].target
  });
});

test("rejects a transfer to the same zone before calling Roon", async () => {
  let called = false;
  const client = createClient(() => {
    called = true;
  });

  await assert.rejects(
    () => transferZonePlayback(client, "office", "office"),
    (error) =>
      error.code === "UNSUPPORTED_COMMAND" &&
      error.message === "Source and target zones must be different"
  );
  assert.equal(called, false);
});
