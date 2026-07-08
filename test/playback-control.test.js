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
    status: "changed",
    previous_state: "paused",
    state: "playing",
    state_verified: true
  });
});

test("pause is idempotent when the zone is already paused", async () => {
  let called = false;
  const zone = {
    zone_id: "office",
    display_name: "Despacho",
    state: "paused",
    outputs: [],
    is_pause_allowed: false
  };
  const client = {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getZone: (zoneId) => (zoneId === zone.zone_id ? zone : null),
    getTransport: () => ({
      control() {
        called = true;
      }
    })
  };

  assert.deepEqual(await controlPlayback(client, "office", "pause"), {
    ok: true,
    zone_id: "office",
    zone_name: "Despacho",
    command: "pause",
    status: "already_paused",
    previous_state: "paused",
    state: "paused",
    state_verified: true
  });
  assert.equal(called, false);
});

test("play is idempotent when the zone is already playing", async () => {
  const zone = {
    zone_id: "office",
    display_name: "Despacho",
    state: "playing",
    outputs: [],
    is_play_allowed: false
  };
  const client = {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getZone: (zoneId) => (zoneId === zone.zone_id ? zone : null),
    getTransport: () => ({
      control() {
        throw new Error("should not be called");
      }
    })
  };

  const result = await controlPlayback(client, "office", "play");
  assert.equal(result.status, "already_playing");
  assert.equal(result.state_verified, true);
});
