const test = require("node:test");
const assert = require("node:assert/strict");
const { controlPlayback } = require("../dist/roon/roonPlaybackService");

test("returns the verified final state for a play command", async () => {
  const zone = {
    zone_id: "office",
    display_name: "Despacho",
    state: "paused",
    outputs: [],
    is_play_allowed: true
  };
  const client = {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getZone: (zoneId) => (zoneId === zone.zone_id ? zone : null),
    getTransport: () => ({
      control(receivedZone, command, callback) {
        assert.equal(receivedZone, zone);
        assert.equal(command, "play");
        zone.state = "playing";
        callback(false);
      }
    })
  };

  assert.deepEqual(await controlPlayback(client, "office", "play"), {
    ok: true,
    zone_id: "office",
    zone_name: "Despacho",
    command: "play",
    previous_state: "paused",
    state: "playing",
    state_verified: true
  });
});
