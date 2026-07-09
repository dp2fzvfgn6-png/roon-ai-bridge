const assert = require("node:assert/strict");
const test = require("node:test");

const {
  changeZoneSettings,
  changeOutputVolume,
  listOutputs,
  muteAll,
  muteOutput,
  outputPowerAction,
  pauseAll,
  seekZone
} = require("../dist/roon/roonAdvancedTransportService");

test("maps advanced transport actions to the native Roon SDK", async () => {
  const calls = [];
  const done = (name) => (...args) => {
    calls.push([name, ...args.slice(0, -1)]);
    args.at(-1)(false);
  };
  const transport = {
    seek: done("seek"),
    mute: done("mute"),
    change_volume: done("change_volume"),
    mute_all: done("mute_all"),
    pause_all: done("pause_all"),
    toggle_standby: done("toggle_standby"),
    change_settings: done("change_settings")
  };
  const zone = { zone_id: "zone-1", outputs: [] };
  const output = { output_id: "output-1", display_name: "Desk" };
  const client = {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getTransport: () => transport,
    getZone: (id) => (id === zone.zone_id ? zone : null),
    getOutput: (id) => (id === output.output_id ? output : null),
    getOutputs: () => [output]
  };

  assert.deepEqual(listOutputs(client), [{
    ...output,
    currently_available: true,
    last_seen: null,
    can_control_volume: false,
    volume_type: null,
    can_group_with_output_ids: [],
    source_control_status: null,
    device_type: null
  }]);
  await seekZone(client, "zone-1", "relative", -15);
  await muteOutput(client, "output-1", "mute");
  await changeOutputVolume(client, "output-1", "relative_step", 1);
  await muteAll(client, "unmute");
  await pauseAll(client);
  await outputPowerAction(client, "output-1", "toggle_standby");
  await changeZoneSettings(client, "zone-1", {
    shuffle: true,
    auto_radio: false,
    loop: "loop"
  });

  assert.deepEqual(calls.map((call) => call[0]), [
    "seek",
    "mute",
    "change_volume",
    "mute_all",
    "pause_all",
    "toggle_standby",
    "change_settings"
  ]);
  assert.deepEqual(calls.at(-1)[2], {
    shuffle: true,
    auto_radio: false,
    loop: "loop"
  });
});
