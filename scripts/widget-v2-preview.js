const http = require("node:http");
const { widgetV2Html } = require("../dist/bridge-v2/widgets/resources");

function art(label, from, to) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="640" height="640" fill="url(#g)"/><circle cx="480" cy="140" r="170" fill="#fff" opacity=".08"/><text x="50%" y="52%" fill="#fff" opacity=".9" font-family="Arial" font-size="72" font-weight="700" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const media = {
  artist: { result_id: "artist-1", media_type: "artist", title: "Radiohead", subtitle: "Artist", source: "qobuz", image_url: art("RADIOHEAD", "#6b3b29", "#15110f") },
  album: { result_id: "album-1", media_type: "album", title: "Kid A", artist: "Radiohead", release_year: 2000, source: "qobuz", image_url: art("KID A", "#b5d1d0", "#626d71") },
  track: { result_id: "track-1", media_type: "track", title: "Everything In Its Right Place", artist: "Radiohead", album: "Kid A", source: "qobuz", image_url: art("01", "#b5d1d0", "#626d71") }
};

const zones = [{
  zone_id: "zone-1", name: "Despacho", state: "playing",
  now_playing: { title: "Everything In Its Right Place", artist: "Radiohead", album: "Kid A", image_url: media.album.image_url, position_seconds: 74, duration_seconds: 251 },
  volume: { output_id: "out-1", value: 18, min: 0, max: 60, step: 1, muted: false },
  grouped_outputs: [{ output_id: "out-1", name: "Despacho" }]
}, {
  zone_id: "zone-2", name: "Cocina", state: "paused",
  now_playing: { title: "Teardrop", artist: "Massive Attack", album: "Mezzanine", image_url: art("M", "#df651d", "#39160d"), position_seconds: 12, duration_seconds: 330 },
  volume: { output_id: "out-2", value: 14, min: 0, max: 60, step: 1, muted: false },
  grouped_outputs: [{ output_id: "out-2", name: "Cocina" }]
}];

const playlistCards = [
  { playlist_id: "focus", name: "Deep Focus", description: "Quiet concentration", track_count: 28, image_url: art("FOCUS", "#374f54", "#11191b") },
  { playlist_id: "night", name: "Night Signals", description: "After-hours listening", track_count: 19, image_url: art("NIGHT", "#513a66", "#16101e") },
  { playlist_id: "sunday", name: "Sunday Morning", description: "Slow starts", track_count: 34, image_url: art("SUNDAY", "#99703e", "#291a0e") }
];

function base(view, title, parent = null) {
  return { widget_version: 1, view, generated_at: new Date().toISOString(), navigation: { title, can_go_back: Boolean(parent), parent_view: parent } };
}

function fixture(view, args = {}) {
  const selected = args.zone?.id || "zone-1";
  if (view === "player") return {
    ...base("player", "Now Playing"), selected_zone_id: selected, zones,
    queue_preview: [media.track, { ...media.track, queue_item_id: 2, title: "Kid A" }, { ...media.track, queue_item_id: 3, title: "The National Anthem" }], warnings: []
  };
  if (view === "search") return {
    ...base("search", `Results for "${args.query || "Radiohead"}"`), query: args.query || "Radiohead", zones, selected_zone_id: selected,
    results: [media.artist, media.album, media.track, { ...media.album, result_id: "album-2", title: "In Rainbows", release_year: 2007, image_url: art("RAINBOWS", "#d86225", "#342313") }], warnings: []
  };
  if (view === "artist") return {
    ...base("artist", "Radiohead", "search"), zones, selected_zone_id: selected, artist: media.artist,
    biography: "Radiohead are an English rock band known for continually reshaping alternative music.",
    popular_tracks: [media.track, { ...media.track, result_id: "track-2", title: "Paranoid Android", album: "OK Computer" }],
    albums: [media.album, { ...media.album, result_id: "album-2", title: "In Rainbows", release_year: 2007, image_url: art("RAINBOWS", "#d86225", "#342313") }], singles_eps: [], warnings: []
  };
  if (view === "album") return {
    ...base("album", "Kid A", "search"), zones, selected_zone_id: selected, album: media.album,
    description: "A landmark electronic album built from fractured rhythms, synthesizers and transformed vocals.",
    tracks: ["Everything In Its Right Place", "Kid A", "The National Anthem", "How to Disappear Completely", "Treefingers", "Optimistic"].map((title, i) => ({ ...media.track, result_id: `track-${i + 1}`, title, track_number: i + 1 })), warnings: []
  };
  if (view === "queue") return {
    ...base("queue", "Queue - Despacho", "player"), zones, selected_zone_id: selected, zone: { zone_id: selected, name: "Despacho", state: "playing" },
    items: ["Everything In Its Right Place", "Kid A", "The National Anthem", "How to Disappear Completely"].map((title, i) => ({ ...media.track, queue_item_id: i + 1, position: i + 1, title }))
  };
  if (view === "playlists") return { ...base("playlists", "RoonIA Playlists"), zones, selected_zone_id: selected, playlists: playlistCards, pagination: { total: playlistCards.length } };
  if (view === "playlist") return {
    ...base("playlist", "Deep Focus", "playlists"), zones, selected_zone_id: selected,
    playlist: playlistCards[0], tracks: ["An Ending", "Says", "Near Light", "Abandon Window", "A Walk"].map((title, i) => ({ playlist_id: "focus", track_id: `p-${i}`, position: i + 1, title, artist: i % 2 ? "Nils Frahm" : "Brian Eno", album: "Focus", image_url: playlistCards[0].image_url, resolution_status: "resolved" }))
  };
  return fixture("player", args);
}

function wrapper(initialView) {
  const initial = fixture(initialView);
  return `<!doctype html><html><head><meta charset="utf-8"><title>RoonIA Widget Preview</title><style>html,body{margin:0;background:#080706}iframe{display:block;width:min(980px,100%);height:900px;margin:auto;border:0}</style></head><body><iframe id="widget" src="/widget"></iframe><script>
  const frame=document.getElementById("widget");
  const fixtures=${JSON.stringify({ zones, media, playlistCards })};
  const {zones,media,playlistCards}=fixtures;
  const initial=${JSON.stringify(initial)};
  ${art.toString()}
  ${base.toString()}
  ${fixture.toString()}
  frame.addEventListener("load",()=>frame.contentWindow.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:{_meta:{widget:initial}}},"*"));
  window.addEventListener("message",event=>{if(event.source!==frame.contentWindow)return;const msg=event.data;if(!msg||msg.jsonrpc!=="2.0"||!msg.id)return;
    if(msg.method==="tools/call"){const name=msg.params?.name;const args=msg.params?.arguments||{};let result;if(name==="roon_ui_navigate")result={structuredContent:{status:"completed",view:args.view,widget:fixture(args.view,args)}};else if(name==="roon_ui_action"){const zone=zones.find(item=>item.zone_id===(args.zone?.id||"zone-1"))||zones[0];if(args.action==="toggle")zone.state=zone.state==="playing"?"paused":"playing";if(args.action==="play")zone.state="playing";if(args.action==="pause"||args.action==="stop")zone.state=args.action==="stop"?"stopped":"paused";if(args.action==="seek")zone.now_playing.position_seconds=Number(args.value)||0;if(args.action==="volume_step")zone.volume.value+=Number(args.value)||0;if(args.action==="mute"||args.action==="unmute")zone.volume.muted=args.action==="mute";result={structuredContent:{status:"completed",action:args.action,summary:"Acción simulada y verificada.",verified:true,warnings:[],widget:fixture("player",args)}}}else result={structuredContent:{status:"failed",summary:"Unknown preview tool"}};frame.contentWindow.postMessage({jsonrpc:"2.0",id:msg.id,result},"*");}
    else frame.contentWindow.postMessage({jsonrpc:"2.0",id:msg.id,result:{}},"*");
  });
  </script></body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:3102");
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/widget") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(widgetV2Html);
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(wrapper(url.searchParams.get("view") || "player"));
});

server.listen(3102, "127.0.0.1", () => {
  console.log("RoonIA widget v2 preview http://127.0.0.1:3102/?view=player");
});
