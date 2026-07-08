const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PlaylistService } = require("../dist/services/playlistService");
const { enrichBrowseItem } = require("../dist/roon/roonBrowseService");

function tempConfig() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-playlists-"));
  return {
    dataDir,
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

test("migrates legacy JSON playlists to SQLite and supports full track management", () => {
  const config = tempConfig();
  fs.writeFileSync(
    path.join(config.dataDir, "virtual-playlists.json"),
    JSON.stringify(
      {
        playlists: [
          {
            playlist_id: "legacy-mix",
            name: "Legacy Mix",
            description: "Migrated",
            created_at: "2026-01-01T10:00:00.000Z",
            updated_at: "2026-01-01T10:00:00.000Z",
            tracks: [
              {
                track_id: "legacy-track-1",
                query: "bad bunny dakiti",
                title: "Dákiti",
                artist: "Bad Bunny",
                album: "El Último Tour Del Mundo",
                position: 1
              }
            ]
          }
        ]
      },
      null,
      2
    )
  );

  const service = new PlaylistService(config);
  const migrated = service.getPlaylist("legacy-mix");
  assert.equal(migrated.tracks_count, 1);
  assert.equal(migrated.tracks[0].query, "bad bunny dakiti");

  const created = service.createPlaylist({
    name: "SQLite Mix",
    tracks: [
      {
        query: "rosalia despecha",
        title: "Despechá",
        artist: "ROSALÍA",
        image_key: "img-1"
      },
      {
        query: "dua lipa houdini",
        title: "Houdini",
        artist: "Dua Lipa"
      }
    ]
  });

  assert.equal(created.tracks_count, 2);
  assert.deepEqual(created.tracks[0].cover, { image_key: "img-1" });

  const renamed = service.updatePlaylist(created.playlist_id, {
    name: "SQLite Mix Updated",
    description: "Nueva descripción"
  });
  assert.equal(renamed.name, "SQLite Mix Updated");

  const updatedTrack = service.updateTrack(created.playlist_id, renamed.tracks[0].track_id, {
    query: "rosalia despecha live",
    title: "Despechá (Live)",
    artist: "ROSALÍA",
    album: "Festival",
    metadata: {
      image_key: "img-2",
      duration_seconds: 211
    }
  });
  assert.equal(updatedTrack.tracks[0].query, "rosalia despecha live");
  assert.deepEqual(updatedTrack.tracks[0].cover, { image_key: "img-2" });

  const reordered = service.reorderTracks(created.playlist_id, [
    updatedTrack.tracks[1].track_id,
    updatedTrack.tracks[0].track_id
  ]);
  assert.equal(reordered.tracks[0].title, "Houdini");
  assert.equal(reordered.tracks[1].position, 2);

  const replaced = service.replaceTracks(created.playlist_id, [
    {
      query: "the weeknd blinding lights",
      title: "Blinding Lights",
      artist: "The Weeknd",
      metadata: {
        image_key: "img-3",
        release_year: 2020
      }
    }
  ]);
  assert.equal(replaced.tracks_count, 1);
  assert.equal(replaced.tracks[0].metadata.release_year, 2020);

  const removed = service.removeTrack(created.playlist_id, replaced.tracks[0].track_id);
  assert.equal(removed.tracks_count, 0);

  assert.deepEqual(service.deletePlaylist(created.playlist_id), {
    ok: true,
    playlist_id: created.playlist_id
  });
});

test("enriches library items with normalized song metadata and cover payload", () => {
  const enriched = enrichBrowseItem({
    title: "Dákiti",
    subtitle: "Bad Bunny",
    image_key: "cover-123",
    artist: "Bad Bunny",
    album: "El Último Tour Del Mundo",
    track_number: 3,
    disc_number: 1,
    duration_seconds: 205,
    release_year: 2020
  });

  assert.deepEqual(enriched.media, {
    title: "Dákiti",
    subtitle: "Bad Bunny",
    artist: "Bad Bunny",
    album: "El Último Tour Del Mundo",
    album_artist: null,
    composer: null,
    genre: null,
    track_number: 3,
    disc_number: 1,
    duration_seconds: 205,
    release_year: 2020,
    roon_item_key: null,
    image_key: "cover-123",
    cover: { image_key: "cover-123" }
  });
});

test("lists virtual playlists without tracks by default and paginates tracks explicitly", () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  service.createPlaylist({ name: "Empty" });
  const long = service.createPlaylist({
    name: "Long",
    tracks: Array.from({ length: 194 }, (_, index) => ({
      query: `song ${index + 1}`,
      title: `Song ${index + 1}`
    }))
  });

  const summaries = service.listPlaylists({
    includeTracks: false,
    limit: 10,
    offset: 0
  });
  assert.equal(summaries.total, 2);
  assert.equal(summaries.include_tracks, false);
  assert.equal(summaries.playlists.length, 2);
  assert.equal(summaries.playlists.find((playlist) => playlist.playlist_id === long.playlist_id).track_count, 194);
  assert.equal("tracks" in summaries.playlists[0], false);

  const paged = service.listPlaylists({
    includeTracks: true,
    limit: 1,
    offset: 0,
    trackLimit: 5,
    trackOffset: 10
  });
  assert.equal(paged.playlists.length, 1);
  assert.equal(paged.playlists[0].tracks.length, 5);
  assert.equal(paged.playlists[0].track_pagination.total, 194);
  assert.equal(paged.playlists[0].track_pagination.offset, 10);
  assert.equal(paged.playlists[0].tracks[0].position, 11);

  const outside = service.listPlaylists({
    includeTracks: true,
    limit: 10,
    offset: 99
  });
  assert.equal(outside.total, 2);
  assert.equal(outside.playlists.length, 0);
});

test("runs virtual playlist CRUD cleanup without leaking temporary resources", () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const created = service.createPlaylist({
    playlist_id: "roonia_test_crud",
    name: "roonia_test_crud",
    tracks: [{ query: "one", title: "One" }]
  });
  const added = service.addTrack(created.playlist_id, {
    query: "two",
    title: "Two"
  });
  const updated = service.updateTrack(
    created.playlist_id,
    added.tracks[0].track_id,
    { query: "one updated", title: "One Updated" }
  );
  const reordered = service.reorderTracks(created.playlist_id, [
    updated.tracks[1].track_id,
    updated.tracks[0].track_id
  ]);
  assert.equal(reordered.tracks[0].title, "Two");
  service.removeTrack(created.playlist_id, reordered.tracks[0].track_id);
  service.updatePlaylist(created.playlist_id, { name: "roonia_test_renamed" });
  service.deletePlaylist(created.playlist_id);

  assert.throws(
    () => service.getPlaylist(created.playlist_id),
    (error) => error.code === "PLAYLIST_NOT_FOUND"
  );
});

test("marks unresolved virtual playlist entries explicitly", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const mediaService = {
    async search(request) {
      assert.equal(request.query, "Imaginary Song Imaginary Artist");
      assert.equal(request.types, undefined);
      return {
        query: request.query,
        source_preference: request.sourcePreference || "highest_quality",
        results: [],
        warnings: []
      };
    }
  };

  const playlist = await service.createPlaylistResolved(
    {
      name: "Unresolved Mix",
      tracks: [
        {
          title: "Imaginary Song",
          artist: "Imaginary Artist"
        }
      ]
    },
    { mediaService }
  );

  assert.equal(playlist.tracks_count, 1);
  assert.equal(playlist.tracks[0].query, "Imaginary Song Imaginary Artist");
  assert.equal(playlist.tracks[0].roon_item_key, null);
  assert.equal(playlist.tracks[0].metadata.resolution.status, "unresolved");
  assert.match(
    playlist.tracks[0].metadata.resolution.reason,
    /no results/i
  );
});

test("resolves virtual playlist entries with the best playable track", async () => {
  const config = tempConfig();
  const service = new PlaylistService(config);
  const mediaService = {
    async search(request) {
      assert.equal(request.query, "Red Right Hand Nick Cave Bad Seeds");
      assert.equal(request.types, undefined);
      return {
        query: request.query,
        source_preference: request.sourcePreference || "highest_quality",
        warnings: [],
        results: [
          {
            result_id: "media_album",
            roon_item_key: "album-key",
            media_type: "album",
            title: "Red Right Hand",
            subtitle: "Nick Cave & the Bad Seeds",
            image_key: null,
            source: "tidal",
            source_confidence: "medium",
            quality: null,
            playable: true,
            expires_at: new Date().toISOString()
          },
          {
            result_id: "media_track",
            roon_item_key: "track-key",
            media_type: "track",
            title: "Red Right Hand",
            subtitle: "Nick Cave & the Bad Seeds",
            image_key: "cover-key",
            source: "tidal",
            source_confidence: "medium",
            quality: {
              label: "24-bit / 96 kHz / FLAC",
              bit_depth: 24,
              sample_rate_hz: 96000,
              format: "FLAC"
            },
            playable: true,
            expires_at: new Date().toISOString()
          }
        ]
      };
    }
  };

  const playlist = await service.createPlaylistResolved(
    {
      name: "Resolved Mix",
      tracks: [
        {
          title: "Red Right Hand",
          artist: "Nick Cave & the Bad Seeds",
          query: "Red Right Hand Nick Cave Bad Seeds"
        }
      ]
    },
    { mediaService }
  );

  assert.equal(playlist.tracks[0].roon_item_key, "track-key");
  assert.equal(playlist.tracks[0].metadata.resolution.status, "resolved");
  assert.equal(playlist.tracks[0].metadata.resolution.result.result_id, "media_track");
  assert.equal(playlist.tracks[0].image_key, "cover-key");
});
