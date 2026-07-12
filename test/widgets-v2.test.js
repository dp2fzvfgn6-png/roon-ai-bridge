const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { WidgetV2ViewService } = require("../dist/bridge-v2/widgets/viewService");
const { createDatabase } = require("../dist/db/database");
const { PlaylistService } = require("../dist/services/playlistService");

function media(id, type, title) {
  return {
    result_id: id,
    type,
    media_type: type,
    title,
    artist: type === "artist" ? null : "Radiohead",
    album: type === "track" ? "Kid A" : null,
    album_artist: "Radiohead",
    subtitle: "Radiohead",
    version_hint: "studio",
    image_key: `image-${id}`,
    source: "qobuz",
    source_confidence: "high",
    quality: { label: "24-bit / 96 kHz", bit_depth: 24, sample_rate_hz: 96000, format: "FLAC" },
    is_library: false,
    playable: true,
    match_score: 95,
    confidence: "high",
    match_reasons: [],
    match_penalties: [],
    version_penalties: [],
    warnings: [],
    expires_at: new Date(Date.now() + 60000).toISOString()
  };
}

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-widget-v2-"));
  const config = { dataDir, publicBaseUrl: "https://example.test" };
  const database = createDatabase(config);
  const playlists = new PlaylistService(config, database);
  playlists.createPlaylist({
    playlist_id: "focus",
    name: "Focus",
    tracks: [{ track_id: "t1", query: "Everything", title: "Everything", artist: "Radiohead", image_key: "cover-1" }]
  });
  const zone = {
    zone_id: "zone-1",
    display_name: "Despacho",
    state: "playing",
    now_playing: {
      image_key: "now-1", seek_position: 30, length: 240,
      three_line: { line1: "Everything In Its Right Place", line2: "Radiohead", line3: "Kid A" }
    },
    outputs: [{
      output_id: "out-1", display_name: "Despacho",
      volume: { type: "number", min: 0, max: 60, value: 18, step: 1, is_muted: false }
    }],
    settings: { shuffle: false, auto_radio: false, loop: "disabled" }
  };
  const artist = media("artist-1", "artist", "Radiohead");
  const album = media("album-1", "album", "Kid A");
  const track = media("track-1", "track", "Everything In Its Right Place");
  const refs = new Map([[artist.result_id, artist], [album.result_id, album], [track.result_id, track]]);
  const context = {
    config,
    roonClient: {
      getZones: () => [zone], getZone: (id) => id === zone.zone_id ? zone : null,
      getOutputs: () => zone.outputs, getOutput: () => zone.outputs[0],
      getTransport: () => ({}), isCoreConnected: () => true, getCoreName: () => "Test Core",
      isTransportReady: () => false, isBrowseReady: () => true, isImageReady: () => true
    },
    playlistService: playlists,
    mediaService: {
      search: async () => ({ query: "Radiohead", results: [artist, album, track], recommended_result_id: artist.result_id, selection_required: false, ambiguous: false, warnings: [] }),
      get: (id) => refs.get(id),
      getArtistDetail: async () => ({ artist, bio: "English alternative rock band.", popular_tracks: [track], albums: [album], singles_eps: [], warnings: [] }),
      getAlbumDetail: async () => ({ album, description: "A landmark album.", tracks: [track], warnings: [] })
    }
  };
  return { database, context };
}

test("v2 player view returns live zone state, artwork URL and controls data", async () => {
  const { database, context } = fixture();
  try {
    const view = await new WidgetV2ViewService(context).player();
    assert.equal(view.view, "player");
    assert.equal(view.selected_zone_id, "zone-1");
    assert.equal(view.zones[0].now_playing.title, "Everything In Its Right Place");
    assert.equal(view.zones[0].now_playing.image_url, "https://example.test/roon/images/now-1");
    assert.equal(view.zones[0].volume.value, 18);
    assert.equal(JSON.stringify(view).includes("base64"), false);
  } finally { database.close(); }
});

test("v2 media explorer exposes rich artist and album drill-down data", async () => {
  const { database, context } = fixture();
  try {
    const service = new WidgetV2ViewService(context);
    const search = await service.search({ query: "Radiohead" });
    assert.equal(search.view, "search");
    assert.deepEqual(search.results.map((item) => item.media_type), ["artist", "album", "track"]);
    const artist = await service.entity({ result_id: "artist-1" });
    assert.equal(artist.view, "artist");
    assert.equal(artist.biography, "English alternative rock band.");
    assert.equal(artist.popular_tracks[0].title, "Everything In Its Right Place");
    assert.equal(artist.albums[0].title, "Kid A");
    const album = await service.entity({ result_id: "album-1" });
    assert.equal(album.view, "album");
    assert.equal(album.tracks[0].title, "Everything In Its Right Place");
  } finally { database.close(); }
});

test("v2 library views navigate from playlist cards to track details", () => {
  const { database, context } = fixture();
  try {
    const service = new WidgetV2ViewService(context);
    const list = service.playlists();
    assert.equal(list.view, "playlists");
    assert.equal(list.selected_zone_id, "zone-1");
    assert.equal(list.zones[0].name, "Despacho");
    assert.equal(list.playlists[0].playlist_id, "focus");
    const detail = service.playlist({ playlist_id: "focus" });
    assert.equal(detail.view, "playlist");
    assert.equal(detail.tracks[0].title, "Everything");
    assert.equal(detail.tracks[0].playlist_id, "focus");
    assert.equal(detail.navigation.parent_view, "playlists");
  } finally { database.close(); }
});
