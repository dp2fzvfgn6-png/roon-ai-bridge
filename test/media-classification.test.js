const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chooseMediaAction,
  inferConfiguredStreamingSource,
  inferMediaQuality,
  inferMediaSource,
  mediaRelevanceScore
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

test("classifies Roon linked catalog results using configured streaming source", () => {
  assert.deepEqual(
    inferConfiguredStreamingSource(
      {
        title: "YHLQMDLG",
        subtitle: "[[9936250|Bad Bunny]]"
      },
      "tidal"
    ),
    {
      source: "tidal",
      confidence: "medium"
    }
  );
});

test("keeps artist catalog playback separate from artist radio", () => {
  const actions = [
    { title: "Shuffle", item_key: "1:0", hint: "action" },
    { title: "Start Radio", item_key: "1:1", hint: "action" }
  ];

  assert.equal(
    chooseMediaAction(actions, "artist", "replace_queue", "catalog").title,
    "Shuffle"
  );
  assert.equal(
    chooseMediaAction(actions, "artist", "replace_queue", "radio").title,
    "Start Radio"
  );
});

test("ranks matching artist metadata above an unrelated exact album title", () => {
  const unrelatedAlbum = {
    result_id: "one",
    media_type: "album",
    title: "Bad Bunny",
    subtitle: "[[30115166|Maleigh Zan]]",
    image_key: null,
    source: "tidal",
    source_confidence: "medium",
    quality: null,
    playable: true,
    expires_at: new Date().toISOString()
  };
  const artistAlbum = {
    ...unrelatedAlbum,
    result_id: "two",
    title: "YHLQMDLG",
    subtitle: "[[9936250|Bad Bunny]]"
  };

  assert.ok(
    mediaRelevanceScore(artistAlbum, "Bad Bunny") >
      mediaRelevanceScore(unrelatedAlbum, "Bad Bunny")
  );
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

test("uses inherited browse section source context", () => {
  assert.deepEqual(
    inferMediaSource({
      title: "Example Track",
      subtitle: "Example Artist",
      source_context: "tidal"
    }),
    {
      source: "tidal",
      confidence: "high"
    }
  );
});
