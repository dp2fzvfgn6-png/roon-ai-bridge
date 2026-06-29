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
