const test = require("node:test");
const assert = require("node:assert/strict");
const {
  groupZones,
  ungroupZone,
  validateGroupCompatibility
} = require("../dist/roon/roonGroupingService");

function output(id, name, compatibleIds) {
  return {
    output_id: id,
    display_name: name,
    can_group_with_output_ids: compatibleIds
  };
}

function createGroupingClient() {
  const allIds = ["office-output", "kitchen-output", "living-output"];
  let zones = [
    {
      zone_id: "office",
      display_name: "Despacho",
      state: "paused",
      outputs: [output(allIds[0], "Despacho", allIds)]
    },
    {
      zone_id: "kitchen",
      display_name: "Cocina",
      state: "paused",
      outputs: [output(allIds[1], "Cocina", allIds)]
    },
    {
      zone_id: "living",
      display_name: "Salon",
      state: "paused",
      outputs: [output(allIds[2], "Salon", allIds)]
    }
  ];
  const calls = [];

  const client = {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getZones: () => zones,
    getZone: (zoneId) => zones.find((zone) => zone.zone_id === zoneId) || null,
    getTransport: () => ({
      group_outputs(outputs, callback) {
        calls.push({ operation: "group", outputIds: outputs.map((item) => item.output_id) });
        zones = [
          {
            zone_id: "office",
            display_name: "Despacho + 2",
            state: "paused",
            outputs
          }
        ];
        callback(false);
      },
      ungroup_outputs(outputs, callback) {
        calls.push({ operation: "ungroup", outputIds: outputs.map((item) => item.output_id) });
        zones = outputs.map((item) => ({
          zone_id: item.output_id.replace("-output", ""),
          display_name: item.display_name,
          state: "paused",
          outputs: [item]
        }));
        callback(false);
      }
    })
  };

  return { client, calls };
}

test("groups zones with the primary output first and verifies the final group", async () => {
  const { client, calls } = createGroupingClient();

  const result = await groupZones(client, "office", ["kitchen", "living"]);

  assert.deepEqual(calls[0], {
    operation: "group",
    outputIds: ["office-output", "kitchen-output", "living-output"]
  });
  assert.equal(result.primary_zone_name, "Despacho");
  assert.equal(result.grouped_zone_name, "Despacho + 2");
  assert.equal(result.members.length, 3);
  assert.equal(result.state_verified, true);
});

test("fully ungroups every output and verifies independent zones", async () => {
  const { client, calls } = createGroupingClient();
  await groupZones(client, "office", ["kitchen", "living"]);

  const result = await ungroupZone(client, "office");

  assert.equal(calls[1].operation, "ungroup");
  assert.equal(result.separated_outputs.length, 3);
  assert.equal(result.state_verified, true);
  assert.equal(client.getZones().every((zone) => zone.outputs.length === 1), true);
});

test("rejects outputs that do not advertise mutual grouping compatibility", () => {
  assert.throws(
    () =>
      validateGroupCompatibility([
        output("one", "One", ["one"]),
        output("two", "Two", ["two"])
      ]),
    (error) => error.code === "OUTPUTS_NOT_GROUPABLE"
  );
});
