const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chooseMediaAction,
  inferConfiguredStreamingSource,
  inferMediaQuality,
  inferMediaSource,
  inferReleaseType,
  mediaRelevanceScore,
  scoreSearchResult,
  splitArtistCredit
} = require("../dist/roon/roonMediaService");
const { enrichBrowseItem } = require("../dist/roon/roonBrowseService");

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
  assert.deepEqual(
    inferConfiguredStreamingSource(
      enrichBrowseItem({ title: "YHLQMDLG", subtitle: "[[9936250|Bad Bunny]]" }),
      "tidal"
    ),
    { source: "tidal", confidence: "medium" }
  );
});

test("preserves Roon linked entity ids while cleaning visible catalog credits", () => {
  const item = enrichBrowseItem({
    title: "Caracal (Deluxe)",
    subtitle: "[[1673338|Disclosure]] & [[1476730|Sam Smith]]"
  });

  assert.equal(item.subtitle, "Disclosure & Sam Smith");
  assert.deepEqual(item.roon_linked_entities, [
    { id: "1673338", name: "Disclosure", field: "subtitle" },
    { id: "1476730", name: "Sam Smith", field: "subtitle" }
  ]);
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

test("recognizes accented Spanish media actions", () => {
  assert.equal(
    chooseMediaAction([{ title: "Reproducir álbum", item_key: "album-action", hint: "action" }], "album", "replace_queue").item_key,
    "album-action"
  );
  assert.equal(
    chooseMediaAction([{ title: "Reproducir canción", item_key: "track-action", hint: "action" }], "track", "replace_queue").item_key,
    "track-action"
  );
  assert.equal(
    chooseMediaAction([{ title: "Añadir al final de la cola", item_key: "append-action", hint: "action" }], "track", "append").item_key,
    "append-action"
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

test("classifies albums, EPs and singles from Roon metadata before text inference", () => {
  assert.deepEqual(inferReleaseType({ title: "EL BAIFO", media: { release_type: "Album" } }), { type: "album", source: "roon_metadata" });
  assert.deepEqual(inferReleaseType({ title: "Nuevas", release_type_context: "EP" }), { type: "ep", source: "roon_section" });
  assert.deepEqual(inferReleaseType({ title: "Example - Single" }), { type: "single", source: "inferred" });
  assert.deepEqual(inferReleaseType({ title: "Example - Single", release_type_context: "Single / EP" }), { type: "single", source: "inferred" });
  assert.deepEqual(inferReleaseType({ title: "Example EP", release_type_context: "Single / EP" }), { type: "ep", source: "inferred" });
  assert.deepEqual(inferReleaseType({ title: "Example", subtitle: "1 Track", release_type_context: "Single / EP" }), { type: "single", source: "inferred" });
  assert.deepEqual(inferReleaseType({ title: "Example", subtitle: "5 Tracks", release_type_context: "Single / EP" }), { type: "ep", source: "inferred" });
});

test("splits multi-artist credits conservatively without breaking ampersand band names", () => {
  assert.deepEqual(splitArtistCredit("Quevedo, Sech feat. Rels B"), ["Quevedo", "Sech", "Rels B"]);
  assert.deepEqual(splitArtistCredit("Nick Cave & The Bad Seeds"), ["Nick Cave & The Bad Seeds"]);
});

test("does not bias equivalent exact matches toward tracks", () => {
  const base = {
    result_id: "media_one",
    roon_item_key: "roon-key-one",
    title: "Red Right Hand",
    subtitle: "Nick Cave & the Bad Seeds",
    image_key: null,
    source: "tidal",
    source_confidence: "medium",
    quality: { label: "24-bit / 96 kHz / FLAC", bit_depth: 24, sample_rate_hz: 96000, format: "FLAC" },
    expires_at: new Date().toISOString()
  };

  const trackScore = scoreSearchResult(
    { ...base, media_type: "track", playable: true },
    {
      query: "Red Right Hand Nick Cave Bad Seeds",
      title: "Red Right Hand",
      artist: "Nick Cave & the Bad Seeds"
    }
  );
  const albumScore = scoreSearchResult(
    { ...base, result_id: "media_two", media_type: "album", playable: true },
    {
      query: "Red Right Hand Nick Cave Bad Seeds",
      title: "Red Right Hand",
      artist: "Nick Cave & the Bad Seeds"
    }
  );

  assert.equal(trackScore.score, albumScore.score);
  assert.equal(trackScore.reasons.includes("track result"), false);
  assert.ok(trackScore.reasons.includes("playable"));
});
