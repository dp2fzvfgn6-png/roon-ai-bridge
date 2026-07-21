const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createDatabase } = require("../dist/db/database");
const { MetadataProviderCacheService } = require("../dist/services/metadataProviderCacheService");
const { RecordingMetadataService } = require("../dist/services/recordingMetadataService");

function config(dataDir) {
  return {
    port: 3000,
    portalPort: 3001,
    enablePortal: false,
    nodeEnv: "test",
    logLevel: "error",
    roonExtensionName: "RoonIA Test",
    roonExtensionId: "test.roonia.cache",
    dataDir,
    enableBrowse: true,
    enableMcp: true,
    enableAuth: false,
    apiToken: null,
    portalAdminToken: null,
    publicBaseUrl: "http://localhost:3000",
    portalPublicUrl: "http://localhost:3001",
    oauthIssuer: "http://localhost:3000",
    oauthApprovalPin: null,
    roonStreamingSource: "tidal",
    updateChannel: "beta",
    automaticUpdateChecks: false,
    debugMode: false
  };
}

test("persists MusicBrainz resolution results across service restarts", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-metadata-cache-"));
  const database = createDatabase(config(dataDir));
  try {
    const cache = new MetadataProviderCacheService(database);
    let requests = 0;
    const first = new RecordingMetadataService(async () => {
      requests += 1;
      return new Response(JSON.stringify({ recordings: [] }), { status: 200 });
    }, { cache, minRequestIntervalMs: 0 });
    const input = { title: "Unknown Song", artist: "Unknown Artist" };
    assert.equal((await first.lookup(input)).status, "not_found");
    assert.equal(requests, 1);

    const restarted = new RecordingMetadataService(async () => {
      throw new Error("persistent cache should avoid a network request");
    }, { cache, minRequestIntervalMs: 0 });
    assert.equal((await restarted.lookup(input)).status, "not_found");
    assert.equal(cache.summary("musicbrainz").active_entries, 1);
    assert.equal(cache.summary("musicbrainz").statuses.not_found, 1);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("expires corrupt and stale provider cache entries safely", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-metadata-expiry-"));
  const database = createDatabase(config(dataDir));
  try {
    const cache = new MetadataProviderCacheService(database);
    cache.set({
      provider: "musicbrainz",
      cacheKey: "stale",
      entityType: "recording_resolution",
      status: "not_found",
      payload: { status: "not_found" },
      ttlMs: 10,
      now: new Date("2026-01-01T00:00:00.000Z")
    });
    assert.equal(cache.get("musicbrainz", "stale", new Date("2026-01-01T00:00:01.000Z")), null);
    assert.equal(cache.purgeExpired(new Date("2026-01-01T00:00:01.000Z")), 1);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
