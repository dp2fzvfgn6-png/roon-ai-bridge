const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inferMediaQuality,
  inferMediaSource
} = require("../dist/roon/roonMediaService");

test("classifies TIDAL and high-resolution quality metadata", () => {
  const item = {
    title: "Example Album",
    subtitle: "TIDAL · FLAC 24-bit 96 kHz"
  };

  assert.deepEqual(inferMediaSource(item), {
    source: "tidal",
    confidence: "high"
  });
  assert.deepEqual(inferMediaQuality(item), {
    label: "24-bit / 96 kHz / FLAC",
    bit_depth: 24,
    sample_rate_hz: 96000,
    format: "FLAC"
  });
});

test("keeps unknown source and quality explicit", () => {
  const item = {
    title: "Example Track",
    subtitle: "Example Artist"
  };

  assert.deepEqual(inferMediaSource(item), {
    source: "unknown",
    confidence: "low"
  });
  assert.equal(inferMediaQuality(item), null);
});
