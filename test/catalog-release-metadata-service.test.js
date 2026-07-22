const assert = require("node:assert/strict");
const test = require("node:test");

// Identity V2 release/edition diagnostics; the legacy release service keeps its own tests.

const { CatalogReleaseMetadataService } = require("../dist/services/catalogReleaseMetadataService");
const { trackCatalogIdentityV2 } = require("../dist/services/playlists/trackCatalogIdentity");

function track() {
  return {
    track_id: "purple",
    query: "Purple Haze The Jimi Hendrix Experience",
    title: "Purple Haze",
    artist: "The Jimi Hendrix Experience, Jimi Hendrix",
    album: "Single Collection",
    image_key: "roon-single-cover",
    audio_metadata: {
      title: "Purple Haze",
      artist: "The Jimi Hendrix Experience, Jimi Hendrix",
      album: "Single Collection",
      release_year: 2010
    },
    identity: {
      album: "Single Collection",
      release_year: 2010,
      duration_seconds: null
    },
    resolution: {},
    roon_binding: null
  };
}

function candidate(releaseId, year) {
  return {
    release_id: releaseId,
    release_group_id: "group-experienced",
    title: "Are You Experienced?",
    album_artist: "The Jimi Hendrix Experience",
    date: `${year}-05-12`,
    release_year: year,
    country: year === 1967 ? "GB" : "US",
    status: "Official",
    primary_type: "Album",
    secondary_types: [],
    medium_position: 1,
    track_position: 2,
    track_count: 11,
    cover_art_archive: { artwork: true, front: true, back: false }
  };
}

function recordingResult() {
  return {
    status: "exact",
    reason: "unique_compatible_recording",
    metadata: {
      recording_id: "purple-recording",
      title: "Purple Haze",
      artist: "The Jimi Hendrix Experience",
      album: "Are You Experienced?",
      disambiguation: "original studio recording",
      duration_seconds: 170,
      release_year: 1967,
      original_release_year: 1967,
      isrc: null,
      isrcs: [],
      composers: ["Jimi Hendrix"],
      lyricists: ["Jimi Hendrix"],
      genres: ["rock"],
      release_candidates: [candidate("release-1967", 1967), candidate("release-1997", 1997)],
      confidence: "high"
    },
    candidates: []
  };
}

test("release identity stops at the release group when the edition is ambiguous", async () => {
  let exactLookups = 0;
  const service = new CatalogReleaseMetadataService({ lookupReleaseTrack: async () => {
    exactLookups += 1;
    throw new Error("must not select an edition");
  } });
  const value = await service.resolve(track(), {
    title: "Purple Haze",
    primary_artists: ["The Jimi Hendrix Experience"],
    featured_artists: [],
    album_hint: "Are You Experienced?",
    release_year_hint: null,
    recording_intent: "standard",
    source: "llm_hints"
  }, recordingResult());

  assert.equal(exactLookups, 0);
  assert.equal(value.status, "release_group_candidate");
  assert.equal(value.release, null);
  assert.equal(value.release_group.musicbrainz_id, "group-experienced");
  assert.equal(value.duration.seconds, 170);
  assert.equal(value.duration.source, "musicbrainz_recording_median");
  assert.equal(value.duration.exact_for_release, false);
  assert.equal(value.cover_art.entity, "release_group");
  assert.equal(value.observations.album_title_coherence, "mismatch");
});

test("explicit edition year unlocks exact track duration and edition artwork", async () => {
  const releaseTrack = {
    release_id: "release-1967",
    release_group_id: "group-experienced",
    title: "Are You Experienced?",
    album_artist: "The Jimi Hendrix Experience",
    date: "1967-05-12",
    release_year: 1967,
    country: "GB",
    status: "Official",
    primary_type: "Album",
    secondary_types: [],
    medium_position: 1,
    track_position: 2,
    track_number: "2",
    track_title: "Purple Haze",
    duration_seconds: 173,
    cover_art_archive: { artwork: true, front: true, back: false }
  };
  const service = new CatalogReleaseMetadataService({
    lookupReleaseTrack: async (releaseId, recordingId) => {
      assert.equal(releaseId, "release-1967");
      assert.equal(recordingId, "purple-recording");
      return {
        status: "exact",
        reason: "unique_recording_track_on_release",
        metadata: releaseTrack,
        trace: {
          cache_hit: true,
          cache_layer: "persistent",
          elapsed_ms: 1,
          provider_requests: 0,
          search_attempts: [],
          candidate_counts: { returned: 0, accepted: 0, rejected: 0 },
          rejected_candidates: []
        }
      };
    }
  });
  const intent = {
    title: "Purple Haze",
    primary_artists: ["The Jimi Hendrix Experience"],
    featured_artists: [],
    album_hint: "Are You Experienced?",
    release_year_hint: 1967,
    recording_intent: "standard",
    source: "llm_hints"
  };
  const recording = recordingResult();
  const value = await service.resolve(track(), intent, recording);

  assert.equal(value.status, "exact_release");
  assert.equal(value.release.release_id, "release-1967");
  assert.deepEqual(value.duration, {
    seconds: 173,
    source: "musicbrainz_release_track",
    exact_for_release: true
  });
  assert.equal(value.cover_art.entity, "release");
  assert.equal(value.cover_art.availability, "declared");
  assert.equal(value.provider_trace.cache_hit, true);
  assert.equal(value.provider_trace.cache_layer, "persistent");

  const identity = trackCatalogIdentityV2(track(), intent, recording, false, value);
  assert.equal(identity.release.musicbrainz_id, "release-1967");
  assert.equal(identity.release.release_group_id, "group-experienced");
  assert.equal(identity.release.duration.exact_for_release, true);
  assert.equal(identity.evidence.release, "musicbrainz_release");
});

test("a wrong Roon album observation is reported instead of replaced by a popular release", async () => {
  const service = new CatalogReleaseMetadataService({ lookupReleaseTrack: async () => {
    throw new Error("must not resolve");
  } });
  const value = await service.resolve(track(), {
    title: "Purple Haze",
    primary_artists: ["The Jimi Hendrix Experience"],
    featured_artists: [],
    album_hint: null,
    release_year_hint: null,
    recording_intent: "standard",
    source: "stored_query"
  }, recordingResult());

  assert.equal(value.status, "not_found");
  assert.equal(value.reason, "release_title_not_present_for_recording");
  assert.equal(value.release_group, null);
  assert.match(value.warnings[0], /Roon album is an observation/);
});
