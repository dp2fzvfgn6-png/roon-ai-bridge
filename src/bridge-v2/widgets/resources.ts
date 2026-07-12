import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const WIDGET_V2_VERSION = "v10";
export const WIDGET_V2_URIS = {
  player: `ui://roon-ai-bridge/${WIDGET_V2_VERSION}/player.html`,
  media: `ui://roon-ai-bridge/${WIDGET_V2_VERSION}/media-explorer.html`,
  library: `ui://roon-ai-bridge/${WIDGET_V2_VERSION}/library.html`
} as const;

export const widgetV2Html = `
<main id="app" class="app" aria-live="polite">
  <header class="topbar">
    <button class="brand" data-nav="player" aria-label="Open now playing">
      <span class="brand-mark">R</span><span>RoonIA</span>
    </button>
    <nav class="tabs" aria-label="RoonIA views">
      <button data-nav="player">Player</button>
      <button data-nav="search">Explore</button>
      <button data-nav="queue">Queue</button>
      <button data-nav="playlists">Playlists</button>
    </nav>
    <select id="zone-select" aria-label="Playback zone"></select>
  </header>
  <form id="search-form" class="searchbar">
    <span aria-hidden="true">⌕</span>
    <input id="search-input" type="search" placeholder="Search artists, albums, tracks…" autocomplete="off">
    <button type="submit">Search</button>
  </form>
  <section id="status" class="status" hidden></section>
  <section id="content" class="content">
    <div class="loading"><span></span><span></span><span></span></div>
  </section>
  <div id="toast" class="toast" role="status" hidden></div>
</main>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #f6f1e7; background: #0d0c0b; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 280px; background: radial-gradient(circle at 10% 0%, #312219 0, #14110f 34%, #0d0c0b 75%); }
  button, input, select { font: inherit; }
  button { cursor: pointer; }
  .app { min-height: 360px; padding: 14px; }
  .topbar { display: grid; grid-template-columns: auto 1fr minmax(120px, 180px); gap: 14px; align-items: center; }
  .brand { display: flex; gap: 8px; align-items: center; border: 0; color: #fff7eb; background: transparent; font-weight: 800; letter-spacing: .02em; padding: 0; }
  .brand-mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; color: #1a1009; background: linear-gradient(145deg,#ffbd63,#dc6c24); box-shadow: 0 5px 18px #e47c3038; }
  .tabs { display: flex; gap: 3px; overflow-x: auto; scrollbar-width: none; }
  .tabs button { border: 0; border-radius: 999px; padding: 7px 11px; background: transparent; color: #a99d91; font-size: 12px; font-weight: 700; }
  .tabs button.active, .tabs button:hover { color: #fff; background: #ffffff12; }
  select, input { border: 1px solid #ffffff14; border-radius: 10px; background: #171412; color: #f7eee5; outline: none; }
  select { padding: 8px 9px; width: 100%; }
  .searchbar { display: grid; grid-template-columns: auto 1fr auto; gap: 9px; align-items: center; margin: 15px 0; padding: 7px 8px 7px 12px; border: 1px solid #ffffff12; border-radius: 14px; background: #171412d9; box-shadow: 0 12px 34px #0005; }
  .searchbar input { border: 0; padding: 5px 0; background: transparent; }
  .searchbar button, .primary { border: 0; border-radius: 9px; padding: 8px 12px; color: #21140b; background: linear-gradient(135deg,#ffbd63,#e47b31); font-weight: 800; }
  .status { margin-bottom: 12px; padding: 10px 12px; border-radius: 10px; color: #ffd9a8; background: #ba5a2222; border: 1px solid #f28a3a33; font-size: 12px; }
  .content { min-height: 260px; }
  .hero { display: grid; grid-template-columns: minmax(150px, 230px) 1fr; gap: 22px; align-items: end; padding: 18px; border: 1px solid #ffffff12; border-radius: 22px; overflow: hidden; background: linear-gradient(135deg,#ffffff0c,#ffffff03); box-shadow: 0 22px 60px #0008; }
  .cover { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 16px; background: linear-gradient(135deg,#443127,#17110d); box-shadow: 0 22px 48px #0009; }
  .cover.placeholder { display: grid; place-items: center; color: #c77a44; font-size: 46px; }
  .eyebrow { margin: 0 0 7px; color: #e99854; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  h1 { margin: 0; font-size: clamp(25px,6vw,48px); line-height: 1.02; letter-spacing: -.04em; }
  h2 { margin: 0; font-size: 18px; }
  .subtitle { margin: 9px 0 0; color: #c1b6aa; }
  .muted { color: #90857b; }
  .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 17px; }
  .icon-button, .secondary { border: 1px solid #ffffff16; color: #f9eee4; background: #ffffff0a; }
  .icon-button { width: 38px; height: 38px; border-radius: 50%; font-size: 15px; }
  .icon-button.play { width: 48px; height: 48px; color: #21140b; background: #ffad5c; border: 0; }
  .secondary { border-radius: 9px; padding: 8px 11px; font-weight: 700; }
  .secondary:hover, .icon-button:hover { background: #ffffff18; }
  .progress { margin-top: 18px; }
  .track { height: 4px; border-radius: 10px; background: #ffffff18; overflow: hidden; }
  .track i { display: block; height: 100%; background: linear-gradient(90deg,#e2702d,#ffc06c); }
  .times { display: flex; justify-content: space-between; margin-top: 6px; color: #8e8379; font-size: 11px; }
  .section { margin-top: 20px; }
  .section-head { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(138px,1fr)); gap: 11px; }
  .card { position: relative; min-width: 0; padding: 10px; border: 1px solid #ffffff0e; border-radius: 14px; background: #ffffff07; transition: transform .16s ease, background .16s ease; }
  .card:hover { transform: translateY(-2px); background: #ffffff0d; }
  .card .cover { border-radius: 10px; }
  .card h3 { margin: 9px 0 0; overflow: hidden; color: #fff8ef; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .card p { margin: 4px 0 0; overflow: hidden; color: #9e9388; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .card-click { display: block; width: 100%; padding: 0; border: 0; text-align: left; color: inherit; background: transparent; }
  .card-actions { display: flex; gap: 5px; margin-top: 9px; }
  .card-actions button { flex: 1; border: 1px solid #ffffff12; border-radius: 8px; padding: 6px; color: #f5e8dc; background: #ffffff08; font-size: 11px; font-weight: 700; }
  .list { display: grid; gap: 5px; }
  .row { display: grid; grid-template-columns: 34px 44px minmax(0,1fr) auto; gap: 10px; align-items: center; min-height: 54px; padding: 7px 9px; border: 1px solid transparent; border-radius: 11px; }
  .row:hover { border-color: #ffffff0e; background: #ffffff07; }
  .row .mini-cover { width: 42px; height: 42px; border-radius: 8px; object-fit: cover; background: #2b211b; }
  .row strong, .row small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row small { margin-top: 3px; color: #8f857b; }
  .row-actions { display: flex; gap: 5px; }
  .row-actions button { border: 0; border-radius: 8px; padding: 7px 9px; color: #f2e5da; background: #ffffff0b; }
  .pill { display: inline-flex; margin: 8px 5px 0 0; padding: 5px 8px; border-radius: 999px; color: #ddb994; background: #c66d2b18; border: 1px solid #d6793133; font-size: 10px; font-weight: 700; }
  .empty { display: grid; place-items: center; min-height: 240px; padding: 30px; text-align: center; color: #8f857b; border: 1px dashed #ffffff16; border-radius: 18px; }
  .loading { display: flex; justify-content: center; gap: 6px; padding: 90px 0; }
  .loading span { width: 7px; height: 7px; border-radius: 50%; background: #e48540; animation: pulse 1s infinite alternate; }
  .loading span:nth-child(2){animation-delay:.18s}.loading span:nth-child(3){animation-delay:.36s}
  .toast { position: fixed; right: 16px; bottom: 16px; max-width: 300px; padding: 10px 13px; border: 1px solid #ffffff16; border-radius: 11px; color: #f9eee4; background: #211a16ee; box-shadow: 0 12px 32px #0009; font-size: 12px; }
  @keyframes pulse { to { transform: translateY(-7px); opacity: .35; } }
  @media (max-width: 620px) { .app{padding:11px}.topbar{grid-template-columns:auto 1fr}.tabs{order:3;grid-column:1/-1}.topbar select{justify-self:end}.hero{grid-template-columns:100px 1fr;gap:14px;padding:13px}.hero h1{font-size:25px}.row{grid-template-columns:24px 38px minmax(0,1fr)}.row-actions{grid-column:3}.searchbar{margin-top:11px} }
</style>
<script type="module">
  const content = document.getElementById("content");
  const statusEl = document.getElementById("status");
  const zoneSelect = document.getElementById("zone-select");
  const searchInput = document.getElementById("search-input");
  const toast = document.getElementById("toast");
  let requestId = 1;
  const pending = new Map();
  let payload = null;
  let state = Object.assign({ view: "player", selectedZoneId: null, query: "", history: [] }, window.openai?.widgetState || {});

  function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function(ch){ if(ch==="&")return "&amp;";if(ch==="<")return "&lt;";if(ch===">")return "&gt;";if(ch.charCodeAt(0)===34)return "&quot;";return "&#39;"; }); }
  function attr(value) { return esc(value); }
  function fmtTime(value) { const n = Number(value); if (!Number.isFinite(n) || n < 0) return "0:00"; return Math.floor(n/60) + ":" + String(Math.floor(n%60)).padStart(2,"0"); }
  function cover(url, cls) { return url ? '<img class="'+(cls||"cover")+'" src="'+attr(url)+'" alt="">' : '<div class="'+(cls||"cover")+' placeholder">R</div>'; }
  function persist() { window.openai?.setWidgetState?.(state); }
  function notify(message) { toast.textContent = message; toast.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(function(){ toast.hidden = true; }, 2600); }
  function setBusy(on) { if (on) content.innerHTML = '<div class="loading"><span></span><span></span><span></span></div>'; }

  function rpc(method, params) {
    return new Promise(function(resolve, reject){
      const id = requestId++;
      pending.set(id, {resolve:resolve,reject:reject});
      window.parent.postMessage({jsonrpc:"2.0",id:id,method:method,params:params}, "*");
      setTimeout(function(){ if (pending.has(id)) { pending.delete(id); reject(new Error("Host request timed out")); } }, 15000);
    });
  }
  async function callTool(name, args) {
    if (window.openai && typeof window.openai.callTool === "function") return window.openai.callTool(name, args);
    return rpc("tools/call", {name:name,arguments:args});
  }
  function widgetFromResult(result) {
    if (!result) return null;
    return result.widget || result.structuredContent?.widget || result._meta?.widget ||
      result.mcp_tool_result?._meta?.widget || result.call_tool_result?._meta?.widget ||
      result.mcp_tool_result?.structuredContent?.widget || null;
  }
  async function updateModelContext(text) { try { await rpc("ui/update-model-context", {content:[{type:"text",text:text}]}); } catch {} }

  function zonesFromPayload(data) {
    if (Array.isArray(data?.zones)) return data.zones;
    if (data?.zone) return [data.zone];
    return [];
  }
  function syncChrome() {
    const zones = zonesFromPayload(payload);
    if (zones.length) {
      zoneSelect.innerHTML = zones.map(function(z){ return '<option value="'+attr(z.zone_id)+'">'+esc(z.name || z.display_name)+'</option>'; }).join("");
      if (!state.selectedZoneId) state.selectedZoneId = payload.selected_zone_id || zones[0].zone_id;
      zoneSelect.value = state.selectedZoneId || "";
      zoneSelect.hidden = false;
    } else if (!zoneSelect.options.length) zoneSelect.hidden = true;
    document.querySelectorAll("[data-nav]").forEach(function(button){ button.classList.toggle("active", button.dataset.nav === state.view || (button.dataset.nav === "search" && ["artist","album","track"].includes(state.view))); });
    searchInput.value = state.query || payload?.query || "";
  }
  function card(item) {
    const subtitle = [item.artist || item.subtitle, item.release_year, item.source && item.source !== "unknown" ? item.source : null].filter(Boolean).join(" · ");
    return '<article class="card">'+
      '<button class="card-click" data-open-result="'+attr(item.result_id)+'" data-media-type="'+attr(item.media_type)+'">'+cover(item.image_url)+
      '<h3>'+esc(item.title)+'</h3><p>'+esc(subtitle)+'</p></button>'+
      '<div class="card-actions"><button data-play="'+attr(item.result_id)+'">Play</button><button data-enqueue="'+attr(item.result_id)+'">Queue</button></div></article>';
  }
  function row(item, index, kind) {
    const id = item.result_id || item.track_id || item.queue_item_id || "";
    const meta = [item.artist, item.album, item.resolution_status].filter(Boolean).join(" · ");
    let actions = "";
    if (kind === "queue") actions = '<button data-queue-item="'+attr(item.queue_item_id)+'">Play</button>';
    else if (kind === "playlist") actions = '<button data-playlist-track="'+attr(item.track_id)+'" data-playlist-id="'+attr(item.playlist_id)+'">▶</button><button data-enqueue-playlist-track="'+attr(item.track_id)+'" data-playlist-id="'+attr(item.playlist_id)+'">＋</button>';
    else if (item.result_id) actions = '<button data-play="'+attr(item.result_id)+'">▶</button><button data-enqueue="'+attr(item.result_id)+'">＋</button>';
    return '<div class="row"><span class="muted">'+esc(item.position || index+1)+'</span>'+cover(item.image_url,"mini-cover")+
      '<div><strong>'+esc(item.title || id)+'</strong><small>'+esc(meta)+'</small></div><div class="row-actions">'+actions+'</div></div>';
  }
  function renderPlayer(data) {
    const zone = (data.zones || []).find(function(z){ return z.zone_id === (state.selectedZoneId || data.selected_zone_id); }) || data.zones?.[0];
    if (!zone) return '<div class="empty"><div><h2>No Roon zones available</h2><p>Connect a Roon Core to start.</p></div></div>';
    state.selectedZoneId = zone.zone_id;
    const media = zone.now_playing || {};
    const pct = media.duration_seconds ? Math.max(0,Math.min(100,(media.position_seconds||0)/media.duration_seconds*100)) : 0;
    const grouped = (zone.grouped_outputs||[]).map(function(item){return '<span class="pill">'+esc(item.name)+'</span>';}).join("");
    const queue = (data.queue_preview||[]).slice(0,5).map(function(item,i){return row(item,i,"queue");}).join("");
    return '<section class="hero">'+cover(media.image_url)+'<div><p class="eyebrow">'+esc(zone.name)+' · '+esc(zone.state)+'</p><h1>'+esc(media.title || "Nothing playing")+'</h1><p class="subtitle">'+esc([media.artist,media.album].filter(Boolean).join(" · "))+'</p>'+grouped+
      '<div class="controls"><button class="icon-button" data-action="previous">◀</button><button class="icon-button play" data-action="toggle">'+(zone.state === "playing" ? "Ⅱ" : "▶")+'</button><button class="icon-button" data-action="next">▶</button><button class="secondary" data-volume="-1">− Vol</button><button class="secondary" data-volume="1">＋ Vol</button><button class="secondary" data-mute="'+(zone.volume?.muted?"unmute":"mute")+'">'+(zone.volume?.muted?"Unmute":"Mute")+'</button></div>'+ 
      '<div class="progress"><div class="track"><i style="width:'+pct+'%"></i></div><div class="times"><span>'+fmtTime(media.position_seconds)+'</span><span>'+fmtTime(media.duration_seconds)+'</span></div></div></div></section>'+
      '<section class="section"><div class="section-head"><h2>Up next</h2><button class="secondary" data-nav="queue">Open queue</button></div>'+(queue?'<div class="list">'+queue+'</div>':'<div class="empty">Queue is empty</div>')+'</section>';
  }
  function renderSearch(data) {
    const cards = (data.results||[]).map(card).join("");
    return '<div class="section-head"><div><p class="eyebrow">Music Explorer</p><h2>'+esc(data.navigation?.title || "Search")+'</h2></div><span class="muted">'+esc((data.results||[]).length)+' results</span></div>'+(cards?'<div class="grid">'+cards+'</div>':'<div class="empty">No matching music found</div>');
  }
  function renderArtist(data) {
    const artist = data.artist || {};
    const tracks = (data.popular_tracks||[]).map(function(item,i){return row(item,i,"media");}).join("");
    const albums = (data.albums||[]).map(card).join("");
    const singles = (data.singles_eps||[]).map(card).join("");
    return '<section class="hero">'+cover(artist.image_url)+'<div><p class="eyebrow">Artist</p><h1>'+esc(artist.title)+'</h1><p class="subtitle">'+esc(data.biography || "Biography is not available from this Roon source.")+'</p><div class="controls"><button class="primary" data-play="'+attr(artist.result_id)+'">Play artist</button><button class="secondary" data-radio="'+attr(artist.result_id)+'">Start radio</button><button class="secondary" data-back>Back</button></div></div></section>'+
      (tracks?'<section class="section"><div class="section-head"><h2>Popular tracks</h2></div><div class="list">'+tracks+'</div></section>':'')+
      (albums?'<section class="section"><div class="section-head"><h2>Albums</h2></div><div class="grid">'+albums+'</div></section>':'')+
      (singles?'<section class="section"><div class="section-head"><h2>Singles & EPs</h2></div><div class="grid">'+singles+'</div></section>':'');
  }
  function renderAlbum(data) {
    const album = data.album || {};
    const tracks = (data.tracks||[]).map(function(item,i){return row(item,i,"media");}).join("");
    return '<section class="hero">'+cover(album.image_url)+'<div><p class="eyebrow">Album'+(album.release_year?' · '+esc(album.release_year):'')+'</p><h1>'+esc(album.title)+'</h1><p class="subtitle">'+esc(album.artist || album.album_artist || "")+'</p><p class="muted">'+esc(data.description || "")+'</p><div class="controls"><button class="primary" data-play="'+attr(album.result_id)+'">Play album</button><button class="secondary" data-enqueue="'+attr(album.result_id)+'">Add to queue</button><button class="secondary" data-back>Back</button></div></div></section><section class="section"><div class="section-head"><h2>Track list</h2><span class="muted">'+esc((data.tracks||[]).length)+' tracks</span></div>'+(tracks?'<div class="list">'+tracks+'</div>':'<div class="empty">Track list unavailable</div>')+'</section>';
  }
  function renderTrack(data) {
    const item = data.entity || {};
    const quality = item.quality?.label || item.source || "";
    return '<section class="hero">'+cover(item.image_url)+'<div><p class="eyebrow">Track</p><h1>'+esc(item.title)+'</h1><p class="subtitle">'+esc([item.artist,item.album].filter(Boolean).join(" · "))+'</p><span class="pill">'+esc(quality)+'</span><div class="controls"><button class="primary" data-play="'+attr(item.result_id)+'">Play track</button><button class="secondary" data-enqueue="'+attr(item.result_id)+'">Add to queue</button><button class="secondary" data-back>Back</button></div></div></section>';
  }
  function renderQueue(data) {
    const rows = (data.items||[]).map(function(item,i){return row(item,i,"queue");}).join("");
    return '<div class="section-head"><div><p class="eyebrow">'+esc(data.zone?.name || "Zone")+'</p><h2>Queue</h2></div><button class="secondary" data-nav="player">Now playing</button></div>'+(rows?'<div class="list">'+rows+'</div>':'<div class="empty">Queue is empty</div>');
  }
  function renderPlaylists(data) {
    const cards = (data.playlists||[]).map(function(item){ return '<article class="card"><button class="card-click" data-open-playlist="'+attr(item.playlist_id)+'">'+cover(item.image_url)+'<h3>'+esc(item.name)+'</h3><p>'+esc(item.track_count)+' tracks</p></button></article>'; }).join("");
    return '<div class="section-head"><div><p class="eyebrow">Your collection</p><h2>RoonIA Playlists</h2></div><span class="muted">'+esc(data.pagination?.total || 0)+' playlists</span></div>'+(cards?'<div class="grid">'+cards+'</div>':'<div class="empty">No virtual playlists yet</div>');
  }
  function renderPlaylist(data) {
    const list = data.playlist || {};
    const rows = (data.tracks||[]).map(function(item,i){return row(item,i,"playlist");}).join("");
    return '<section class="hero">'+cover(list.image_url)+'<div><p class="eyebrow">Virtual playlist</p><h1>'+esc(list.name)+'</h1><p class="subtitle">'+esc(list.description || list.track_count+' tracks')+'</p><div class="controls"><button class="primary" data-play-playlist="'+attr(list.playlist_id)+'">Play playlist</button><button class="secondary" data-enqueue-playlist="'+attr(list.playlist_id)+'">Add to queue</button><button class="secondary" data-back>Back</button></div></div></section><section class="section"><div class="section-head"><h2>Tracks</h2><span class="muted">'+esc(list.track_count || 0)+'</span></div>'+(rows?'<div class="list">'+rows+'</div>':'<div class="empty">This playlist is empty</div>')+'</section>';
  }
  function render(data) {
    if (!data) return;
    payload = data;
    state.view = data.view || state.view;
    state.selectedZoneId = data.selected_zone_id || state.selectedZoneId;
    if (data.query) state.query = data.query;
    persist(); syncChrome();
    const warnings = data.warnings || [];
    statusEl.hidden = !warnings.length;
    statusEl.textContent = warnings.join(" · ");
    if (data.view === "player") content.innerHTML = renderPlayer(data);
    else if (data.view === "search") content.innerHTML = renderSearch(data);
    else if (data.view === "artist") content.innerHTML = renderArtist(data);
    else if (data.view === "album") content.innerHTML = renderAlbum(data);
    else if (data.view === "track") content.innerHTML = renderTrack(data);
    else if (data.view === "queue") content.innerHTML = renderQueue(data);
    else if (data.view === "playlists") content.innerHTML = renderPlaylists(data);
    else if (data.view === "playlist") content.innerHTML = renderPlaylist(data);
    else content.innerHTML = '<div class="empty">This view is not available yet.</div>';
  }

  function zoneRef() { return state.selectedZoneId ? {id:state.selectedZoneId} : null; }
  function navArgs(view) {
    const args = {view:view};
    if (zoneRef()) args.zone = zoneRef();
    if (view === "search") args.query = state.query || searchInput.value || "Radiohead";
    return args;
  }
  async function navigate(args, addHistory) {
    if (addHistory !== false && payload?.view && payload.view !== args.view) state.history.push({view:payload.view,query:payload.query,result_id:payload.artist?.result_id||payload.album?.result_id,playlist_id:payload.playlist?.playlist_id});
    setBusy(true);
    try {
      const result = await callTool("roon_ui_navigate", args);
      const widget = widgetFromResult(result);
      if (!widget) throw new Error("Widget data was not returned");
      render(widget);
    } catch (error) { content.innerHTML = '<div class="empty"><div><h2>Unable to load</h2><p>'+esc(error.message || error)+'</p></div></div>'; }
  }
  async function perform(name, args, message) {
    try {
      const result = await callTool(name,args);
      const out = result?.structuredContent || result;
      notify(out?.summary || message || "Done");
      if (out?.status === "confirmation_required") return;
      await navigate(navArgs(state.view), false);
    } catch (error) { notify(error.message || String(error)); }
  }

  document.addEventListener("click", async function(event){
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.nav) { await navigate(navArgs(button.dataset.nav), true); return; }
    if (button.dataset.back !== undefined) { const back = state.history.pop(); persist(); await navigate(back || {view:payload?.navigation?.parent_view || "search",query:state.query}, false); return; }
    if (button.dataset.openResult) { await navigate({view:button.dataset.mediaType || "track",result_id:button.dataset.openResult,zone:zoneRef()}, true); return; }
    if (button.dataset.openPlaylist) { await navigate({view:"playlist",playlist_id:button.dataset.openPlaylist,zone:zoneRef()}, true); return; }
    if (button.dataset.action) { await perform("roon_control_playback",{zone:zoneRef(),action:button.dataset.action},"Playback updated"); return; }
    if (button.dataset.volume) { await perform("roon_set_volume",{zone:zoneRef(),mode:"relative",value:Number(button.dataset.volume)},"Volume updated"); return; }
    if (button.dataset.mute) { await perform("roon_set_volume",{zone:zoneRef(),mode:button.dataset.mute},"Mute updated"); return; }
    if (button.dataset.play) { await perform("roon_play_media",{zone:zoneRef(),media:{result_id:button.dataset.play}},"Playback started"); return; }
    if (button.dataset.enqueue) { await perform("roon_enqueue_media",{zone:zoneRef(),media:{result_id:button.dataset.enqueue},position:"end"},"Added to queue"); return; }
    if (button.dataset.radio) { await perform("roon_start_radio",{zone:zoneRef(),artist:{result_id:button.dataset.radio}},"Radio started"); return; }
    if (button.dataset.queueItem) { await perform("roon_play_queue_item",{zone:zoneRef(),queue_item_id:Number(button.dataset.queueItem)},"Queue updated"); return; }
    if (button.dataset.playPlaylist) { await perform("roon_play_playlist",{zone:zoneRef(),playlist_id:button.dataset.playPlaylist,mode:"play_now"},"Playlist started"); return; }
    if (button.dataset.enqueuePlaylist) { await perform("roon_play_playlist",{zone:zoneRef(),playlist_id:button.dataset.enqueuePlaylist,mode:"add_to_queue"},"Playlist queued"); }
    if (button.dataset.playlistTrack) { await perform("roon_play_playlist_track",{zone:zoneRef(),playlist_id:button.dataset.playlistId,track_id:button.dataset.playlistTrack,mode:"play_now"},"Track started"); return; }
    if (button.dataset.enqueuePlaylistTrack) { await perform("roon_play_playlist_track",{zone:zoneRef(),playlist_id:button.dataset.playlistId,track_id:button.dataset.enqueuePlaylistTrack,mode:"add_to_queue"},"Track queued"); }
  });
  document.getElementById("search-form").addEventListener("submit", async function(event){ event.preventDefault(); const query = searchInput.value.trim(); if (!query) return; state.query=query; await navigate({view:"search",query:query,zone:zoneRef()},true); });
  zoneSelect.addEventListener("change", async function(){ state.selectedZoneId=zoneSelect.value; persist(); await updateModelContext("User selected Roon zone "+zoneSelect.options[zoneSelect.selectedIndex]?.text+" in the widget."); await navigate(navArgs(state.view),false); });

  function applyInitial(globals) {
    const meta = globals?.toolResponseMetadata;
    const initial = widgetFromResult(meta) || widgetFromResult(globals?.toolOutput) || globals?.toolOutput?.widget;
    if (initial) render(initial);
  }
  applyInitial(window.openai);
  window.addEventListener("openai:set_globals", function(event){ applyInitial(event.detail?.globals); }, {passive:true});
  window.addEventListener("message", function(event){
    if (event.source !== window.parent) return; const message=event.data; if (!message || message.jsonrpc!=="2.0") return;
    if (message.id && pending.has(message.id)) { const request=pending.get(message.id); pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message||"Host error")); else request.resolve(message.result); return; }
    if (message.method === "ui/notifications/tool-result") { const initial=widgetFromResult(message.params); if (initial) render(initial); }
  }, {passive:true});
  setInterval(function(){ if (!document.hidden && (state.view === "player" || state.view === "queue") && payload) navigate(navArgs(state.view),false); }, 5000);
</script>
`.trim();

export function registerWidgetV2Resources(server: McpServer): void {
  for (const [surface, uri] of Object.entries(WIDGET_V2_URIS)) {
    server.registerResource(
      `roonia-${surface}-widget-v2`,
      uri,
      {
        title: surface === "player" ? "RoonIA Player" : surface === "media" ? "RoonIA Media Explorer" : "RoonIA Library",
        description: `Interactive RoonIA ${surface} widget for MCP Apps hosts.`
      },
      async () => ({
        contents: [{
          uri,
          mimeType: "text/html;profile=mcp-app",
          text: widgetV2Html,
          _meta: {
            ui: {
              prefersBorder: true,
              domain: "https://roonia.ipchome.com",
              csp: {
                connectDomains: ["https://roonia.ipchome.com"],
                resourceDomains: ["https://roonia.ipchome.com"]
              }
            }
          }
        }]
      })
    );
  }
}
