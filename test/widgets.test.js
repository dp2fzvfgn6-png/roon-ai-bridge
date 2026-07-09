const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createServer } = require("../dist/api/server");
const { createDatabase } = require("../dist/db/database");
const { PlaylistService } = require("../dist/services/playlistService");
const { VolumeLimitService } = require("../dist/services/volumeLimitService");
const { WidgetService } = require("../dist/services/widgetService");

function createConfig(dataDir) {
  return {
    port: 3000,
    portalPort: 3001,
    enablePortal: false,
    nodeEnv: "test",
    logLevel: "error",
    roonExtensionName: "Test",
    roonExtensionId: "test",
    dataDir,
    enableBrowse: true,
    enableMcp: true,
    enableAuth: false,
    apiToken: null,
    portalAdminToken: null,
    publicBaseUrl: "https://example.test",
    oauthIssuer: "https://example.test",
    oauthApprovalPin: null,
    roonStreamingSource: "tidal"
  };
}

function noopLogger() {
  const noop = () => {};
  return { info: noop, warn: noop, error: noop, debug: noop };
}

function createRoonClient() {
  const zone = {
    zone_id: "zone-1",
    display_name: "Despacho",
    state: "playing",
    now_playing: {
      image_key: "image-1",
      seek_position: 10,
      length: 200,
      three_line: {
        line1: "Everything In Its Right Place",
        line2: "Radiohead",
        line3: "Kid A"
      }
    },
    outputs: [{
      output_id: "output-1",
      display_name: "Despacho",
      volume: { type: "number", min: 0, max: 60, value: 20, step: 1, is_muted: false }
    }],
    settings: { shuffle: false, auto_radio: false, loop: "disabled" }
  };
  return {
    getZones: () => [zone],
    getZone: (id) => id === zone.zone_id ? zone : null,
    getOutputs: () => zone.outputs,
    getOutput: (id) => zone.outputs.find((output) => output.output_id === id) || null,
    getTransport: () => ({}),
    isCoreConnected: () => true,
    getCoreName: () => "Test Core",
    isTransportReady: () => true,
    isBrowseReady: () => true,
    isImageReady: () => false
  };
}

function createMediaService() {
  const track = {
    result_id: "media-track-1",
    type: "track",
    media_type: "track",
    title: "Everything In Its Right Place",
    artist: "Radiohead",
    album: "Kid A",
    album_artist: "Radiohead",
    subtitle: "Radiohead",
    version_hint: "studio",
    image_key: "image-2",
    source: "tidal",
    source_confidence: "high",
    quality: { label: "16-bit / 44.1 kHz", bit_depth: 16, sample_rate_hz: 44100, format: "FLAC" },
    is_library: false,
    playable: true,
    match_score: 96,
    confidence: "high",
    match_reasons: [],
    match_penalties: [],
    warnings: [],
    expires_at: new Date(Date.now() + 60000).toISOString()
  };
  const artist = { ...track, result_id: "media-artist-1", type: "artist", media_type: "artist", title: "Radiohead", artist: null, album: null };
  const results = new Map([[track.result_id, track], [artist.result_id, artist]]);
  return {
    search: async () => ({
      query: "Everything In Its Right Place Radiohead",
      source_preference: "highest_quality",
      results: [track],
      ambiguous: false,
      recommended_result_id: track.result_id,
      selection_required: false,
      warnings: []
    }),
    expandSearch: async () => ({
      ok: true,
      original_query: "Everything",
      attempts: [{ query: "Everything", strategy: "broaden", results_count: 1, results: [track] }],
      best_candidates: [track]
    }),
    get: (id) => {
      if (!results.has(id)) {
        const error = new Error("expired");
        error.code = "SEARCH_NO_RESULTS";
        throw error;
      }
      return results.get(id);
    },
    play: async (result_id, zone_id, mode) => ({ ok: true, result_id, zone_id, mode }),
    startRadio: async (result_id, zone_id) => ({ ok: true, result_id, zone_id, mode: "radio" })
  };
}

function createFixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-widgets-"));
  const config = createConfig(dataDir);
  const database = createDatabase(config);
  const playlistService = new PlaylistService(config, database);
  const volumeLimitService = new VolumeLimitService(config, database);
  playlistService.createPlaylist({
    playlist_id: "peaky_blinders_soundtrack_complete",
    name: "Peaky Blinders",
    description: "Soundtrack",
    tracks: Array.from({ length: 30 }, (_, index) => ({
      track_id: `track-${index + 1}`,
      query: `Song ${index + 1}`,
      title: `Song ${index + 1}`,
      artist: "Artist",
      album: "Album",
      image_key: `image-${index + 10}`,
      user_metadata: { season: 1, episode: index + 1 }
    }))
  });
  const context = {
    config,
    logger: noopLogger(),
    roonClient: createRoonClient(),
    playlistService,
    oauthService: {},
    mediaService: createMediaService(),
    apiKeyService: {},
    portalAuthService: {},
    systemManagementService: {},
    zonePresetService: {},
    outputVolumeSettingsService: {},
    volumeLimitService
  };
  return { config, database, context };
}

test("widget service returns now playing contract without base64 artwork", () => {
  const { database, context } = createFixture();
  try {
    const widget = new WidgetService({
      roonClient: context.roonClient,
      playlistService: context.playlistService,
      mediaService: context.mediaService,
      volumeLimitService: context.volumeLimitService,
      publicBaseUrl: context.config.publicBaseUrl
    }).getNowPlaying();
    assert.equal(widget.widget_type, "now_playing");
    assert.equal(widget.zones.length, 1);
    assert.equal(widget.zones[0].now_playing.image_key, "image-1");
    assert.equal(widget.zones[0].now_playing.image_url, "https://example.test/roon/images/image-1");
    assert.deepEqual(widget.zones[0].actions.slice(0, 3), ["play_pause", "previous", "next"]);
    assert.equal(JSON.stringify(widget).includes("base64"), false);
  } finally {
    database.close();
  }
});

test("playlist widget paginates tracks and exposes back navigation", () => {
  const { database, context } = createFixture();
  try {
    const service = new WidgetService({
      roonClient: context.roonClient,
      playlistService: context.playlistService,
      mediaService: context.mediaService,
      volumeLimitService: context.volumeLimitService,
      publicBaseUrl: null
    });
    const list = service.getPlaylists();
    assert.equal(list.widget_type, "virtual_playlists");
    assert.equal(list.playlists[0].playlist_id, "peaky_blinders_soundtrack_complete");
    const detail = service.getPlaylistDetail({
      playlist_id: "peaky_blinders_soundtrack_complete",
      limit: 25,
      offset: 0
    });
    assert.equal(detail.view, "playlist_detail");
    assert.equal(detail.tracks.length, 25);
    assert.equal(detail.pagination.has_more, true);
    assert.equal(detail.navigation.can_go_back, true);
  } finally {
    database.close();
  }
});

test("search widget returns navigable media cards and artist bio is null when unavailable", async () => {
  const { database, context } = createFixture();
  try {
    const service = new WidgetService({
      roonClient: context.roonClient,
      playlistService: context.playlistService,
      mediaService: context.mediaService,
      volumeLimitService: context.volumeLimitService,
      publicBaseUrl: null
    });
    const search = await service.getMediaSearch({ query: "Everything In Its Right Place Radiohead", types: ["track"] });
    assert.equal(search.widget_type, "media_search");
    assert.equal(search.view, "track_results");
    assert.equal(search.results[0].image_url, "/roon/images/image-2");
    const artist = service.getMediaEntity({ result_id: "media-artist-1" });
    assert.equal(artist.view, "artist_detail");
    assert.equal(artist.artist.bio, null);
    assert.deepEqual(artist.popular_tracks, []);
  } finally {
    database.close();
  }
});

test("HTTP widget endpoints expose playlists and search contracts", async () => {
  const { database, context } = createFixture();
  const server = createServer(context).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const now = await fetch(`${baseUrl}/widgets/now-playing`).then((response) => response.json());
    assert.equal(now.widget_type, "now_playing");
    const playlists = await fetch(`${baseUrl}/widgets/playlists`).then((response) => response.json());
    assert.equal(playlists.widget_type, "virtual_playlists");
    const detail = await fetch(`${baseUrl}/widgets/playlists/peaky_blinders_soundtrack_complete?limit=5`).then((response) => response.json());
    assert.equal(detail.tracks.length, 5);
    const search = await fetch(`${baseUrl}/widgets/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "Everything In Its Right Place Radiohead", types: ["track"] })
    }).then((response) => response.json());
    assert.equal(search.view, "track_results");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
  }
});
