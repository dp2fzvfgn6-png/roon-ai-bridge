const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadCollageRuntime() {
  const source = fs.readFileSync(path.join(__dirname, "..", "portal", "app.js"), "utf8");
  const prefix = source.slice(0, source.indexOf("function enhancePlaylistTrackActions"));
  const collages = [];
  const intervals = [];
  const document = {
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "[data-collage-keys]" ? collages : []
  };
  const context = vm.createContext({
    console,
    document,
    fetch: async () => { throw new Error("Unexpected fetch"); },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Math: Object.create(Math),
    sessionStorage: { getItem: () => null },
    setInterval: (callback, delay) => intervals.push({ callback, delay }),
    URL: { createObjectURL: () => "blob:artwork" }
  });
  vm.runInContext(`${prefix}\n;globalThis.collageTestApi = {
    animatePlaylistCollages,
    playlistArtwork,
    setLoadImage: (loader) => { loadImage = loader; }
  };`, context);
  return { api: context.collageTestApi, collages, context, intervals };
}

function fakeImage(key) {
  return {
    dataset: { imageKey: key, imageSize: "500", imageScale: "fill" },
    src: `old:${key}`
  };
}

function fakeCollage(keys, columns) {
  const images = keys.slice(0, columns * columns).map(fakeImage);
  return {
    classList: { contains: (name) => name === `collage-${columns}x${columns}` },
    dataset: {
      collageAnimating: "false",
      collageKeys: JSON.stringify(keys),
      collagePositionBag: "[]"
    },
    images,
    querySelectorAll: (selector) => selector === "img[data-collage-slot]" ? images : []
  };
}

function changedIndexes(before, images) {
  return images.flatMap((image, index) => image.dataset.imageKey === before[index] ? [] : [index]);
}

test("playlist collages deduplicate artwork before choosing a full grid", () => {
  const { api } = loadCollageRuntime();
  const tracks = [
    ...Array.from({ length: 16 }, () => ({ image_key: "repeated" })),
    ...Array.from({ length: 16 }, (_, index) => ({ image_key: `unique-${index}` }))
  ];
  const html = api.playlistArtwork({ name: "Mix", tracks }, "Mix");
  const visibleKeys = [...html.matchAll(/data-image-key="([^"]+)"/g)].map((match) => match[1]);

  assert.match(html, /collage-4x4/);
  assert.equal(visibleKeys.length, 16);
  assert.equal(new Set(visibleKeys).size, 16);
});

test("2x2 and 3x3 collages change one random non-repeating position", async () => {
  for (const { columns, total } of [{ columns: 2, total: 5 }, { columns: 3, total: 10 }]) {
    const { api, collages } = loadCollageRuntime();
    api.setLoadImage(async (key) => `loaded:${key}`);
    const keys = Array.from({ length: total }, (_, index) => `cover-${index}`);
    const collage = fakeCollage(keys, columns);
    collages.push(collage);

    const firstBefore = collage.images.map((image) => image.dataset.imageKey);
    await api.animatePlaylistCollages();
    const firstChanged = changedIndexes(firstBefore, collage.images);
    assert.equal(firstChanged.length, 1);
    assert.equal(new Set(collage.images.map((image) => image.dataset.imageKey)).size, columns * columns);

    const secondBefore = collage.images.map((image) => image.dataset.imageKey);
    await api.animatePlaylistCollages();
    const secondChanged = changedIndexes(secondBefore, collage.images);
    assert.equal(secondChanged.length, 1);
    assert.notEqual(secondChanged[0], firstChanged[0]);
  }
});

test("4x4 collages change exactly two positions without creating duplicates", async () => {
  const { api, collages } = loadCollageRuntime();
  api.setLoadImage(async (key) => `loaded:${key}`);
  const keys = Array.from({ length: 16 }, (_, index) => `cover-${index}`);
  const collage = fakeCollage(keys, 4);
  collages.push(collage);
  const before = collage.images.map((image) => image.dataset.imageKey);

  await api.animatePlaylistCollages();

  assert.equal(changedIndexes(before, collage.images).length, 2);
  assert.equal(new Set(collage.images.map((image) => image.dataset.imageKey)).size, 16);
});

test("collage replacement keeps every old image visible when loading fails", async () => {
  const { api, collages } = loadCollageRuntime();
  api.setLoadImage(async () => { throw new Error("Artwork unavailable"); });
  const collage = fakeCollage(["one", "two", "three", "four", "five"], 2);
  collages.push(collage);
  const keysBefore = collage.images.map((image) => image.dataset.imageKey);
  const sourcesBefore = collage.images.map((image) => image.src);

  await api.animatePlaylistCollages();

  assert.deepEqual(collage.images.map((image) => image.dataset.imageKey), keysBefore);
  assert.deepEqual(collage.images.map((image) => image.src), sourcesBefore);
});

test("playlist collage rotation is scheduled every two seconds", () => {
  const { intervals } = loadCollageRuntime();
  assert.ok(intervals.some(({ delay }) => delay === 2000));
});
