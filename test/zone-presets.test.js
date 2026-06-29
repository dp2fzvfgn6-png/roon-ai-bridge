const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createDatabase } = require("../dist/db/database");
const { ZonePresetService } = require("../dist/services/zonePresetService");

test("stores and applies a zone preset with primary output first", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-presets-"));
  const config = { dataDir };
  const database = createDatabase(config);
  const service = new ZonePresetService(config, database);
  const outputA = {
    output_id: "a",
    display_name: "A",
    can_group_with_output_ids: ["b"],
    volume: { value: 22 }
  };
  const outputB = {
    output_id: "b",
    display_name: "B",
    can_group_with_output_ids: ["a"],
    volume: { value: 18 }
  };
  let zones = [
    { zone_id: "za", state: "stopped", outputs: [outputA] },
    { zone_id: "zb", state: "stopped", outputs: [outputB] }
  ];
  const calls = [];
  const transport = {
    group_outputs(outputs, callback) {
      calls.push(["group", outputs.map((item) => item.output_id)]);
      zones = [{ zone_id: "grouped", state: "stopped", outputs }];
      callback(false);
    },
    ungroup_outputs(_outputs, callback) { callback(false); },
    control(_zone, _command, callback) { callback(false); },
    change_volume(output, _mode, value, callback) {
      calls.push(["volume", output.output_id, value]);
      callback(false);
    }
  };
  const client = {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getTransport: () => transport,
    getOutput: (id) => ({ a: outputA, b: outputB })[id] || null,
    getOutputs: () => [outputA, outputB],
    getZones: () => zones
  };

  try {
    const preset = service.create(client, {
      name: "Whole home",
      primary_output_id: "b",
      output_ids: ["a", "b"],
      capture_volumes: true
    });
    assert.deepEqual(preset.volume_values, { a: 22, b: 18 });
    const result = await service.apply(client, preset.preset_id);
    assert.equal(result.state_verified, true);
    assert.deepEqual(calls[0], ["group", ["b", "a"]]);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
