const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadLayoutFunction() {
  const source = fs.readFileSync(path.join(__dirname, "..", "portal", "app.js"), "utf8");
  const start = source.indexOf("function homeIdleLayoutEdges");
  const end = source.indexOf("function stopHomeIdleMosaic", start);
  assert.ok(start >= 0 && end > start, "home idle layout function must remain extractable");
  const context = vm.createContext({});
  vm.runInContext(`${source.slice(start, end)};globalThis.layout=homeIdleLayoutEdges;`, context);
  return (count, activeIndex = null) => Array.from(context.layout(count, activeIndex));
}

test("idle mosaic creates one fewer shared boundary than zones", () => {
  const layout = loadLayoutFunction();
  assert.deepEqual(layout(1), [0, 1]);
  assert.deepEqual(layout(2), [0, 0.5, 1]);
  assert.deepEqual(layout(4), [0, 0.25, 0.5, 0.75, 1]);
});

test("hovered idle zone expands while every zone keeps a positive share", () => {
  const layout = loadLayoutFunction();
  const resting = layout(4);
  const focused = layout(4, 1);
  const widths = focused.slice(1).map((edge, index) => edge - focused[index]);

  assert.ok(widths[1] > resting[2] - resting[1]);
  assert.ok(widths.every((width) => width > 0));
  assert.ok(Math.abs(widths.reduce((total, width) => total + width, 0) - 1) < Number.EPSILON * 8);
});
