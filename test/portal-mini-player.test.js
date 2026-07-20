const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadMiniPlayerRuntime(zone) {
  const source = fs.readFileSync(path.join(__dirname, "..", "portal", "app.js"), "utf8");
  const helpers = source.slice(
    source.indexOf("function miniVolumeOutputs"),
    source.indexOf("function miniOutputPopoverOpen")
  );
  const groupStep = source.slice(
    source.indexOf("async function changeMiniZoneStep"),
    source.indexOf("async function changeMiniOutputAbsolute")
  );
  const calls = [];
  const notifications = [];
  const refreshes = [];
  const context = vm.createContext({
    activeZone: () => zone,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, body: JSON.parse(options.body) });
      return { ok: true };
    },
    console,
    notifyAction: (action, details) => notifications.push({ action, details }),
    refreshMiniOutputContext: async (selector) => refreshes.push(selector),
    state: { playerPendingUpdates: 0 },
    toast: () => { throw new Error("Unexpected toast"); }
  });
  vm.runInContext(`${helpers}\n${groupStep}\n;globalThis.miniPlayerTestApi={
    changeMiniZoneStep,
    miniOutputCanStep,
    miniOutputStepMode,
    miniVolumeOutputs
  };`, context);
  return { api: context.miniPlayerTestApi, calls, context, notifications, refreshes };
}

test("group volume buttons apply one native step to every adjustable output", async () => {
  const zone = {
    zone_id: "grouped",
    display_name: "Salón",
    outputs: [
      { output_id: "numeric", display_name: "Naim", volume: { type: "number", value: 20, min: 0, max: 100, step: 2 } },
      { output_id: "incremental", display_name: "Pulse", volume: { type: "incremental", value: 5 } },
      { output_id: "at-limit", display_name: "Subwoofer", volume: { type: "number", value: 60, min: 0, max: 60, step: 1 } },
      { output_id: "fixed", display_name: "HDMI" }
    ]
  };
  const runtime = loadMiniPlayerRuntime(zone);

  await runtime.api.changeMiniZoneStep(1);

  assert.deepEqual(runtime.calls, [
    { path: "/api/roon/outputs/numeric/volume", body: { mode: "relative_step", value: 1 } },
    { path: "/api/roon/outputs/incremental/volume", body: { mode: "relative", value: 1 } }
  ]);
  assert.equal(runtime.context.state.playerPendingUpdates, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.notifications)), [{
    action: "volume_step_group",
    details: { zone: "Salón", count: 2, direction: 1 }
  }]);
  assert.deepEqual(runtime.refreshes, ['[data-mini-zone-step="1"]']);
});

test("output step limits use each output's native step", () => {
  const runtime = loadMiniPlayerRuntime({ outputs: [] });
  const output = { volume: { type: "number", value: 58, min: 0, max: 60, step: 2 } };

  assert.equal(runtime.api.miniOutputCanStep(output, 1), true);
  output.volume.value = 60;
  assert.equal(runtime.api.miniOutputCanStep(output, 1), false);
  assert.equal(runtime.api.miniOutputCanStep(output, -1), true);
  assert.equal(runtime.api.miniOutputStepMode(output), "relative_step");
  assert.equal(runtime.api.miniOutputStepMode({ volume: { type: "incremental" } }), "relative");
});
