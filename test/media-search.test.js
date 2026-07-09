const assert = require("node:assert/strict");
const test = require("node:test");

const { RoonMediaService } = require("../dist/roon/roonMediaService");

function createSearchClient(trackItems) {
  let stage = "root";
  const items = trackItems || [
    {
      title: "Everything In Its Right Place",
      subtitle: "Radiohead",
      item_key: "track-key",
      image_key: "image-key",
      hint: "action_list",
      source_context: "library"
    }
  ];
  const browse = {
    browse(opts, callback) {
      if (opts.input) {
        stage = "root";
        callback(false, { action: "list" });
        return;
      }
      if (opts.item_key === "tracks-category") {
        stage = "tracks";
        callback(false, { action: "list" });
        return;
      }
      callback(false, { action: "none" });
    },
    load(_opts, callback) {
      if (stage === "root") {
        callback(false, {
          list: { title: "Search", count: 1, level: 0 },
          items: [{ title: "Tracks", item_key: "tracks-category", hint: "list" }]
        });
        return;
      }
      callback(false, {
        list: { title: "Tracks", count: 1, level: 1 },
        items
      });
    }
  };

  return {
    isCoreConnected: () => true,
    isBrowseReady: () => true,
    getBrowse: () => browse
  };
}

test("search_media returns stable result ids and details for mocked Roon results", async () => {
  const service = new RoonMediaService(createSearchClient(), "tidal");
  const search = await service.search({
    query: "Radiohead Everything In Its Right Place",
    types: ["track"],
    count: 5,
    sourcePreference: "library_first"
  });

  assert.equal(search.query, "Radiohead Everything In Its Right Place");
  assert.equal(search.results.length, 1);
  assert.match(search.results[0].result_id, /^media_/);
  assert.equal(search.results[0].type, "track");
  assert.equal(search.results[0].media_type, "track");
  assert.equal(search.results[0].title, "Everything In Its Right Place");
  assert.equal(search.results[0].artist, "Radiohead");
  assert.equal(search.results[0].roon_item_key, "track-key");
  assert.equal(search.results[0].is_library, true);
  assert.equal("image_data_url" in search.results[0], false);

  const details = service.get(search.results[0].result_id);
  assert.deepEqual(details, search.results[0]);
});

test("media details fail clearly for expired or unknown result ids", () => {
  const service = new RoonMediaService(createSearchClient(), "tidal");
  assert.throws(
    () => service.get("media_missing"),
    (error) => error.code === "SEARCH_NO_RESULTS"
  );
});

test("search_media preserves known source, quality and album metadata in details", async () => {
  const service = new RoonMediaService(
    createSearchClient([
      {
        title: "Known Track",
        subtitle: "Known Artist",
        item_key: "known-key",
        hint: "action_list",
        media: {
          artist: "Known Artist",
          album: "Known Album",
          album_artist: "Known Album Artist",
          source: "Qobuz",
          quality: {
            label: "24-bit / 192 kHz / FLAC",
            bit_depth: 24,
            sample_rate_hz: 192000,
            format: "FLAC"
          }
        }
      }
    ]),
    "tidal"
  );

  const search = await service.search({
    query: "Known Track",
    types: ["track"],
    count: 1,
    sourcePreference: "highest_quality"
  });
  const result = search.results[0];

  assert.equal(result.source, "qobuz");
  assert.equal(result.source_confidence, "high");
  assert.equal(result.is_library, false);
  assert.equal(result.artist, "Known Artist");
  assert.equal(result.album, "Known Album");
  assert.equal(result.album_artist, "Known Album Artist");
  assert.deepEqual(result.quality, {
    label: "24-bit / 192 kHz / FLAC",
    bit_depth: 24,
    sample_rate_hz: 192000,
    format: "FLAC"
  });
  assert.deepEqual(service.get(result.result_id), result);
});

test("search_media leaves unavailable source and quality unknown without guessing", async () => {
  const service = new RoonMediaService(
    createSearchClient([
      {
        title: "Unknown Track",
        subtitle: "Unknown Artist",
        item_key: "unknown-key",
        hint: "action_list"
      }
    ]),
    null
  );

  const search = await service.search({
    query: "Unknown Track",
    types: ["track"],
    count: 1
  });
  const result = search.results[0];

  assert.equal(result.source, "unknown");
  assert.equal(result.source_confidence, "low");
  assert.equal(result.quality, null);
  assert.equal(result.is_library, null);
  assert.deepEqual(service.get(result.result_id), result);
});

test("search_media returns scored candidates and marks ambiguous close matches", async () => {
  const service = new RoonMediaService(
    createSearchClient([
      {
        title: "Red Right Hand",
        subtitle: "Nick Cave & The Bad Seeds",
        item_key: "studio-key",
        hint: "action_list",
        source_context: "library"
      },
      {
        title: "Red Right Hand - Live",
        subtitle: "Nick Cave & The Bad Seeds",
        item_key: "live-key",
        hint: "action_list",
        source_context: "library"
      }
    ]),
    "tidal"
  );

  const search = await service.search({
    query: "Red Right Hand Nick Cave",
    types: ["track"],
    count: 5,
    sourcePreference: "library_first"
  });

  assert.equal(search.results.length, 2);
  assert.equal(search.ambiguous, true);
  assert.equal(search.selection_required, true);
  assert.ok(search.recommended_result_id);
  assert.equal(search.results[0].confidence, "high");
  assert.ok(search.results[0].match_reasons.includes("playable"));
  assert.equal(search.results[1].version_hint, "live");
});

test("expand_media_search tries context-stripped searches and returns best candidates", async () => {
  const service = new RoonMediaService(
    createSearchClient([
      {
        title: "Red Right Hand",
        subtitle: "Nick Cave & The Bad Seeds",
        item_key: "red-key",
        hint: "action_list"
      }
    ]),
    null
  );

  const expanded = await service.expandSearch({
    originalQuery: "Red Right Hand Nick Cave Peaky Blinders soundtrack episode",
    types: ["track"],
    strategy: "remove_context",
    count: 5
  });

  assert.equal(expanded.ok, true);
  assert.equal(expanded.attempts.length, 1);
  assert.match(expanded.attempts[0].query, /Red Right Hand/);
  assert.doesNotMatch(expanded.attempts[0].query, /Peaky Blinders/i);
  assert.equal(expanded.best_candidates[0].title, "Red Right Hand");
});
