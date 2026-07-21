const assert = require("node:assert/strict");
const test = require("node:test");

const { RecordingMetadataService } = require("../dist/services/recordingMetadataService");

test("MusicBrainz recording metadata reports a conflict instead of choosing the most widespread duration", async () => {
  let requests = 0;
  const service = new RecordingMetadataService(async (url, options) => {
    requests += 1;
    assert.match(String(url), /recording/);
    assert.match(url.searchParams.get("query"), /release:"L\.A\. Woman"/);
    assert.match(options.headers["User-Agent"], /^RoonAI-Bridge\//);
    return new Response(JSON.stringify({ recordings: [
      {
        id: "mix-a",
        title: "Riders on the Storm",
        length: 429000,
        score: 100,
        "artist-credit": [{ name: "The Doors" }],
        releases: [{ title: "L.A. Woman", date: "2007", status: "Official" }]
      },
      {
        id: "mix-b",
        title: "Riders on the Storm",
        length: 432000,
        score: 100,
        "artist-credit": [{ name: "The Doors" }],
        releases: Array.from({ length: 20 }, () => ({ title: "L.A. Woman", date: "1971", status: "Official" }))
      }
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const first = await service.lookup({ title: "Riders on the Storm", artist: "The Doors", album: "L.A. Woman" });
  const second = await service.lookup({ title: "Riders on the Storm", artist: "The Doors", album: "L.A. Woman" });

  assert.equal(requests, 1);
  assert.deepEqual(second, first);
  assert.equal(first.status, "conflict");
  assert.equal(first.metadata, null);
  assert.deepEqual(first.candidates.map((candidate) => candidate.duration_seconds), [429, 432]);
});

test("MusicBrainz recording metadata resolves an explicitly named mix and follows its work credits", async () => {
  const service = new RecordingMetadataService(async (url) => {
    if (url.pathname.endsWith("/recording")) {
      assert.match(url.searchParams.get("query"), /release:"Who’s Next \| Life House"/);
      return new Response(JSON.stringify({ recordings: [{
        id: "who-2022",
        title: "Won't Get Fooled Again",
        disambiguation: "2022 stereo mix",
        length: 512000,
        score: 81,
        "artist-credit": [{ name: "The Who" }],
        releases: [{ title: "Who’s Next | Life House", date: "2023-09-15", status: "Official" }]
      }] }), { status: 200 });
    }
    if (url.pathname.endsWith("/recording/who-2022")) {
      return new Response(JSON.stringify({
        id: "who-2022",
        title: "Won't Get Fooled Again",
        disambiguation: "2022 stereo mix",
        length: 512000,
        isrcs: [],
        genres: [],
        "artist-credit": [{ name: "The Who" }],
        releases: [{ title: "Who’s Next | Life House", date: "2023-09-15", status: "Official" }],
        relations: [{ type: "performance", work: { id: "work-id", title: "Won't Get Fooled Again" } }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      id: "work-id",
      title: "Won't Get Fooled Again",
      relations: [
        { type: "composer", artist: { id: "pete", name: "Pete Townshend" } },
        { type: "lyricist", artist: { id: "pete", name: "Pete Townshend" } }
      ],
      genres: [{ name: "rock", count: 3 }]
    }), { status: 200 });
  });

  const result = await service.lookup({
    title: "Won't Get Fooled Again (Remastered 2022)",
    artist: "The Who",
    album: "Who’s Next : Life House (Super Deluxe)",
    version_hint: "remaster"
  });

  assert.equal(result.status, "exact");
  assert.equal(result.metadata.recording_id, "who-2022");
  assert.equal(result.metadata.duration_seconds, 512);
  assert.deepEqual(result.metadata.composers, ["Pete Townshend"]);
  assert.deepEqual(result.metadata.lyricists, ["Pete Townshend"]);
  assert.deepEqual(result.metadata.genres, ["rock"]);
  assert.equal(result.metadata.release_year, 2023);
});

test("MusicBrainz retries bounded 503 responses before reporting a result", async () => {
  let requests = 0;
  const waits = [];
  const service = new RecordingMetadataService(async () => {
    requests += 1;
    if (requests === 1) return new Response("busy", { status: 503 });
    return new Response(JSON.stringify({ recordings: [] }), { status: 200 });
  }, {
    minRequestIntervalMs: 0,
    maxRetries: 2,
    retryBaseMs: 0,
    sleep: async (milliseconds) => { waits.push(milliseconds); }
  });

  const result = await service.lookup({ title: "Unknown", artist: "Unknown" });
  assert.equal(result.status, "not_found");
  assert.equal(requests, 2);
  assert.deepEqual(waits, [0]);
});
