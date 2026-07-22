const assert = require("node:assert/strict");
const test = require("node:test");

const { PlaylistCatalogDiagnosticsService } = require("../dist/services/playlistCatalogDiagnosticsService");
const {
  catalogIntentForTrack,
  trackCatalogIdentityV2
} = require("../dist/services/playlists/trackCatalogIdentity");

function track() {
  return {
    track_id: "track-born-wild",
    query: "Born To Be Wild Steppenwolf",
    roon_item_key: "roon:born-wild",
    title: "Born To Be Wild",
    artist: "Mars Bonfire, Steppenwolf",
    album: "Live Steppenwolf",
    image_key: "cover-live",
    cover: { image_key: "cover-live" },
    position: 1,
    metadata: null,
    audio_metadata: {
      title: "Born To Be Wild",
      artist: "Mars Bonfire, Steppenwolf"
    },
    user_metadata: {
      llm_hints: {
        recording_intent: "standard",
        required_credits: [{ name: "Steppenwolf", role: "primary" }]
      }
    },
    identity: {
      version: 1,
      catalog_separated: true,
      fingerprint: "sha256:test",
      title: "Born To Be Wild",
      artist: "Mars Bonfire, Steppenwolf",
      album: "Live Steppenwolf",
      album_artist: "Steppenwolf",
      duration_seconds: null,
      isrc: null,
      release_year: null,
      track_number: null,
      disc_number: null,
      version_hint: "studio",
      source: null,
      canonical_query: "Born To Be Wild Steppenwolf"
    },
    resolution: {
      status: "manual",
      selection_origin: "portal_user",
      selected_result_id: "media:born-wild",
      selected_candidate: {
        title: "Born To Be Wild",
        artist: "Mars Bonfire, Steppenwolf"
      }
    },
    roon_binding: {
      state: "stale",
      item_key: "roon:born-wild",
      reusable: false,
      last_observed_at: null
    },
    created_at: "2026-01-01T00:00:00.000Z"
  };
}

const exact = {
  status: "exact",
  reason: "unique_compatible_recording",
  metadata: {
    recording_id: "mb-recording-born-wild",
    title: "Born to Be Wild",
    artist: "Steppenwolf",
    artists: ["Steppenwolf"],
    artist_credit: [{ musicbrainz_id: "mb-artist-steppenwolf", name: "Steppenwolf", join_phrase: "" }],
    album: null,
    disambiguation: "original studio recording",
    duration_seconds: 211,
    release_year: 1968,
    original_release_year: 1968,
    isrc: null,
    isrcs: [],
    composers: ["Mars Bonfire"],
    lyricists: [],
    genres: ["rock"],
    confidence: "medium"
  },
  candidates: [],
  trace: {
    cache_hit: false,
    cache_layer: null,
    elapsed_ms: 15,
    provider_requests: 3,
    search_attempts: [],
    candidate_counts: { returned: 1, accepted: 1, rejected: 0 },
    rejected_candidates: []
  }
};

test("identity V2 keeps the proposed artist separate from Roon display credits", () => {
  const value = track();
  const intent = catalogIntentForTrack(value);
  const identity = trackCatalogIdentityV2(value, intent, exact);
  assert.deepEqual(intent.primary_artists, ["Steppenwolf"]);
  assert.deepEqual(identity.credits.primary_artists.map((credit) => credit.name), ["Steppenwolf"]);
  assert.deepEqual(identity.credits.composers.map((credit) => credit.name), ["Mars Bonfire"]);
  assert.deepEqual(identity.credits.roon_unclassified.map((credit) => credit.name), ["Mars Bonfire", "Steppenwolf"]);
  assert.equal(identity.roon_selection.locked, true);
  assert.equal(identity.shadow, true);
});

test("identity V2 recovers a legacy primary artist from the stored query without trusting credit order", () => {
  const value = track();
  value.title = "Won't Get Fooled Again (Remastered 2022)";
  value.query = "Won't Get Fooled Again The Who";
  value.artist = "Pete Townshend, The Who";
  value.audio_metadata = { title: value.title, artist: value.artist };
  value.user_metadata = null;
  value.identity.title = value.title;
  value.identity.artist = value.artist;
  value.identity.version_hint = "remaster";
  value.resolution.selected_candidate = { title: value.title, artist: value.artist };

  const intent = catalogIntentForTrack(value);
  assert.deepEqual(intent.primary_artists, ["The Who"]);
  assert.equal(intent.source, "stored_query");
  assert.equal(intent.recording_intent, "remaster");
});

test("playlist catalog diagnostics are read-only and report the cache state", async () => {
  const value = track();
  const before = JSON.stringify(value);
  const service = new PlaylistCatalogDiagnosticsService(
    { getPlaylist: () => ({ playlist_id: "p1", tracks: [value] }) },
    { lookup: async (input) => {
      assert.equal(input.artist, "Steppenwolf");
      assert.equal(input.version_hint, "standard");
      return exact;
    } },
    { summary: () => ({ provider: "musicbrainz", total_entries: 1, active_entries: 1, expired_entries: 0, statuses: { exact: 1 } }) }
  );

  const result = await service.analyze("p1", [value.track_id]);
  assert.equal(result.mode, "shadow");
  assert.equal(result.mutates_playlist, false);
  assert.equal(result.identity_contract_version, 2);
  assert.equal(result.statuses.candidate_recording, 1);
  assert.deepEqual(result.observability.recording, {
    calls: 1,
    cache_hits: 0,
    memory_hits: 0,
    persistent_hits: 0,
    provider_requests: 3
  });
  assert.equal(JSON.stringify(value), before);
});

test("playlist diagnostics verify a stored recording MBID and flag legacy exact duration provenance", async () => {
  const value = track();
  value.audio_metadata = {
    ...value.audio_metadata,
    metadata_status: "exact",
    duration_seconds: 211,
    recording: { musicbrainz_id: "mb-recording-born-wild", title: "Born To Be Wild" },
    field_provenance: { duration_seconds: { source: "musicbrainz" } }
  };
  const before = JSON.stringify(value);
  const releaseResult = {
    status: "exact_release",
    reason: "unique_release_and_track",
    anchor: { source: "roon_observation", title: "Live Steppenwolf", release_year: null, strength: "observed" },
    release_group: { musicbrainz_id: "group", title: "Live Steppenwolf", primary_type: "Album", secondary_types: ["Live"] },
    release: {
      release_id: "release",
      release_group_id: "group",
      title: "Live Steppenwolf",
      album_artist: "Steppenwolf",
      release_year: 1969,
      medium_position: 1,
      track_position: 1,
      duration_seconds: 211,
      cover_art_archive: { artwork: true, front: true, back: false }
    },
    provider_trace: exact.trace,
    duration: { seconds: 211, source: "musicbrainz_release_track", exact_for_release: true },
    cover_art: null,
    observations: {
      roon_album: "Live Steppenwolf",
      roon_release_year: null,
      roon_cover_image_key: "cover-live",
      album_title_coherence: "consistent",
      cover_coherence: "unverified"
    },
    candidates: [],
    warnings: []
  };
  const service = new PlaylistCatalogDiagnosticsService(
    { getPlaylist: () => ({ playlist_id: "p1", tracks: [value] }) },
    { lookup: async (input) => {
      assert.equal(input.recording_id, "mb-recording-born-wild");
      return exact;
    } },
    { summary: () => ({ provider: "musicbrainz", total_entries: 1, active_entries: 1, expired_entries: 0, statuses: { exact: 1 } }) },
    undefined,
    { resolve: async () => releaseResult }
  );

  const result = await service.analyze("p1", [value.track_id]);
  assert.equal(result.tracks[0].release_result.status, "exact_release");
  assert.deepEqual(result.tracks[0].stored_metadata_audit.issues, [
    "stored_exact_duration_lacks_release_track_provenance"
  ]);
  assert.equal(JSON.stringify(value), before);
});
