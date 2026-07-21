const assert = require("node:assert/strict");
const test = require("node:test");

const { RecordingMetadataService } = require("../dist/services/recordingMetadataService");

test("MusicBrainz recording metadata prefers the widely released album recording", async () => {
  let requests = 0;
  const service = new RecordingMetadataService(async (url, options) => {
    requests += 1;
    assert.match(String(url), /recording/);
    assert.match(url.searchParams.get("query"), /release:"L\.A\. Woman"/);
    assert.match(options.headers["User-Agent"], /^RoonAI-Bridge\//);
    return new Response(JSON.stringify({ recordings: [
      {
        id: "new-remaster",
        title: "Riders on the Storm",
        length: 463000,
        score: 100,
        "artist-credit": [{ name: "The Doors" }],
        releases: [{ title: "L.A. Woman", date: "2022-05-06", status: "Official" }]
      },
      {
        id: "canonical-recording",
        title: "Riders on the Storm",
        length: 432000,
        score: 83,
        isrcs: ["USPR37100001"],
        "artist-credit": [{ name: "The Doors" }],
        releases: Array.from({ length: 20 }, (_, index) => ({
          title: "L.A. Woman",
          date: index === 0 ? "1971-04-19" : "1980",
          status: "Official"
        }))
      }
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const first = await service.lookup({ title: "Riders on the Storm", artist: "The Doors", album: "L.A. Woman" });
  const second = await service.lookup({ title: "Riders on the Storm", artist: "The Doors", album: "L.A. Woman" });

  assert.equal(requests, 1);
  assert.deepEqual(second, first);
  assert.equal(first.recording_id, "canonical-recording");
  assert.equal(first.duration_seconds, 432);
  assert.equal(first.release_year, 1971);
  assert.equal(first.isrc, "USPR37100001");
  assert.equal(first.confidence, "high");
});
