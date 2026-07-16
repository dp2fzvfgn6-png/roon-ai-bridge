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
  assert.equal(search.available_counts.track, 1);
  assert.equal("image_data_url" in search.results[0], false);

  const details = service.get(search.results[0].result_id);
  assert.deepEqual(details, search.results[0]);
});

test("search_media reports and can index more than the initial portal result window", async () => {
  let stage = "root";
  const allTracks = Array.from({ length: 40 }, (_, index) => ({
    title: `Result ${index + 1}`,
    subtitle: "Indexed Artist",
    item_key: `indexed-${index + 1}`,
    hint: "action_list"
  }));
  const browse = {
    browse(opts, callback) {
      if (opts.input) { stage = "root"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "tracks-category") { stage = "tracks"; callback(false, { action: "list" }); return; }
      callback(false, { action: "none" });
    },
    load(opts, callback) {
      if (stage === "root") { callback(false, { list: { title: "Search", count: 1 }, items: [{ title: "Tracks", item_key: "tracks-category", hint: "list" }] }); return; }
      const offset = opts.offset || 0;
      callback(false, { list: { title: "Tracks", count: allTracks.length }, items: allTracks.slice(offset, offset + (opts.count || 10)) });
    }
  };
  const service = new RoonMediaService({ isCoreConnected: () => true, isBrowseReady: () => true, getBrowse: () => browse }, "tidal");

  const initial = await service.search({ query: "Result", types: ["track"], count: 12 });
  const indexed = await service.search({ query: "Result", types: ["track"], count: 40 });

  assert.equal(initial.results.length, 12);
  assert.equal(initial.available_counts.track, 40);
  assert.equal(indexed.results.length, 40);
  assert.equal(indexed.available_counts.track, 40);
});

test("search_media removes Roon internal link ids from visible metadata", async () => {
  const service = new RoonMediaService(createSearchClient([{
    title: "Space 1.8",
    subtitle: "[[2562426|Nala Sinephro]]",
    item_key: "linked-track",
    hint: "action_list",
    media: {
      artist: "[[2562426|Nala Sinephro]]",
      album: "[[30548830|Space 1.8]]",
      album_artist: "[[2562426|Nala Sinephro]]"
    }
  }]), "tidal");

  const search = await service.search({ query: "Space 1.8", types: ["track"], count: 1 });
  const result = search.results[0];

  assert.equal(result.title, "Space 1.8");
  assert.equal(result.subtitle, "Nala Sinephro");
  assert.equal(result.artist, "Nala Sinephro");
  assert.equal(result.album, "Space 1.8");
  assert.equal(result.album_artist, "Nala Sinephro");
});

test("search_media preserves each structured artist as an independent entity link", async () => {
  const service = new RoonMediaService(createSearchClient([{
    title: "TE FALLÉ",
    subtitle: "Quevedo, Sech",
    item_key: "multi-artist-track",
    hint: "action_list",
    media: {
      artist: "Quevedo, Sech",
      artists: [{ name: "Quevedo" }, { name: "Sech" }]
    }
  }]), "tidal");
  const result = (await service.search({ query: "TE FALLÉ", types: ["track"], count: 5 })).results[0];
  assert.deepEqual(result.artists.map((artist) => artist.title), ["Quevedo", "Sech"]);
  assert.deepEqual(result.links.artists.map((artist) => artist.title), ["Quevedo", "Sech"]);
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

function createMultiTypeSearchClient({ direct = [], artist = [], album = [], track = [], playlist = [] }) {
  const stages = new Map();
  const titles = { artist: "Artists", album: "Albums", track: "Tracks", playlist: "Playlists" };
  const collections = { artist, album, track, playlist };
  const browse = {
    browse(opts, callback) {
      const session = opts.multi_session_key || "default";
      if (opts.input) { stages.set(session, "root"); callback(false, { action: "list" }); return; }
      const match = Object.keys(titles).find((type) => opts.item_key === `${type}-category`);
      if (match) { stages.set(session, match); callback(false, { action: "list" }); return; }
      callback(false, { action: "none" });
    },
    load(opts, callback) {
      const stage = stages.get(opts.multi_session_key || "default") || "root";
      if (stage === "root") {
        callback(false, { list: { title: "Search" }, items: [
          ...direct,
          ...Object.keys(titles).map((type) => ({ title: titles[type], item_key: `${type}-category`, hint: "list" }))
        ] });
        return;
      }
      callback(false, { list: { title: titles[stage] }, items: collections[stage] });
    }
  };
  return { isCoreConnected: () => true, isBrowseReady: () => true, getBrowse: () => browse };
}

test("multi-type search runs independent Roon sessions concurrently", async () => {
  const stages=new Map();let active=0;let peak=0;
  const titles={artist:"Artists",album:"Albums",track:"Tracks",playlist:"Playlists"};
  const browse={
    browse(opts,callback){const session=opts.multi_session_key;if(opts.input){stages.set(session,"root");callback(false,{action:"list"});return;}const type=Object.keys(titles).find((key)=>opts.item_key===`${key}-category`);if(type){stages.set(session,type);callback(false,{action:"list"});return;}callback(false,{action:"none"});},
    load(opts,callback){const stage=stages.get(opts.multi_session_key);if(stage==="root"){callback(false,{list:{title:"Search",count:4},items:Object.entries(titles).map(([type,title])=>({title,item_key:`${type}-category`,hint:"list"}))});return;}active+=1;peak=Math.max(peak,active);setTimeout(()=>{active-=1;callback(false,{list:{title:titles[stage],count:1},items:[{title:`${stage} result`,subtitle:"Example",item_key:`${stage}-result`,hint:"action_list"}]});},20);}
  };
  const service=new RoonMediaService({isCoreConnected:()=>true,isBrowseReady:()=>true,getBrowse:()=>browse},"tidal");
  const search=await service.search({query:"Example",types:["artist","album","track","playlist"],count:1});
  assert.equal(search.results.length,4);
  assert.equal(peak,4);
});

test("best match follows Roon direct result and resolves entity priority deterministically", async (t) => {
  await t.test("Bad Bunny selects the artist even when Roon reports zero albums", async () => {
    const service = new RoonMediaService(createMultiTypeSearchClient({
      direct: [{ title: "Bad Bunny", subtitle: "4 Albums", item_key: "direct-bad", image_key: "bad-image", hint: "action_list" }],
      artist: [{ title: "Bad Bunny", subtitle: "0 Albums", item_key: "artist-bad", image_key: "bad-image", hint: "action_list" }],
      album: [{ title: "Bad Bunny Hits", subtitle: "Various Artists", item_key: "album-hits", hint: "action_list" }]
    }), "tidal");
    const search = await service.search({ query: "Bad Bunny", types: ["artist", "album", "track"] });
    assert.equal(search.best_match.media_type, "artist");
    assert.equal(search.best_match.title, "Bad Bunny");
    assert.equal(search.groups.artist[0].content_count, 0);
  });

  await t.test("El Baifo selects the release above its same-title track", async () => {
    const service = new RoonMediaService(createMultiTypeSearchClient({
      direct: [{ title: "EL BAIFO", subtitle: "Quevedo", item_key: "direct-baifo", image_key: "baifo", hint: "action_list" }],
      album: [{ title: "EL BAIFO", subtitle: "Quevedo", item_key: "album-baifo", image_key: "baifo", hint: "action_list", media: { release_type: "Album", artist: "Quevedo" } }],
      track: [{ title: "EL BAIFO", subtitle: "Quevedo", item_key: "track-baifo", image_key: "baifo", hint: "action_list" }]
    }), "tidal");
    const search = await service.search({ query: "El Baifo", types: ["artist", "album", "track"] });
    assert.equal(search.best_match.media_type, "album");
    assert.equal(search.best_match.release_type, "album");
  });

  await t.test("La Mudanza selects Bad Bunny's popular direct track over namesakes", async () => {
    const service = new RoonMediaService(createMultiTypeSearchClient({
      direct: [{ title: "LA MuDANZA", subtitle: "Bad Bunny", item_key: "direct-mudanza", image_key: "mudanza", hint: "action_list" }],
      album: [{ title: "La Mudanza", subtitle: "Otro Artista", item_key: "album-other", image_key: "other-album", hint: "action_list" }],
      track: [
        { title: "La Mudanza", subtitle: "Otro Artista", item_key: "track-other", image_key: "other-track", hint: "action_list" },
        { title: "LA MuDANZA", subtitle: "Bad Bunny", item_key: "track-bad", image_key: "mudanza", hint: "action_list", media: { artist: "Bad Bunny", album: "DeBÍ TiRAR MáS FOToS" } }
      ]
    }), "tidal");
    const search = await service.search({ query: "La Mudanza", types: ["artist", "album", "track"] });
    assert.equal(search.best_match.media_type, "track");
    assert.equal(search.best_match.artist, "Bad Bunny");
    assert.equal(search.best_match.album, "DeBÍ TiRAR MáS FOToS");
  });
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

function createPaginatedAlbumDetailClient() {
  let stage = "root";
  const browse = {
    browse(opts, callback) {
      if (opts.input) { stage = "root"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "albums-category") { stage = "albums"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "album-key") { stage = "album-detail"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "tracklist-key") { stage = "album-tracks"; callback(false, { action: "list" }); return; }
      callback(false, { action: "none" });
    },
    load(opts, callback) {
      if (stage === "root") { callback(false, { list: { title: "Search", count: 1 }, items: [{ title: "Albums", item_key: "albums-category", hint: "list" }] }); return; }
      if (stage === "albums") { callback(false, { list: { title: "Albums", count: 1 }, items: [{ title: "EL BAIFO", subtitle: "Quevedo", item_key: "album-key", hint: "action_list" }] }); return; }
      if (stage === "album-detail") { callback(false, { list: { title: "EL BAIFO", count: 1 }, items: [{ title: "1 Disc, 3 Tracks", item_key: "tracklist-key", hint: "list" }] }); return; }
      const allTracks = [
        { title: "Track One", subtitle: "Quevedo", item_key: "track-1", hint: "action_list", track_number: 1 },
        { title: "Track Two", subtitle: "Quevedo", item_key: "track-2", hint: "action_list", track_number: 2 },
        { title: "Track Three", subtitle: "Quevedo", item_key: "track-3", hint: "action_list", track_number: 3 }
      ];
      const offset = opts.offset || 0;
      callback(false, { list: { title: "Tracks", count: allTracks.length }, items: offset === 0 ? allTracks.slice(0, 1) : allTracks.slice(offset, offset + opts.count) });
    }
  };
  return { isCoreConnected: () => true, isBrowseReady: () => true, getBrowse: () => browse };
}

test("album detail follows counted track sections and loads every page", async () => {
  const service = new RoonMediaService(createPaginatedAlbumDetailClient(), "tidal");
  const search = await service.search({ query: "EL BAIFO Quevedo", types: ["album"], count: 5 });
  const detail = await service.getAlbumDetail(search.results[0].result_id, undefined, 100);
  assert.deepEqual(detail.tracks.map((track) => track.title), ["Track One", "Track Two", "Track Three"]);
});

function createStreamingAlbumWithoutTrackMetadataClient() {
  let stage = "root";
  const browse = {
    browse(opts, callback) {
      if (opts.input) { stage = "root"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "albums-category") { stage = "albums"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "caracal-key") { stage = "caracal"; callback(false, { action: "list" }); return; }
      callback(false, { action: "none" });
    },
    load(opts, callback) {
      if (stage === "root") { callback(false, { list: { title: "Search", count: 1 }, items: [{ title: "Albums", item_key: "albums-category", hint: "list" }] }); return; }
      if (stage === "albums") { callback(false, { list: { title: "Albums", count: 1 }, items: [{ title: "Caracal (Deluxe)", subtitle: "Disclosure", item_key: "caracal-key", hint: "action_list", media: { source: "tidal" } }] }); return; }
      const tracks = ["Nocturnal", "Omen", "Holding On"].map((title, index) => ({
        title,
        subtitle: "Disclosure",
        item_key: `caracal-track-${index + 1}`,
        hint: "action_list",
        media: { artist: "Disclosure", source: "tidal" }
      }));
      const offset = opts.offset || 0;
      callback(false, { list: { title: "Caracal (Deluxe)", count: tracks.length }, items: tracks.slice(offset, offset + (opts.count || tracks.length)) });
    }
  };
  return { isCoreConnected: () => true, isBrowseReady: () => true, getBrowse: () => browse };
}

test("streaming album detail trusts the ordered album list even when rows omit track numbers", async () => {
  const service = new RoonMediaService(createStreamingAlbumWithoutTrackMetadataClient(), "tidal");
  const search = await service.search({ query: "Caracal Deluxe Disclosure", types: ["album"], count: 6 });
  const detail = await service.getAlbumDetail(search.results[0].result_id, undefined, 100);

  assert.deepEqual(detail.tracks.map((track) => track.title), ["Nocturnal", "Omen", "Holding On"]);
  assert.deepEqual(detail.tracks.map((track) => track.track_number), [null, null, null]);
  assert.equal(detail.data_origin, "roon_search_session");
  assert.equal(detail.completeness, "complete");
  assert.equal(detail.ordered, true);
  assert.deepEqual(detail.related_tracks, []);
});

function createRoonAlbumSearchTracklistClient() {
  let stage = "root";
  const browse = {
    browse(opts, callback) {
      if (opts.input) { stage = "root"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "albums-category") { stage = "albums"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "tracks-category") { stage = "tracks"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "album-key") { stage = "album-action-list"; callback(false, { action: "list" }); return; }
      callback(false, { action: "none" });
    },
    load(_opts, callback) {
      if (stage === "root") {
        callback(false, {
          list: { title: "Search", count: 3 },
          items: [
            { title: "EL BAIFO", subtitle: "Quevedo", item_key: "direct", hint: "action_list", image_key: "baifo-cover" },
            { title: "Albums", subtitle: "2 Results", item_key: "albums-category", hint: "list" },
            { title: "Tracks", subtitle: "4 Results", item_key: "tracks-category", hint: "list" }
          ]
        });
        return;
      }
      if (stage === "albums") {
        callback(false, {
          list: { title: "Albums", count: 1 },
          items: [{ title: "EL BAIFO", subtitle: "Quevedo", item_key: "album-key", hint: "action_list", image_key: "baifo-cover", media: { source: "tidal" } }]
        });
        return;
      }
      if (stage === "album-action-list") {
        callback(false, {
          list: { title: "EL BAIFO", count: 1 },
          items: [{ title: "EL BAIFO", subtitle: "Quevedo", item_key: "same-title-track", hint: "action_list", image_key: "baifo-cover" }]
        });
        return;
      }
      callback(false, {
        list: { title: "Tracks", count: 4 },
        items: [
          { title: "EL BAIFO", subtitle: "Quevedo", item_key: "track-1", hint: "action_list", image_key: "baifo-cover" },
          { title: "AL GOLPITO", subtitle: "Quevedo, Nueva Línea", item_key: "track-2", hint: "action_list", image_key: "baifo-cover" },
          { title: "NI BORRACHO", subtitle: "Quevedo, KIDDO", item_key: "track-3", hint: "action_list", image_key: "baifo-cover" },
          { title: "Se Me Fue el Baifo", subtitle: "Juan Mesa", item_key: "unrelated", hint: "action_list", image_key: "other-cover" }
        ]
      });
    }
  };
  return { isCoreConnected: () => true, isBrowseReady: () => true, getBrowse: () => browse };
}

test("album detail keeps cover-matched search results separate from an unverified tracklist", async () => {
  const service = new RoonMediaService(createRoonAlbumSearchTracklistClient(), "tidal");
  const search = await service.search({ query: "EL BAIFO", types: ["album"], count: 5 });
  const detail = await service.getAlbumDetail(search.results[0].result_id, undefined, 100);

  assert.deepEqual(detail.tracks, []);
  assert.deepEqual(detail.related_tracks.map((track) => track.title), ["EL BAIFO", "AL GOLPITO", "NI BORRACHO"]);
  assert.deepEqual(detail.related_tracks.map((track) => track.track_number), [null, null, null]);
  assert.equal(detail.related_tracks.every((track) => track.album === "EL BAIFO"), true);
  assert.equal(detail.related_tracks.every((track) => track.source === "tidal"), true);
  assert.equal(detail.ordered, false);
  assert.deepEqual(detail.warnings, ["ordered_tracklist_unavailable: showing related Roon search results separately"]);
});

function createMultiDiscAlbumDetailClient() {
  let stage = "root";
  const browse = {
    browse(opts, callback) {
      if (opts.input) { stage = "root"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "albums-category") { stage = "albums"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "album-key") { stage = "album-detail"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "tracklist-key") { stage = "album-tracks"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "disc-1") { stage = "disc-1"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "disc-2") { stage = "disc-2"; callback(false, { action: "list" }); return; }
      callback(false, { action: "none" });
    },
    load(_opts, callback) {
      if (stage === "root") { callback(false, { list: { title: "Search", count: 1 }, items: [{ title: "Albums", item_key: "albums-category", hint: "list" }] }); return; }
      if (stage === "albums") { callback(false, { list: { title: "Albums", count: 1 }, items: [{ title: "Double Album", subtitle: "Example Artist", item_key: "album-key", hint: "action_list" }] }); return; }
      if (stage === "album-detail") { callback(false, { list: { title: "Double Album", count: 1 }, items: [{ title: "2 Discs, 4 Tracks", item_key: "tracklist-key", hint: "list" }] }); return; }
      if (stage === "album-tracks") { callback(false, { list: { title: "Tracks", count: 2 }, items: [{ title: "Disc 1", item_key: "disc-1", hint: "list" }, { title: "Disc 2", item_key: "disc-2", hint: "list" }] }); return; }
      const discNumber = stage === "disc-1" ? 1 : 2;
      const titles = discNumber === 1 ? ["Opening", "Interlude"] : ["Finale", "Epilogue"];
      callback(false, {
        list: { title: `Disc ${discNumber}`, count: 2 },
        items: titles.map((title, index) => ({
          title,
          subtitle: "Example Artist",
          item_key: `disc-${discNumber}-track-${index + 1}`,
          hint: "action_list",
          disc_number: discNumber,
          track_number: index + 1
        }))
      });
    }
  };
  return { isCoreConnected: () => true, isBrowseReady: () => true, getBrowse: () => browse };
}

test("album detail combines every disc instead of returning only the first track list", async () => {
  const service = new RoonMediaService(createMultiDiscAlbumDetailClient(), "tidal");
  const search = await service.search({ query: "Double Album Example Artist", types: ["album"], count: 5 });
  const detail = await service.getAlbumDetail(search.results[0].result_id, undefined, 100);
  assert.deepEqual(detail.tracks.map((track) => track.title), [
    "Opening",
    "Interlude",
    "Finale",
    "Epilogue"
  ]);
});

test("search_media requires selection when two direct-looking exact recordings remain indistinguishable", async () => {
  const service = new RoonMediaService(createSearchClient([
    {title:"Hallelujah",subtitle:"Jeff Buckley",item_key:"hallelujah-1",image_key:"grace-1",hint:"action_list"},
    {title:"Hallelujah",subtitle:"Jeff Buckley",item_key:"hallelujah-2",image_key:"grace-2",hint:"action_list"}
  ]), "tidal");
  const search = await service.search({query:"Hallelujah Jeff Buckley",types:["track"],count:5});
  assert.equal(search.ambiguous, true);
  assert.equal(search.selection_required, true);
  assert.equal(search.recommended_result_id, null);
});

test("splitArtistCredit preserves slash band names such as AC/DC", () => {
  const { splitArtistCredit } = require("../dist/roon/roonMediaService");
  assert.deepEqual(splitArtistCredit("AC/DC"), ["AC/DC"]);
  assert.deepEqual(splitArtistCredit("Artist One / Artist Two"), ["Artist One", "Artist Two"]);
});

function createNativeLibraryAlbumClient() {
  const stages = new Map();
  let indexLoads = 0;
  const browse = {
    browse(opts, callback) {
      const session = opts.multi_session_key || "default";
      if (opts.hierarchy === "search" && opts.input) { stages.set(session, "search-root"); callback(false, { action:"list" }); return; }
      if (opts.item_key === "albums-category") { stages.set(session, "search-albums"); callback(false, { action:"list" }); return; }
      if (opts.hierarchy === "albums" && !opts.item_key) { stages.set(session, "library-albums"); if (session.includes("library-index")) indexLoads += 1; callback(false, { action:"list" }); return; }
      if (opts.hierarchy === "albums" && String(opts.item_key).startsWith("library-nevermind")) { stages.set(session, "library-nevermind-detail"); callback(false, { action:"list" }); return; }
      callback(false, { action:"none" });
    },
    load(opts, callback) {
      const session = opts.multi_session_key || "default";
      const stage = stages.get(session);
      if (stage === "search-root") { callback(false, { list:{title:"Search",count:1}, items:[{title:"Albums",item_key:"albums-category",hint:"list"}] }); return; }
      if (stage === "search-albums") { callback(false, { list:{title:"Albums",count:1}, items:[{title:"Nevermind",subtitle:"Nirvana",image_key:"never-cover",item_key:"search-nevermind",hint:"action_list"}] }); return; }
      if (stage === "library-albums") {
        const all = [
          {title:"Bleach",subtitle:"Nirvana",image_key:"bleach-cover",item_key:`library-bleach-${session}`,hint:"list"},
          {title:"Nevermind",subtitle:"Nirvana",image_key:"never-cover",item_key:`library-nevermind-${session}`,hint:"list"}
        ];
        callback(false, { list:{title:"Albums",count:all.length}, items:all.slice(opts.offset||0,(opts.offset||0)+(opts.count||all.length)) }); return;
      }
      callback(false, { list:{title:"Nevermind",count:3}, items:[
        {title:"Play Album",item_key:"play-nevermind",hint:"action"},
        {title:"1. Smells Like Teen Spirit",subtitle:"Nirvana",item_key:"native-track-1",hint:"action_list",duration_seconds:301},
        {title:"1-2 In Bloom",subtitle:"Nirvana",item_key:"native-track-2",hint:"action_list",duration_seconds:254}
      ] });
    }
  };
  return { client:{isCoreConnected:()=>true,isBrowseReady:()=>true,getBrowse:()=>browse}, indexLoads:()=>indexLoads };
}

test("album detail resolves a fresh native library item by cached ordinal and exposes only ordered tracks", async () => {
  const mock = createNativeLibraryAlbumClient();
  const service = new RoonMediaService(mock.client, "tidal");
  const search = await service.search({query:"Nevermind Nirvana",types:["album"],count:5});
  const first = await service.getAlbumDetail(search.results[0].result_id);
  const second = await service.getAlbumDetail(search.results[0].result_id);

  assert.deepEqual(first.tracks.map((track)=>track.title), ["Smells Like Teen Spirit","In Bloom"]);
  assert.deepEqual(first.tracks.map((track)=>[track.disc_number,track.track_number]), [[null,1],[1,2]]);
  assert.equal(first.tracks.some((track)=>track.title === "Play Album"), false);
  assert.equal(first.data_origin, "roon_library");
  assert.equal(first.completeness, "complete");
  assert.equal(first.ordered, true);
  assert.equal(first.identity_verified, true);
  assert.equal(first.tracks.every((track)=>track.source === "library"), true);
  assert.equal(second.tracks.length, 2);
  assert.equal(mock.indexLoads(), 1);
});

function createNativeLibraryArtistClient() {
  const stages = new Map();
  const browse = {
    browse(opts, callback) {
      const session=opts.multi_session_key||"default";
      if(opts.hierarchy==="search"&&opts.input){stages.set(session,"search-root");callback(false,{action:"list"});return;}
      if(opts.item_key==="artists-category"){stages.set(session,"search-artists");callback(false,{action:"list"});return;}
      if(opts.hierarchy==="artists"&&!opts.item_key){stages.set(session,"library-artists");callback(false,{action:"list"});return;}
      if(opts.hierarchy==="artists"&&String(opts.item_key).includes("nirvana-us")){stages.set(session,"nirvana-us");callback(false,{action:"list"});return;}
      callback(false,{action:"none"});
    },
    load(opts, callback) {
      const session=opts.multi_session_key||"default";const stage=stages.get(session);
      if(stage==="search-root"){callback(false,{list:{title:"Search",count:1},items:[{title:"Artists",item_key:"artists-category",hint:"list"}]});return;}
      if(stage==="search-artists"){callback(false,{list:{title:"Artists",count:1},items:[{title:"Nirvana",subtitle:"9 Albums",image_key:"nirvana-us-image",item_key:"search-nirvana",hint:"action_list"}]});return;}
      if(stage==="library-artists"){const all=[{title:"Nirvana",subtitle:"9 Albums",image_key:"nirvana-us-image",item_key:`nirvana-us-${session}`,hint:"list"},{title:"Nirvana",subtitle:"4 Albums",image_key:"nirvana-uk-image",item_key:`nirvana-uk-${session}`,hint:"list"}];callback(false,{list:{title:"Artists",count:2},items:all.slice(opts.offset||0,(opts.offset||0)+(opts.count||2))});return;}
      callback(false,{list:{title:"Nirvana",count:3},items:[{title:"Play Artist",item_key:"play-artist",hint:"action"},{title:"Nevermind",subtitle:"Nirvana",image_key:"never",item_key:"never",hint:"action_list"},{title:"In Utero",subtitle:"Nirvana",image_key:"utero",item_key:"utero",hint:"action_list"}]});
    }
  };
  return {isCoreConnected:()=>true,isBrowseReady:()=>true,getBrowse:()=>browse};
}

test("artist detail uses the image-verified native homonym and never mixes another artist's albums", async () => {
  const service=new RoonMediaService(createNativeLibraryArtistClient(),"tidal");
  const search=await service.search({query:"Nirvana",types:["artist"],count:5});
  service.search=async()=>({results:[],groups:{artist:[],album:[],ep:[],single_ep:[],single:[],track:[],playlist:[]},warnings:[]});
  service.readArtistBio=async()=>null;
  const detail=await service.getArtistDetail(search.results[0].result_id);
  assert.deepEqual(detail.albums.map((album)=>album.title),["Nevermind","In Utero"]);
  assert.equal(detail.data_origin,"roon_library");
  assert.equal(detail.completeness,"complete");
  assert.equal(detail.albums.every((album)=>album.source==="library"),true);
});

function createNestedArtistDiscographyClient() {
  let stage = "root";
  const browse = {
    browse(opts, callback) {
      if (opts.input) { stage = "root"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "artists-category") { stage = "artists"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "artist-key") { stage = "artist-detail"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "discography-key") { stage = "discography"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "main-albums-key") { stage = "main-albums"; callback(false, { action: "list" }); return; }
      if (opts.item_key === "singles-eps-key") { stage = "singles-eps"; callback(false, { action: "list" }); return; }
      callback(false, { action: "none" });
    },
    load(_opts, callback) {
      if (stage === "root") { callback(false, { list: { title: "Search", count: 1 }, items: [{ title: "Artists", item_key: "artists-category", hint: "list" }] }); return; }
      if (stage === "artists") { callback(false, { list: { title: "Artists", count: 1 }, items: [{ title: "Quevedo", subtitle: "Artist", item_key: "artist-key", hint: "action_list" }] }); return; }
      if (stage === "artist-detail") { callback(false, { list: { title: "Quevedo", count: 1 }, items: [{ title: "Discography (4)", item_key: "discography-key", hint: "list" }] }); return; }
      if (stage === "discography") { callback(false, { list: { title: "Discography", count: 2 }, items: [{ title: "Main Albums (2)", item_key: "main-albums-key", hint: "list" }, { title: "Singles & EPs (2)", item_key: "singles-eps-key", hint: "list" }] }); return; }
      if (stage === "main-albums") { callback(false, { list: { title: "Main Albums", count: 2 }, items: [{ title: "EL BAIFO", subtitle: "Quevedo", item_key: "baifo", hint: "action_list", media: { artist: "Quevedo" } }, { title: "Acoustic Covers", subtitle: "Gabriella Quevedo", item_key: "wrong", hint: "action_list", media: { artist: "Gabriella Quevedo" } }] }); return; }
      callback(false, { list: { title: "Singles & EPs", count: 2 }, items: [{ title: "One Song", subtitle: "Quevedo · 1 Track", item_key: "single", hint: "action_list", media: { artist: "Quevedo", track_count: 1 } }, { title: "Short Release", subtitle: "Quevedo · 5 Tracks", item_key: "ep", hint: "action_list", media: { artist: "Quevedo", track_count: 5 } }] });
    }
  };
  return { isCoreConnected: () => true, isBrowseReady: () => true, getBrowse: () => browse };
}

test("artist discography follows nested Roon sections, separates releases and rejects surname matches", async () => {
  const service = new RoonMediaService(createNestedArtistDiscographyClient(), "tidal");
  const search = await service.search({ query: "Quevedo", types: ["artist"], count: 5 });
  const detail = await service.listArtistReleases(search.results[0].result_id, undefined, 100);
  assert.deepEqual(detail.releases.map((release) => release.title).sort(), ["EL BAIFO", "One Song", "Short Release"]);
  assert.equal(detail.releases.find((release) => release.title === "One Song").release_type, "single");
  assert.equal(detail.releases.find((release) => release.title === "Short Release").release_type, "ep");
  assert.equal(detail.releases.some((release) => release.artist === "Gabriella Quevedo"), false);
});

function createCatalogAndLibraryArtistClient() {
  const stages = new Map();
  let libraryLoads = 0;
  const browse = {
    browse(opts, callback) {
      const session = opts.multi_session_key || "default";
      if (opts.hierarchy === "search" && opts.input) { stages.set(session, "search-root"); callback(false, { action: "list" }); return; }
      if (opts.item_key === "artists-category") { stages.set(session, "search-artists"); callback(false, { action: "list" }); return; }
      if (opts.item_key === "disclosure-catalog") { stages.set(session, "catalog-artist"); callback(false, { action: "list" }); return; }
      if (opts.item_key === "discography-key") { stages.set(session, "discography"); callback(false, { action: "list" }); return; }
      if (opts.item_key === "main-albums-key") { stages.set(session, "main-albums"); callback(false, { action: "list" }); return; }
      if (opts.hierarchy === "artists" && !opts.item_key) { libraryLoads += 1; stages.set(session, "library-artists"); callback(false, { action: "list" }); return; }
      callback(false, { action: "none" });
    },
    load(opts, callback) {
      const stage = stages.get(opts.multi_session_key || "default");
      if (stage === "search-root") { callback(false, { list: { title: "Search", count: 1 }, items: [{ title: "Artists", item_key: "artists-category", hint: "list" }] }); return; }
      if (stage === "search-artists") { callback(false, { list: { title: "Artists", count: 1 }, items: [{ title: "Disclosure", subtitle: "8 Albums", image_key: "disclosure-image", item_key: "disclosure-catalog", hint: "action_list" }] }); return; }
      if (stage === "catalog-artist") { callback(false, { list: { title: "Disclosure", count: 1 }, items: [{ title: "Discography", item_key: "discography-key", hint: "list" }] }); return; }
      if (stage === "discography") { callback(false, { list: { title: "Discography", count: 1 }, items: [{ title: "Main Albums (2)", item_key: "main-albums-key", hint: "list" }] }); return; }
      if (stage === "main-albums") { callback(false, { list: { title: "Main Albums", count: 2 }, items: [{ title: "Settle", subtitle: "Disclosure", item_key: "settle", hint: "action_list", media: { artist: "Disclosure", release_year: 2013 } }, { title: "Caracal", subtitle: "Disclosure", item_key: "caracal", hint: "action_list", media: { artist: "Disclosure", release_year: 2015 } }] }); return; }
      callback(false, { list: { title: "Artists", count: 1 }, items: [{ title: "Disclosure", subtitle: "1 Album", image_key: "disclosure-image", item_key: "library-disclosure", hint: "list" }] });
    }
  };
  return {
    client: { isCoreConnected: () => true, isBrowseReady: () => true, getBrowse: () => browse },
    libraryLoads: () => libraryLoads
  };
}

test("artist discography prefers the exact catalog session over the smaller local library", async () => {
  const mock = createCatalogAndLibraryArtistClient();
  const service = new RoonMediaService(mock.client, "tidal");
  const search = await service.search({ query: "Disclosure", types: ["artist"], count: 6 });
  const detail = await service.listArtistReleases(search.results[0].result_id, undefined, 200);

  assert.deepEqual(detail.releases.map((release) => release.title), ["Settle", "Caracal"]);
  assert.equal(detail.releases.every((release) => release.data_origin === "roon_search_session"), true);
  assert.equal(detail.releases.every((release) => release.completeness === "complete"), true);
  assert.equal(mock.libraryLoads(), 0);
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

test("artist search preserves Roon candidates even when the subtitle reports zero albums", async () => {
  const service = new RoonMediaService(createArtistSearchClient([
    { title: "Daft Punk", subtitle: "10 Albums", item_key: "artist-real", hint: "action_list" },
    { title: "Queen vs. Daft Punk", subtitle: "0 Albums", item_key: "artist-empty", hint: "action_list" }
  ]), "tidal");
  const search = await service.search({ query: "Daft Punk", types: ["artist"], count: 10 });

  assert.deepEqual(search.results.map((result) => result.title), ["Daft Punk", "Queen vs. Daft Punk"]);
  assert.equal(search.results[0].content_count, 10);
  assert.equal(search.results[1].content_count, 0);
});

test("artist detail groups albums and singles and keeps biography optional", async () => {
  const service = new RoonMediaService(createArtistSearchClient(), "tidal");
  const search = await service.search({ query: "Radiohead", types: ["artist"], count: 1 });
  const artist = search.results[0];
  const media = (title, media_type, subtitle, release_type = null) => ({ ...artist, result_id: `media-${title}`, title, type: media_type, media_type, subtitle, release_type, artist: media_type === "track" ? "Radiohead" : null });
  service.listArtistReleases = async () => ({ artist, list_title: "Radiohead", releases: [media("Kid A", "album", "2000", "album"), media("Burn the Witch", "album", "Single · 2016", "single")] });
  service.search = async (request) => ({ query: request.query, source_preference: "library_first", results: request.types[0] === "track" ? [media("Paranoid Android", "track", "Radiohead")] : [], ambiguous: false, ambiguity_reason: null, recommended_result_id: null, selection_required: true, warnings: [] });
  service.readArtistBio = async () => null;

  const detail = await service.getArtistDetail(artist.result_id);
  assert.equal(detail.bio, null);
  assert.deepEqual(detail.popular_tracks.map((track) => track.title), ["Paranoid Android"]);
  assert.deepEqual(detail.albums.map((album) => album.title), ["Kid A"]);
  assert.deepEqual(detail.singles_eps.map((album) => album.title), ["Burn the Witch"]);
});

test("artist detail never turns a global name search into an official discography", async () => {
  let metadataCalls = 0;
  const metadata = {
    listArtistReleases: async () => { metadataCalls += 1; return Array.from({ length: 30 }, (_, index) => ({
      title: `Release ${index + 1}`,
      artists: ["Quevedo"],
      release_type: index < 10 ? "album" : index < 20 ? "ep" : "single",
      release_year: 2000 + index,
      score: 100
    })); }
  };
  const service = new RoonMediaService(createArtistSearchClient([{ title: "Quevedo", subtitle: "Artist", item_key: "artist-key", hint: "action_list" }]), "tidal", metadata);
  const search = await service.search({ query: "Quevedo", types: ["artist"], count: 1 });
  service.listArtistReleases = async () => ({ artist: search.results[0], releases: [], list_title: null });
  service.searchGlobalCategory = async (_query, type, _zone, count) => ({
    directItems: [],
    items: type === "album"
      ? Array.from({ length: 30 }, (_, index) => ({ title: `Release ${index + 1}`, subtitle: "Quevedo", item_key: `release-${index + 1}`, hint: "action_list", image_key: `cover-${index + 1}` })).slice(0, count)
      : []
  });
  service.search = async (request) => ({ query: request.query, source_preference: "library_first", results: [], groups: { artist: [], album: [], ep: [], single_ep: [], single: [], track: [], playlist: [] }, best_match: null, best_by_type: {}, ambiguous: false, ambiguity_reason: null, recommended_result_id: null, selection_required: true, warnings: [] });
  service.readArtistBio = async () => null;

  const detail = await service.getArtistDetail(search.results[0].result_id, undefined, 200);
  assert.deepEqual(detail.albums, []);
  assert.deepEqual(detail.singles_eps, []);
  assert.equal(metadataCalls, 0);
  assert.equal(detail.completeness, "unknown");
  assert.match(detail.warnings.join(" "), /discography_unavailable/);
});

test("artist detail omits unmatched global releases without opening them", async () => {
  const metadata = { listArtistReleases: async () => [] };
  const service = new RoonMediaService(createArtistSearchClient([{ title: "Quevedo", subtitle: "Artist", item_key: "artist-key", hint: "action_list" }]), "tidal", metadata);
  const search = await service.search({ query: "Quevedo", types: ["artist"], count: 1 });
  service.listArtistReleases = async () => ({ artist: search.results[0], releases: [], list_title: null });
  service.searchGlobalCategory = async () => ({
    directItems: [],
    items: [
      { title: "Long Release", subtitle: "Quevedo", item_key: "long", hint: "action_list", image_key: "long-cover" },
      { title: "Short Release", subtitle: "Quevedo", item_key: "short", hint: "action_list", image_key: "short-cover" },
      { title: "One Song", subtitle: "Quevedo", item_key: "single", hint: "action_list", image_key: "single-cover" }
    ]
  });
  let albumTraversals = 0;
  service.readAlbumTracksFromSearch = async () => { albumTraversals += 1; return []; };
  service.search = async (request) => ({ query: request.query, source_preference: "library_first", results: [], groups: { artist: [], album: [], ep: [], single_ep: [], single: [], track: [], playlist: [] }, best_match: null, best_by_type: {}, ambiguous: false, ambiguity_reason: null, recommended_result_id: null, selection_required: true, warnings: [] });
  service.readArtistBio = async () => null;

  const detail = await service.getArtistDetail(search.results[0].result_id, undefined, 200);
  assert.equal(albumTraversals, 0);
  assert.deepEqual(detail.albums, []);
  assert.deepEqual(detail.singles_eps, []);
});
