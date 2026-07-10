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

test("search_media returns scored candidates and prefers clean matches over alternate versions", async () => {
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
  assert.equal(search.ambiguous, false);
  assert.equal(search.selection_required, false);
  assert.ok(search.recommended_result_id);
  assert.equal(search.results[0].confidence, "high");
  assert.ok(search.results[0].match_reasons.includes("playable"));
  assert.equal(search.results[1].version_hint, "live");
});

test("search_media prefers clean studio versions over playable alternate versions", async () => {
  const service = new RoonMediaService(
    createSearchClient([
      {
        title: "Repetition 3D (Binaural Version - Headphones Only)",
        subtitle: "Max Cooper",
        item_key: "binaural-key",
        hint: "action_list",
        source_context: "library"
      },
      {
        title: "Repetition",
        subtitle: "Max Cooper",
        item_key: "clean-key",
        hint: "action_list",
        source_context: "library"
      },
      {
        title: "Repetition (Josh Wink Interpretation)",
        subtitle: "Max Cooper",
        item_key: "interpretation-key",
        hint: "action_list",
        source_context: "library"
      },
      {
        title: "Repetition (Edit)",
        subtitle: "Max Cooper",
        item_key: "edit-key",
        hint: "action_list",
        source_context: "library"
      }
    ]),
    "tidal"
  );

  const search = await service.search({
    query: "Max Cooper Repetition",
    types: ["track"],
    count: 10,
    sourcePreference: "library_first"
  });

  assert.equal(search.results[0].title, "Repetition");
  assert.equal(search.results[0].roon_item_key, "clean-key");
  assert.equal(search.recommended_result_id, search.results[0].result_id);
  assert.equal(search.results[0].is_best_match, true);
  assert.equal(search.results.find((result) => result.roon_item_key === "binaural-key").version_hint, "alternate");
  assert.ok(search.results.find((result) => result.roon_item_key === "binaural-key").version_penalties.includes("binaural_version"));
  assert.equal(search.results.find((result) => result.roon_item_key === "interpretation-key").version_penalties.includes("interpretation_version"), true);
  assert.equal(search.results.find((result) => result.roon_item_key === "edit-key").version_hint, "edit");
});

test("search_media classifies remixes remasters edits and keeps selection flags coherent", async () => {
  const service = new RoonMediaService(
    createSearchClient([
      {
        title: "Angel",
        subtitle: "Massive Attack",
        item_key: "angel-clean",
        hint: "action_list",
        source_context: "library"
      },
      {
        title: "Angel (Remastered 2006)",
        subtitle: "Massive Attack",
        item_key: "angel-remaster",
        hint: "action_list",
        source_context: "library"
      },
      {
        title: "Angel (Blur Remix)",
        subtitle: "Massive Attack",
        item_key: "angel-remix",
        hint: "action_list",
        source_context: "library"
      }
    ]),
    "tidal"
  );

  const search = await service.search({
    query: "Massive Attack Angel",
    types: ["track"],
    count: 10,
    sourcePreference: "library_first"
  });

  assert.equal(search.results[0].title, "Angel");
  assert.equal(search.results[0].roon_item_key, "angel-clean");
  assert.equal(search.ambiguous, false);
  assert.equal(search.selection_required, false);
  assert.equal(search.ambiguity_reason, null);
  assert.equal(search.results.find((result) => result.roon_item_key === "angel-remix").version_hint, "remix");
  assert.equal(search.results.find((result) => result.roon_item_key === "angel-remaster").version_hint, "remaster");
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

function createAlbumDetailClient() {
  let stage = "root";
  const browse = {
    browse(opts, callback) {
      if (opts.input) {
        stage = "root";
        callback(false, { action: "list" });
        return;
      }
      if (opts.item_key === "albums-category") {
        stage = "albums";
        callback(false, { action: "list" });
        return;
      }
      if (opts.item_key === "album-key") {
        stage = "album-detail";
        callback(false, { action: "list", list: { description: "A landmark electronic album with a detailed Roon editorial overview." } });
        return;
      }
      callback(false, { action: "none" });
    },
    load(_opts, callback) {
      if (stage === "root") {
        callback(false, { list: { title: "Search", count: 1 }, items: [{ title: "Albums", item_key: "albums-category", hint: "list" }] });
        return;
      }
      if (stage === "albums") {
        callback(false, { list: { title: "Albums", count: 1 }, items: [{ title: "Kid A", subtitle: "Radiohead", item_key: "album-key", hint: "action_list", image_key: "kid-a" }] });
        return;
      }
      callback(false, {
        list: { title: "Kid A", count: 3, description: "A landmark electronic album with a detailed Roon editorial overview." },
        items: [
          { title: "Play Album", item_key: "play-album", hint: "action" },
          { title: "Everything In Its Right Place", subtitle: "Radiohead", item_key: "track-1", hint: "action_list", track_number: 1, duration_seconds: 251 },
          { title: "Kid A", subtitle: "Radiohead", item_key: "track-2", hint: "action_list", track_number: 2, duration_seconds: 284 }
        ]
      });
    }
  };
  return { isCoreConnected: () => true, isBrowseReady: () => true, getBrowse: () => browse };
}

test("album detail exposes Roon description and playable track references", async () => {
  const service = new RoonMediaService(createAlbumDetailClient(), "tidal");
  const search = await service.search({ query: "Kid A Radiohead", types: ["album"], count: 5 });
  const detail = await service.getAlbumDetail(search.results[0].result_id, undefined, 100);

  assert.equal(detail.album.title, "Kid A");
  assert.match(detail.description, /landmark electronic album/i);
  assert.deepEqual(detail.tracks.map((track) => track.title), ["Everything In Its Right Place", "Kid A"]);
  assert.equal(detail.tracks[0].album, "Kid A");
  assert.equal(detail.tracks[0].track_number, 1);
  assert.equal(detail.tracks[0].duration_seconds, 251);
});

function createArtistSearchClient(items = [{ title: "Radiohead", subtitle: "Artist", item_key: "artist-key", hint: "action_list" }]) {
  let stage = "root";
  const browse = {
    browse(opts, callback) {
      if (opts.input) { stage = "root"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "artists-category") { stage = "artists"; callback(false, { action: "list" }); return; }
      callback(false, { action: "none" });
    },
    load(_opts, callback) {
      if (stage === "root") callback(false, { list: { title: "Search", count: 1 }, items: [{ title: "Artists", item_key: "artists-category", hint: "list" }] });
      else callback(false, { list: { title: "Artists", count: items.length }, items });
    }
  };
  return { isCoreConnected: () => true, isBrowseReady: () => true, getBrowse: () => browse };
}

test("artist search filters Roon candidates that explicitly have zero albums", async () => {
  const service = new RoonMediaService(createArtistSearchClient([
    { title: "Daft Punk", subtitle: "10 Albums", item_key: "artist-real", hint: "action_list" },
    { title: "Queen vs. Daft Punk", subtitle: "0 Albums", item_key: "artist-empty", hint: "action_list" }
  ]), "tidal");
  const search = await service.search({ query: "Daft Punk", types: ["artist"], count: 10 });

  assert.deepEqual(search.results.map((result) => result.title), ["Daft Punk"]);
  assert.equal(search.results[0].content_count, 10);
  assert.match(search.warnings.join(" "), /filtered 1 result/);
});

test("artist detail groups albums and singles and keeps biography optional", async () => {
  const service = new RoonMediaService(createArtistSearchClient(), "tidal");
  const search = await service.search({ query: "Radiohead", types: ["artist"], count: 1 });
  const artist = search.results[0];
  const media = (title, media_type, subtitle) => ({ ...artist, result_id: `media-${title}`, title, type: media_type, media_type, subtitle, artist: media_type === "track" ? "Radiohead" : null });
  service.listArtistReleases = async () => ({ artist, list_title: "Radiohead", releases: [media("Kid A", "album", "2000"), media("Burn the Witch", "album", "Single · 2016")] });
  service.search = async (request) => ({ query: request.query, source_preference: "library_first", results: request.types[0] === "track" ? [media("Paranoid Android", "track", "Radiohead")] : [], ambiguous: false, ambiguity_reason: null, recommended_result_id: null, selection_required: true, warnings: [] });
  service.readArtistBio = async () => null;

  const detail = await service.getArtistDetail(artist.result_id);
  assert.equal(detail.bio, null);
  assert.deepEqual(detail.popular_tracks.map((track) => track.title), ["Paranoid Android"]);
  assert.deepEqual(detail.albums.map((album) => album.title), ["Kid A"]);
  assert.deepEqual(detail.singles_eps.map((album) => album.title), ["Burn the Witch"]);
});
