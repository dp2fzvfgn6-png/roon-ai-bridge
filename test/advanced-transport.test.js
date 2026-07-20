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
    change_volume(output, mode, value, callback) {
      calls.push(["change_volume", output, mode, value]);
      output.volume.value += value * (mode === "relative_step" ? output.volume.step || 1 : 1);
      callback(false);
    },
    mute_all: done("mute_all"),
    pause_all: done("pause_all"),
    toggle_standby: done("toggle_standby"),
    change_settings: done("change_settings")
  };
  const zone = { zone_id: "zone-1", outputs: [] };
  const output = {
    output_id: "output-1",
    display_name: "Desk",
    volume: { type: "number", min: 0, max: 100, value: 20, step: 1 }
  };
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
    last_known_zone_id: null,
    can_control_volume: true,
    volume_type: "number",
    last_known_volume_type: "number",
    can_group_with_output_ids: [],
    source_controls: null,
    source_control_status: null,
    device_type: null
  }]);
  await seekZone(client, "zone-1", "relative", -15);
  await muteOutput(client, "output-1", "mute");
  const volumeResult = await changeOutputVolume(client, "output-1", "relative_step", 1);
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
  assert.equal(volumeResult.state_verified, true);
  assert.equal(volumeResult.output.volume.value, 21);
});

test("rejects invalid SDK commands for incremental outputs", async () => {
  const output = {
    output_id: "incremental",
    display_name: "IR volume",
    volume: { type: "incremental" }
  };
  const client = {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getTransport: () => ({ change_volume() { throw new Error("should not run"); } }),
    getOutput: () => output
  };

  await assert.rejects(
    () => changeOutputVolume(client, output.output_id, "relative_step", 1),
    (error) => error.code === "INVALID_VOLUME_VALUE"
  );
});
