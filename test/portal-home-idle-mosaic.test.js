const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadMosaicGeometry() {
  const source = fs.readFileSync(path.join(__dirname, "..", "portal", "app.js"), "utf8");
  const start = source.indexOf("function homeIdleLayoutEdges");
  const end = source.indexOf("function stopHomeIdleMosaic", start);
  assert.ok(start >= 0 && end > start, "home idle layout function must remain extractable");
  const context = vm.createContext({});
  vm.runInContext(`${source.slice(start, end)};globalThis.mosaicGeometry={homeIdleLayoutEdges,homeIdleArtworkShare,homeIdleImageRequestSize};`, context);
  return {
    layout: (count, activeIndex = null) => Array.from(context.mosaicGeometry.homeIdleLayoutEdges(count, activeIndex)),
    artworkShare: context.mosaicGeometry.homeIdleArtworkShare,
    imageSize: context.mosaicGeometry.homeIdleImageRequestSize
  };
}

test("idle mosaic creates one fewer shared boundary than zones", () => {
  const { layout } = loadMosaicGeometry();
  assert.deepEqual(layout(1), [0, 1]);
  assert.deepEqual(layout(2), [0, 0.5, 1]);
  assert.deepEqual(layout(4), [0, 0.25, 0.5, 0.75, 1]);
});

test("hovered idle zone expands while every zone keeps a positive share", () => {
  const { layout } = loadMosaicGeometry();
  const resting = layout(4);
  const focused = layout(4, 1);
  const widths = focused.slice(1).map((edge, index) => edge - focused[index]);

  assert.ok(widths[1] > resting[2] - resting[1]);
  assert.ok(widths.every((width) => width > 0));
  assert.ok(Math.abs(widths.reduce((total, width) => total + width, 0) - 1) < Number.EPSILON * 8);
});

test("static artwork covers every resting and expanded boundary position", () => {
  const { layout, artworkShare } = loadMosaicGeometry();
  const count = 4;
  const layouts = [layout(count), ...Array.from({ length: count }, (_, index) => layout(count, index))];

  for (let zoneIndex = 0; zoneIndex < count; zoneIndex += 1) {
    const center = (zoneIndex + 0.5) / count;
    const halfArtwork = artworkShare(count, zoneIndex) / 2;
    for (const edges of layouts) {
      assert.ok(center - halfArtwork <= edges[zoneIndex]);
      assert.ok(center + halfArtwork >= edges[zoneIndex + 1]);
    }
  }
});

test("idle artwork requests follow rendered pixels with bounded density", () => {
  const { imageSize } = loadMosaicGeometry();
  assert.equal(imageSize(500, 1), 640);
  assert.equal(imageSize(700, 2), 1408);
  assert.equal(imageSize(1200, 3), 1920);
  assert.equal(imageSize(100, 0.5), 640);
});
