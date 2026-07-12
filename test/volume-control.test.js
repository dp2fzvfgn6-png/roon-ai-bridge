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
  assert.equal(result.state_verified, true);
  assert.deepEqual(
    result.outputs.map((output) => [output.output_id, output.volume.value]),
    [
      ["one", 19],
      ["two", 9]
    ]
  );
});

test("incremental outputs only accept relative -1 or 1 commands", async () => {
  const zone = {
    zone_id: "incremental",
    display_name: "Incremental",
    state: "paused",
    outputs: [{
      output_id: "inc",
      display_name: "IR volume",
      volume: { type: "incremental" }
    }]
  };
  const client = createClient(zone, () => {
    throw new Error("invalid incremental command reached Roon");
  });

  await assert.rejects(
    () => changeZoneVolume(client, "incremental", "relative_step", 1),
    (error) => error.code === "INVALID_VOLUME_VALUE"
  );
  await assert.rejects(
    () => changeZoneVolume(client, "incremental", "relative", 2),
    (error) => error.code === "INVALID_VOLUME_VALUE"
  );
});

test("reports outputs already changed when a grouped volume mutation partially fails", async () => {
  const zone = {
    zone_id: "grouped",
    display_name: "Grouped",
    state: "paused",
    outputs: [
      { output_id: "one", display_name: "One", volume: { type: "number", min: 0, max: 50, value: 10 } },
      { output_id: "two", display_name: "Two", volume: { type: "number", min: 0, max: 50, value: 10 } }
    ]
  };
  const client = createClient(zone, (output) => {
    if (output.output_id === "two") return;
    output.volume.value += 1;
  });
  client.getTransport = () => ({
    change_volume(output, mode, value, callback) {
      if (output.output_id === "two") callback("Failure");
      else {
        output.volume.value += value;
        callback(false);
      }
    }
  });

  await assert.rejects(
    () => changeZoneVolume(client, "grouped", "relative", 1),
    (error) =>
      error.details.partially_applied === true &&
      error.details.applied_output_ids[0] === "one"
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

test("dry-run exposes normalized volume context and configured active limit id", async () => {
  const zone = {
    zone_id: "office",
    display_name: "Office",
    state: "paused",
    outputs: [
      {
        output_id: "out",
        display_name: "Output",
        volume: { type: "number", min: 0, max: 100, value: 34 }
      }
    ]
  };
  const result = await changeZoneVolume(createClient(zone, () => {
    throw new Error("dry-run should not change volume");
  }), "office", "absolute", 50, {
    dryRun: true,
    volumeLimits: [{
      output_id: "out",
      output_name: null,
      zone_name: null,
      safe_max: 40,
      limit_id: "out-safe",
      source_type: "output_id",
      limits: [{ name: "safe", from: null, to: null, safe_max: 40 }]
    }]
  });

  assert.equal(result.volume_policy.outputs[0].active_limit_id, "out-safe");
  assert.equal(result.volume_policy.outputs[0].safe_limit_source, "output_id");
  assert.equal(result.after.outputs[0].normalized_volume.volume_type, "number");
  assert.equal(result.after.outputs[0].normalized_volume.normalized_percent, 34);
});
