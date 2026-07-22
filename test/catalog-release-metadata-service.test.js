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

function trace() {
  return {
    cache_hit: false,
    cache_layer: null,
    elapsed_ms: 1,
    provider_requests: 1,
    search_attempts: [],
    candidate_counts: { returned: 1, accepted: 1, rejected: 0 },
    rejected_candidates: [],
    accepted_warnings: []
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

test("verified Roon year disc and track observations can identify one exact edition", async () => {
  const valueTrack = track();
  valueTrack.album = "Are You Experienced?";
  valueTrack.audio_metadata.album = "Are You Experienced?";
  valueTrack.audio_metadata.release_year = 1967;
  valueTrack.audio_metadata.disc_number = 1;
  valueTrack.audio_metadata.track_number = 2;
  valueTrack.identity.album = "Are You Experienced?";
  valueTrack.identity.release_year = 1967;
  const service = new CatalogReleaseMetadataService({
    lookupReleaseTrack: async (releaseId, recordingId) => {
      assert.equal(releaseId, "release-1967");
      assert.equal(recordingId, "purple-recording");
      return {
        status: "exact",
        reason: "unique_recording_track_on_release",
        metadata: {
          ...candidate("release-1967", 1967),
          track_number: "2",
          track_title: "Purple Haze",
          duration_seconds: 173
        },
        trace: trace()
      };
    }
  });

  const value = await service.resolve(valueTrack, {
    title: "Purple Haze",
    primary_artists: ["The Jimi Hendrix Experience"],
    featured_artists: [],
    album_hint: null,
    release_year_hint: null,
    recording_intent: "standard",
    source: "stored_query"
  }, recordingResult());

  assert.equal(value.status, "exact_release");
  assert.equal(value.anchor.release_year, 1967);
  assert.equal(value.release.release_id, "release-1967");
  assert.equal(value.duration.exact_for_release, true);
});

test("a wrong Roon album observation is reported instead of replaced by a popular release", async () => {
  const service = new CatalogReleaseMetadataService({
    lookupReleaseTrack: async () => { throw new Error("must not resolve"); },
    findRecordingReleasesByTitle: async () => ({ releases: [], trace: trace() }),
    listRecordingReleases: async () => ({
      releases: recordingResult().metadata.release_candidates,
      truncated: false,
      trace: trace()
    })
  });
  const value = await service.resolve(track(), {
    title: "Purple Haze",
    primary_artists: ["The Jimi Hendrix Experience"],
    featured_artists: [],
    album_hint: null,
    release_year_hint: null,
    recording_intent: "standard",
    source: "stored_query"
  }, recordingResult());

  assert.equal(value.status, "anchor_conflict");
  assert.equal(value.reason, "roon_observation_not_a_release_of_recording");
  assert.equal(value.release_group, null);
  assert.match(value.warnings[0], /complete MusicBrainz release list/);
});

test("release identity finds an observed edition outside the recording detail response", async () => {
  const completeCandidate = {
    ...candidate("release-compilation", 1972),
    release_group_id: "group-compilation",
    title: "Smash Hits"
  };
  let catalogCalls = 0;
  const service = new CatalogReleaseMetadataService({
    findRecordingReleasesByTitle: async (recordingId, releaseTitle) => {
      catalogCalls += 1;
      assert.equal(recordingId, "purple-recording");
      assert.equal(releaseTitle, "Smash Hits");
      return { releases: [completeCandidate], trace: trace() };
    },
    listRecordingReleases: async () => { throw new Error("targeted anchor search should be enough"); },
    lookupReleaseTrack: async (releaseId, recordingId) => {
      assert.equal(releaseId, "release-compilation");
      assert.equal(recordingId, "purple-recording");
      return {
        status: "exact",
        reason: "unique_recording_track_on_release",
        metadata: {
          ...completeCandidate,
          track_number: "1",
          track_title: "Purple Haze",
          duration_seconds: 173
        },
        trace: trace()
      };
    }
  });
  const valueTrack = track();
  valueTrack.album = "Smash Hits";
  valueTrack.audio_metadata.album = "Smash Hits";
  valueTrack.audio_metadata.release_year = 1972;
  valueTrack.identity.album = "Smash Hits";
  valueTrack.identity.release_year = 1972;

  const value = await service.resolve(valueTrack, {
    title: "Purple Haze",
    primary_artists: ["The Jimi Hendrix Experience"],
    featured_artists: [],
    album_hint: null,
    release_year_hint: null,
    recording_intent: "standard",
    source: "stored_query"
  }, recordingResult());

  assert.equal(catalogCalls, 1);
  assert.equal(value.status, "exact_release");
  assert.equal(value.release.release_id, "release-compilation");
  assert.equal(value.release_group.musicbrainz_id, "group-compilation");
  assert.equal(value.duration.seconds, 173);
  assert.equal(value.candidate_provider_trace.provider_requests, 1);
});

test("a bracketed Roon edition year does not become part of the album title", async () => {
  const edition = {
    ...candidate("release-best-of", 2003),
    release_group_id: "group-best-of",
    title: "The Very Best Of"
  };
  const service = new CatalogReleaseMetadataService({
    lookupReleaseTrack: async () => ({ status: "not_found", reason: "missing", metadata: null, trace: trace() }),
    findRecordingReleasesByTitle: async () => ({ releases: [edition], trace: trace() }),
    listRecordingReleases: async () => { throw new Error("targeted anchor search should be enough"); }
  });
  const valueTrack = track();
  valueTrack.album = "The Very Best Of [2003]";
  valueTrack.audio_metadata.album = "The Very Best Of [2003]";
  valueTrack.identity.album = "The Very Best Of [2003]";

  const value = await service.resolve(valueTrack, {
    title: "Purple Haze",
    primary_artists: ["The Jimi Hendrix Experience"],
    featured_artists: [],
    album_hint: null,
    release_year_hint: null,
    recording_intent: "standard",
    source: "stored_query"
  }, recordingResult());

  assert.equal(value.status, "release_group_candidate");
  assert.equal(value.release_group.title, "The Very Best Of");
  assert.equal(value.observations.album_title_coherence, "consistent");
});

test("a truncated release browse remains insufficient instead of declaring an anchor conflict", async () => {
  const service = new CatalogReleaseMetadataService({
    lookupReleaseTrack: async () => { throw new Error("must not resolve"); },
    findRecordingReleasesByTitle: async () => ({ releases: [], trace: trace() }),
    listRecordingReleases: async () => ({
      releases: recordingResult().metadata.release_candidates,
      truncated: true,
      trace: trace()
    })
  });
  const value = await service.resolve(track(), {
    title: "Purple Haze",
    primary_artists: ["The Jimi Hendrix Experience"],
    featured_artists: [],
    album_hint: null,
    release_year_hint: null,
    recording_intent: "standard",
    source: "stored_query"
  }, recordingResult());

  assert.equal(value.status, "insufficient_evidence");
  assert.equal(value.reason, "release_catalog_truncated_before_anchor");
  assert.match(value.warnings[0], /bounded MusicBrainz release browse/);
});
