const assert = require("node:assert/strict");
const test = require("node:test");

const { RoonMediaService } = require("../dist/roon/roonMediaService");

function createSearchClient() {
  let stage = "root";
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
        items: [
          {
            title: "Everything In Its Right Place",
            subtitle: "Radiohead",
            item_key: "track-key",
            image_key: "image-key",
            hint: "action_list",
            source_context: "library"
          }
        ]
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
