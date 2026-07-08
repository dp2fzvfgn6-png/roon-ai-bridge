const assert = require("node:assert/strict");
const test = require("node:test");

const { changeZoneVolume } = require("../dist/roon/roonVolumeService");

function createClient(zone, onChange) {
  return {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getZone: (zoneId) => (zoneId === zone.zone_id ? zone : null),
    getTransport: () => ({
      change_volume(output, mode, value, callback) {
        onChange(output, mode, value);
        callback(false);
      }
    })
  };
}

test("applies relative volume to every grouped output and returns refreshed state", async () => {
  const zone = {
    zone_id: "grouped",
    display_name: "Grouped",
    state: "playing",
    outputs: [
      {
        output_id: "one",
        display_name: "One",
        volume: { type: "number", min: 0, max: 35, value: 20 }
      },
      {
        output_id: "two",
        display_name: "Two",
        volume: { type: "number", min: 0, max: 35, value: 10 }
      }
    ]
  };
  const calls = [];
  const client = createClient(zone, (output, mode, value) => {
    calls.push([output.output_id, mode, value]);
    output.volume.value += value;
  });

  const result = await changeZoneVolume(client, "grouped", "relative", -1);

  assert.deepEqual(calls, [
    ["one", "relative", -1],
    ["two", "relative", -1]
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.outputs.map((output) => [output.output_id, output.volume.value]),
    [
      ["one", 19],
      ["two", 9]
    ]
  );
});

test("rejects absolute and relative changes that exceed hard limits", async () => {
  const zone = {
    zone_id: "office",
    display_name: "Office",
    state: "paused",
    outputs: [
      {
        output_id: "out",
        display_name: "Output",
        volume: {
          type: "number",
          min: 0,
          max: 100,
          hard_limit_min: 5,
          hard_limit_max: 35,
          value: 34
        }
      }
    ]
  };
  const client = createClient(zone, () => {
    throw new Error("should not change volume");
  });

  await assert.rejects(
    () => changeZoneVolume(client, "office", "absolute", 36),
    (error) => error.code === "INVALID_VOLUME_VALUE"
  );
  await assert.rejects(
    () => changeZoneVolume(client, "office", "relative", 2),
    (error) => error.code === "INVALID_VOLUME_VALUE"
  );
});

test("rejects zones without volume-capable outputs", async () => {
  const zone = {
    zone_id: "silent",
    display_name: "Silent",
    state: "stopped",
    outputs: [{ output_id: "out", display_name: "Output" }]
  };

  await assert.rejects(
    () => changeZoneVolume(createClient(zone, () => {}), "silent", "relative", 1),
    (error) => error.code === "VOLUME_NOT_SUPPORTED"
  );
});
