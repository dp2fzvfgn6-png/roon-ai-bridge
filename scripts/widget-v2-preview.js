const http = require("node:http");
const { widgetV2Html } = require("../dist/bridge-v2/widgets/resources");

function art(label, from, to) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="640" height="640" fill="url(#g)"/><text x="50%" y="52%" fill="#fff" opacity=".9" font-family="Arial" font-size="72" font-weight="700" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const albumArt = art("KID A", "#678475", "#151917");
const playlistArt = art("FOCUS", "#c16048", "#151917");
const artist = { result_id: "artist-1", media_type: "artist", title: "Radiohead", image_url: art("R", "#384941", "#0f1211") };
const album = { result_id: "album-1", media_type: "album", title: "Kid A", artist: "Radiohead", release_year: 2000, image_url: albumArt };
const tracks = ["Everything In Its Right Place", "Kid A", "The National Anthem", "How to Disappear Completely"].map((title, index) => ({
  result_id: `track-${index + 1}`,
  media_type: "track",
  title,
  artist: "Radiohead",
  album: "Kid A",
  track_number: index + 1,
  duration_seconds: 245 + index * 17,
  image_url: albumArt
}));

function fixture(view) {
  const common = { widget_version: 3, generated_at: new Date().toISOString(), warnings: [] };
  if (view === "media" || view === "artist") return {
    ...common,
    view: "artist",
    title: "Radiohead",
    artist,
    popular_tracks: tracks.slice(0, 3),
    albums: [album, { ...album, result_id: "album-2", title: "In Rainbows", release_year: 2007 }],
    singles_eps: [{ ...album, result_id: "album-3", title: "My Iron Lung", release_year: 1994 }]
  };
  if (view === "album") return {
    ...common,
    view: "album",
    title: "Kid A",
    album,
    description: "A landmark electronic album built from fractured rhythms and transformed vocals.",
    tracks
  };
  if (view === "playlist") return {
    ...common,
    view: "playlist",
    title: "Deep Focus",
    playlist: { playlist_id: "focus", name: "Deep Focus", description: "Quiet concentration.", track_count: tracks.length, image_url: playlistArt },
    tracks: tracks.map((track, index) => ({ ...track, position: index + 1 })),
    pagination: { returned: tracks.length, total: tracks.length, has_more: false }
  };
  if (view === "library") return {
    ...common,
    view: "playlist_library",
    title: "Biblioteca de playlists",
    playlists: [
      { playlist_id: "focus", name: "Deep Focus", description: "Quiet concentration.", track_count: 24, total_duration_seconds: 5310, last_played_at: new Date().toISOString(), image_url: playlistArt },
      { playlist_id: "night", name: "Night Drive", description: "Electronic motion after dark.", track_count: 18, total_duration_seconds: 4380, image_url: art("NIGHT", "#25333c", "#0f1211") }
    ],
    pagination: { returned: 2, total: 2, has_more: false }
  };
  if (view === "queue") return {
    ...common,
    view: "queue",
    title: "A continuación · Despacho",
    zone: { zone_id: "zone-1", name: "Despacho", state: "playing", now_playing: { title: tracks[0].title, artist: "Radiohead", album: "Kid A", image_url: albumArt } },
    items: tracks.map((track, index) => ({ ...track, queue_item_id: index + 10, position: index + 1 })),
    total_duration_seconds: tracks.reduce((sum, track) => sum + track.duration_seconds, 0),
    duration_known_item_count: tracks.length,
    truncated: false
  };
  if (view === "zones") return {
    ...common,
    view: "zones",
    title: "Panel de zonas",
    core: { name: "Roon Server", connected: true, transport_ready: true },
    zone_count: 2,
    states: { playing: 1, paused: 1 },
    zones: [
      { zone_id: "zone-1", name: "Despacho", state: "playing", media: { title: tracks[0].title, artist: "Radiohead", album: "Kid A", image_url: albumArt }, outputs: [{ output_id: "left", name: "Despacho", volume: { value: 18, muted: false }, safe_limit: { name: "Despacho seguro", safe_max: 25 } }], playback_settings: { shuffle: false, auto_radio: true, loop: "disabled" } },
      { zone_id: "zone-2", name: "Cocina", state: "paused", media: { title: "Idioteque", artist: "Radiohead", album: "Kid A", image_url: albumArt }, outputs: [{ output_id: "kitchen", name: "Cocina", volume: { value: 12, muted: false }, safe_limit: null }], playback_settings: { shuffle: true, auto_radio: false, loop: "disabled" } }
    ]
  };
  return {
    ...common,
    view: "now_playing",
    title: "Ahora suena",
    requested_zone: null,
    zones: [{
      zone_id: "zone-1",
      name: "Despacho",
      media: { title: tracks[0].title, artist: "Radiohead", album: "Kid A", image_url: albumArt },
      outputs: [
        { output_id: "left", name: "Despacho izquierdo", volume: { value: 18, type: "number", muted: false } },
        { output_id: "right", name: "Despacho derecho", volume: { value: 21, type: "number", muted: true } }
      ]
    }]
  };
}

function wrapper(initialView) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>RoonIA Widget v19 Preview</title><style>html,body{margin:0;padding:24px;background:#e9ecea}iframe{display:block;width:min(920px,100%);height:760px;margin:auto;border:0}</style></head><body><iframe id="widget" src="/widget"></iframe><script>const frame=document.getElementById("widget");const initial=${JSON.stringify(fixture(initialView))};frame.addEventListener("load",()=>frame.contentWindow.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:{_meta:{widget:initial}}},"*"));</script></body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:3102");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(url.pathname === "/widget" ? widgetV2Html : wrapper(url.searchParams.get("view") || "now_playing"));
});

server.listen(3102, "127.0.0.1", () => {
  console.log("RoonIA widget v19 preview http://127.0.0.1:3102/?view=now_playing");
  console.log("Other views: media, album, playlist, library, queue, zones");
});
