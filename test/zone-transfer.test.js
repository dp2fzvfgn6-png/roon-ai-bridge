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

  return {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getTransport: () => ({
      transfer_zone(source, target, callback) {
        onTransfer(source, target);
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
    transferred: "queue_and_playback"
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
