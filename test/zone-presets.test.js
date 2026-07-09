const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createDatabase } = require("../dist/db/database");
const { ZonePresetService } = require("../dist/services/zonePresetService");
const { listOutputs } = require("../dist/roon/roonAdvancedTransportService");

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
    { zone_id: "za", display_name: "Zone A", state: "stopped", outputs: [outputA] },
    { zone_id: "zb", display_name: "Zone B", state: "stopped", outputs: [outputB] }
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
    getZones: () => zones,
    getZone: (id) => zones.find((zone) => zone.zone_id === id) || null
  };

  try {
    const preset = service.create(client, {
      name: "Whole home",
      primary_output_id: "b",
      output_ids: ["a", "b"],
      capture_volumes: true
    });
    assert.deepEqual(preset.volume_values, { a: 22, b: 18 });
    assert.equal(preset.primary_output_id, "b");
    const result = await service.apply(client, preset.preset_id);
    assert.equal(result.state_verified, true);
    assert.deepEqual(calls[0], ["group", ["b", "a"]]);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("creates zone presets from modern grouping refs and supports dry-run reads", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-presets-modern-"));
  const config = { dataDir };
  const database = createDatabase(config);
  const service = new ZonePresetService(config, database);
  const output = {
    output_id: "out-zone",
    zone_id: "zone-modern",
    display_name: "Modern Output",
    volume: { type: "number", min: 0, max: 100, value: 20 }
  };
  const zones = [{ zone_id: "zone-modern", display_name: "Modern Zone", state: "paused", outputs: [output] }];
  const client = {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getTransport: () => ({
      group_outputs(_outputs, callback) { callback(false); },
      ungroup_outputs(_outputs, callback) { callback(false); },
      control(_zone, _command, callback) { callback(false); },
      change_volume(_output, _mode, _value, callback) { callback(false); }
    }),
    getOutput: (id) => id === output.output_id ? output : null,
    getOutputs: () => [output],
    getZones: () => zones,
    getZone: (id) => zones.find((zone) => zone.zone_id === id) || null
  };

  try {
    const byZone = service.create(client, {
      preset_id: "zone_ref",
      name: "Zone Ref",
      grouping: {
        enabled: true,
        primary_zone_ref: { type: "zone_id", value: "zone-modern" },
        members: [{ type: "zone_id", value: "zone-modern" }]
      },
      volumes: [{ target_ref: { type: "output_id", value: "out-zone" }, volume: 25 }]
    });
    assert.equal(byZone.primary_output_id, "out-zone");
    const stored = database.db.prepare("SELECT primary_output_id FROM zone_presets WHERE preset_id = ?").get("zone_ref");
    assert.equal(stored.primary_output_id, "out-zone");

    const noGrouping = service.create(client, {
      preset_id: "no_grouping",
      name: "No Grouping",
      grouping: { enabled: false, members: [{ type: "output_id", value: "missing-output" }] },
      volumes: []
    });
    assert.equal(noGrouping.grouping.enabled, false);
    assert.ok(service.list().some((preset) => preset.preset_id === "no_grouping"));
    const dryRun = await service.apply(client, "zone_ref", { dryRun: true });
    assert.equal(dryRun.dry_run, true);
    service.delete("no_grouping");
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("lists known unavailable outputs and dry-runs presets with clear warnings", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-presets-known-"));
  const config = { dataDir };
  const database = createDatabase(config);
  const service = new ZonePresetService(config, database);
  const visible = {
    output_id: "visible-output",
    zone_id: "visible-zone",
    display_name: "Visible",
    volume: { type: "number", min: 0, max: 100, value: 20 }
  };
  const unavailable = {
    output_id: "old-output",
    zone_id: "old-zone",
    display_name: "Old Output",
    currently_available: false,
    last_seen: "2026-07-09T10:00:00.000Z",
    volume: { type: "number", min: 0, max: 100, value: 18 }
  };
  const zones = [{ zone_id: "visible-zone", display_name: "Visible Zone", state: "paused", outputs: [visible] }];
  const client = {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getTransport: () => ({
      group_outputs(_outputs, callback) { callback(false); },
      ungroup_outputs(_outputs, callback) { callback(false); },
      control(_zone, _command, callback) { callback(false); },
      change_volume(_output, _mode, _value, callback) { callback(false); }
    }),
    getOutput: (id) => id === visible.output_id ? visible : null,
    getOutputs: () => [visible],
    getKnownOutputs: () => [visible, unavailable],
    getZones: () => zones,
    getZone: (id) => zones.find((zone) => zone.zone_id === id) || null
  };

  try {
    const allOutputs = listOutputs(client, { includeUnavailable: true });
    assert.equal(allOutputs.length, 2);
    assert.equal(allOutputs.find((output) => output.output_id === "old-output").currently_available, false);
    assert.equal(allOutputs.find((output) => output.output_id === "old-output").last_known_zone_id, "old-zone");
    assert.equal(allOutputs.find((output) => output.output_id === "old-output").last_known_volume_type, "number");

    const availableOnly = listOutputs(client, { includeUnavailable: false });
    assert.deepEqual(availableOnly.map((output) => output.output_id), ["visible-output"]);

    const preset = service.create(client, {
      preset_id: "known_missing_output",
      name: "Known Missing Output",
      grouping: {
        enabled: false,
        members: [{ type: "output_id", value: "old-output" }]
      },
      volumes: [{ target_ref: { type: "output_id", value: "old-output" }, volume: 22 }]
    });
    const dryRun = await service.apply(client, preset.preset_id, { dryRun: true });
    assert.equal(dryRun.dry_run, true);
    assert.ok(dryRun.warnings.some((warning) => warning.includes("old-output")));
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
