const assert = require("node:assert/strict");
const test = require("node:test");

const { applyZoneEvent } = require("../dist/roon/roonStateCache");

test("zone cache follows public subscription events without SDK private state", () => {
  let zones = applyZoneEvent(new Map(), "Subscribed", {
    zones: [{
      zone_id: "office",
      display_name: "Office",
      state: "playing",
      now_playing: { seek_position: 2 }
    }]
  });
  assert.equal(zones.get("office").state, "playing");

  zones = applyZoneEvent(zones, "Changed", {
    zones_seek_changed: [{
      zone_id: "office",
      seek_position: 12,
      queue_time_remaining: 100
    }],
    zones_added: [{ zone_id: "kitchen", display_name: "Kitchen", state: "stopped" }]
  });
  assert.equal(zones.get("office").now_playing.seek_position, 12);
  assert.equal(zones.get("kitchen").display_name, "Kitchen");

  zones = applyZoneEvent(zones, "Changed", { zones_removed: ["office"] });
  assert.equal(zones.has("office"), false);
  assert.equal(applyZoneEvent(zones, "Unsubscribed", {}).size, 0);
});
