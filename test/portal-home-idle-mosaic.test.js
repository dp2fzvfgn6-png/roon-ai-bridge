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

function loadIdleTransitionHarness() {
  const source = fs.readFileSync(path.join(__dirname, "..", "portal", "app.js"), "utf8");
  const start = source.indexOf("const HOME_IDLE_GRACE_MS");
  const end = source.indexOf("function homeIdleLayoutEdges", start);
  assert.ok(start >= 0 && end > start, "home idle transition functions must remain extractable");
  const timers = new Map();
  let nextTimerId = 1;
  const renders = [];
  const context = vm.createContext({
    state: { view: "home", homeIdleTimer: null, homePreviewZoneId: null, zones: [{ state: "stopped" }], homePlaybackSignature: "stale" },
    setTimeout(callback, delay) { const id = nextTimerId++; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    renderHomePlayback(force) { renders.push(force); }
  });
  vm.runInContext(`${source.slice(start, end)};globalThis.idleTransition={HOME_IDLE_GRACE_MS,scheduleHomeIdleTransition,cancelHomeIdleTransition};`, context);
  return { context, timers, renders, transition: context.idleTransition };
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
  assert.equal(imageSize(500, 1), 512);
  assert.equal(imageSize(700, 2), 1280);
  assert.equal(imageSize(1200, 3), 1600);
  assert.equal(imageSize(100, 0.5), 512);
});

test("home playback waits through one transient idle publication", () => {
  const { context, timers, renders, transition } = loadIdleTransitionHarness();
  transition.scheduleHomeIdleTransition();
  transition.scheduleHomeIdleTransition();

  assert.equal(timers.size, 1);
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 2600);
  assert.deepEqual(renders, []);

  timer.callback();
  assert.equal(context.state.homePlaybackSignature, null);
  assert.deepEqual(renders, [true]);
});

test("home idle transition is cancelled when playback returns", () => {
  const { context, timers, renders, transition } = loadIdleTransitionHarness();
  transition.scheduleHomeIdleTransition();
  const timer = [...timers.values()][0];
  context.state.zones[0].state = "playing";
  timer.callback();

  assert.deepEqual(renders, []);
  assert.equal(context.state.homeIdleTimer, null);
});
