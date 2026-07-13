const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ReleaseMetadataService,
  matchReleaseCatalog
} = require("../dist/services/releaseMetadataService");

test("MusicBrainz release metadata maps exact types and years and is cached per artist", async () => {
  let requests = 0;
  const service = new ReleaseMetadataService(async (url, options) => {
    requests += 1;
    assert.match(String(url), /release-group/);
    assert.match(options.headers["User-Agent"], /^RoonAI-Bridge\//);
    return new Response(JSON.stringify({
      "release-groups": [
        { title: "EL BAIFO", "primary-type": "Album", "first-release-date": "2026-04-24", score: 100, "artist-credit": [{ name: "Quevedo" }] },
        { title: "Columbia", "primary-type": "Single", "first-release-date": "2023-07-07", score: 100, "artist-credit": [{ name: "Quevedo" }] },
        { title: "Short Release", "primary-type": "EP", "first-release-date": "2024", score: 95, "artist-credit": [{ name: "Quevedo" }] }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const first = await service.listArtistReleases("Quevedo");
  const second = await service.listArtistReleases("Quevedo");

  assert.equal(requests, 1);
  assert.deepEqual(second, first);
  assert.deepEqual(matchReleaseCatalog(first, "EL BAIFO", ["Quevedo"]), {
    title: "EL BAIFO",
    artists: ["Quevedo"],
    release_type: "album",
    release_year: 2026,
    score: 100
  });
  assert.equal(matchReleaseCatalog(first, "Columbia", ["Quevedo"]).release_type, "single");
  assert.equal(matchReleaseCatalog(first, "Short Release", ["Quevedo"]).release_type, "ep");
  assert.equal(matchReleaseCatalog(first, "Unrelated", ["Quevedo"]), null);
  assert.equal(matchReleaseCatalog([{
    title: "Columbia",
    artists: ["Gabriella Quevedo"],
    release_type: "album",
    release_year: 2020,
    score: 100
  }], "Columbia", ["Quevedo"]), null);
});
