const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { PlaylistMetadataEnrichmentService } = require("../dist/services/playlistMetadataEnrichmentService");
const { PlaylistRepairService } = require("../dist/services/playlistRepairService");
const { PlaylistService } = require("../dist/services/playlistService");

function tempConfig() {
  return {
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "roonia-metadata-")),
    port: 3000,
    nodeEnv: "test",
    logLevel: "silent",
    roonExtensionName: "RoonIA",
    roonExtensionId: "test",
    enableBrowse: true,
    enableMcp: true,
    enableAuth: false,
    apiToken: null,
    publicBaseUrl: "http://localhost",
    oauthIssuer: "http://localhost",
    oauthApprovalPin: null,
    roonStreamingSource: "tidal"
  };
}

function mediaTrack(overrides = {}) {
  return {
    result_id: "track-result",
    roon_item_key: "roon:track",
    type: "track",
    media_type: "track",
    title: "Song",
    artist: "Artist",
    artists: [],
    album: "Album",
    album_artist: "Artist",
    version_hint: "studio",
    subtitle: "Artist",
    image_key: "image-key",
    source: "tidal",
    source_confidence: "high",
    quality: null,
    is_library: false,
    playable: true,
    is_best_match: true,
    selection_required: false,
    match_score: 100,
    confidence: "high",
    match_reasons: [],
    match_penalties: [],
    version_penalties: [],
    warnings: [],
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    release_year: null,
    duration_seconds: null,
    track_number: null,
    disc_number: null,
    content_count: null,
    release_type: null,
    release_type_source: null,
    release_section: null,
    roon_rank: 0,
    direct_match: true,
    direct_match_score: 100,
    data_origin: "roon_search_session",
    completeness: "unknown",
    ordered: null,
    identity_verified: true,
    links: {
      artist: null,
      artists: [],
      album: { type: "album", title: "Album", artist: "Artist", result_id: "album-result" }
    },
    ...overrides
  };
}

test("metadata refresh hydrates album data and never erases an existing observed value", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const playlist = playlistService.createPlaylist({
    name: "Metadata",
    tracks: [{
      query: "Song Artist",
      title: "Song",
      artist: "Artist",
      album: "Album",
      audio_metadata: { title: "Song", artist: "Artist", album: "Album", composer: "Stored Composer" },
      resolution: { status: "resolved", selected_result_id: "old-result" }
    }]
  });
  const detailed = mediaTrack({ duration_seconds: 245, track_number: 4, release_year: 1999 });
  const media = {
    async search() { return { results: [] }; },
    async getAlbumDetail() {
      return {
        album: mediaTrack({ result_id: "album-result", type: "album", media_type: "album", title: "Album", playable: false }),
        tracks: [detailed],
        related_tracks: [],
        warnings: []
      };
    }
  };
  const service = new PlaylistMetadataEnrichmentService(playlistService, media);
  const identityFingerprint = playlist.tracks[0].identity.fingerprint;
  const result = await service.refreshTrack(playlist.playlist_id, playlist.tracks[0].track_id, {
    result: mediaTrack({ composer: null })
  });

  assert.equal(result.report.status, "completed");
  assert.equal(result.track.audio_metadata.duration_seconds, 245);
  assert.equal(result.track.audio_metadata.track_number, 4);
  assert.equal(result.track.audio_metadata.release_year, 1999);
  assert.equal(result.track.audio_metadata.composer, "Stored Composer");
  assert.equal(result.track.identity.fingerprint, identityFingerprint);
  assert.deepEqual(result.report.completeness.missing_fields, []);
});

test("manual repair validates the selected track, marks it manual and enriches it", async () => {
  const playlistService = new PlaylistService(tempConfig());
  const playlist = playlistService.createPlaylist({
    name: "Repair",
    tracks: [{ query: "Song Artist", title: "Song", artist: "Artist", resolution: { status: "ambiguous" } }]
  });
  const selected = mediaTrack();
  const media = {
    get() { return selected; },
    async search() { return { results: [] }; },
    async getAlbumDetail() {
      return {
        album: mediaTrack({ result_id: "album-result", type: "album", media_type: "album", title: "Album", playable: false }),
        tracks: [mediaTrack({ duration_seconds: 200 })],
        related_tracks: [],
        warnings: []
      };
    }
  };
  const metadataService = new PlaylistMetadataEnrichmentService(playlistService, media);
  const repairService = new PlaylistRepairService(playlistService, media, metadataService);
  const result = await repairService.selectTrack({
    playlistId: playlist.playlist_id,
    trackId: playlist.tracks[0].track_id,
    resultId: selected.result_id,
    selectionOrigin: "portal_user"
  });

  assert.equal(result.track.resolution.status, "manual");
  assert.equal(result.track.resolution.selection_origin, "portal_user");
  assert.equal(result.track.audio_metadata.duration_seconds, 200);
});
