import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

const ROON_CONTROL_WIDGET_VERSION = "v7";
const ROON_CONTROL_WIDGET_URI = `ui://roon-ai-bridge/control-${ROON_CONTROL_WIDGET_VERSION}/default.html`;
const ROON_CONTROL_WIDGET_TEMPLATE = `ui://roon-ai-bridge/control-${ROON_CONTROL_WIDGET_VERSION}/{tool}.html`;
const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

const controlWidgetHtml = `
<main class="shell">
  <section>
    <p class="eyebrow">Roon AI Bridge</p>
    <h1>Roon Control</h1>
    <p id="summary">Control de zonas, reproduccion, volumen, busqueda, cola y playlists de Roon.</p>
  </section>
  <section class="panel">
    <h2 id="result-title">Latest Tool Result</h2>
    <div id="cards"></div>
    <pre id="result">Waiting for a Roon action...</pre>
  </section>
</main>
<style>
  :root {
    color: #172033;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  body {
    margin: 0;
    background: #f6f8fb;
  }
  .shell {
    display: grid;
    gap: 16px;
    padding: 18px;
  }
  .eyebrow {
    margin: 0 0 4px;
    color: #596579;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  h1,
  h2 {
    margin: 0;
  }
  h1 {
    font-size: 24px;
  }
  h2 {
    font-size: 15px;
  }
  p {
    line-height: 1.45;
  }
  .panel {
    background: #fff;
    border: 1px solid #dce3ee;
    border-radius: 8px;
    padding: 14px;
  }
  pre {
    white-space: pre-wrap;
    word-break: break-word;
    margin: 10px 0 0;
    font-size: 12px;
  }
  .cards {
    display: grid;
    gap: 10px;
    margin-top: 12px;
  }
  .card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    border-top: 1px solid #e7ebf2;
    padding-top: 10px;
  }
  .card.with-art {
    grid-template-columns: 52px minmax(0, 1fr) auto;
  }
  .art {
    width: 52px;
    height: 52px;
    border-radius: 7px;
    object-fit: cover;
    background: #e7ebf2;
  }
  .card:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .title {
    margin: 0;
    font-weight: 700;
  }
  .meta {
    margin: 3px 0 0;
    color: #5d687a;
    font-size: 12px;
  }
  button {
    border: 0;
    border-radius: 7px;
    padding: 8px 11px;
    background: #172033;
    color: white;
    cursor: pointer;
    font-weight: 700;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-end;
  }
  .secondary {
    background: #596579;
  }
</style>
<script type="module">
  const result = document.getElementById("result");
  const cards = document.getElementById("cards");
  const resultTitle = document.getElementById("result-title");
  let latestInput = {};
  let requestId = 1;

  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function callTool(name, args) {
    if (window.openai && typeof window.openai.callTool === "function") {
      window.openai.callTool(name, args);
      return;
    }
    window.parent.postMessage({
      jsonrpc: "2.0",
      id: requestId++,
      method: "tools/call",
      params: { name, arguments: args }
    }, "*");
  }

  function button(label, tool, args, secondary = false) {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    if (secondary) el.className = "secondary";
    el.addEventListener("click", () => callTool(tool, args));
    return el;
  }

  function renderNowPlayingWidget(payload) {
    if (payload?.widget_type !== "now_playing" || !Array.isArray(payload.zones)) return false;
    resultTitle.textContent = "Now Playing";
    cards.className = "cards";
    cards.replaceChildren();
    for (const zone of payload.zones) {
      const card = document.createElement("div");
      card.className = "card with-art";
      const art = document.createElement("img");
      art.className = "art";
      art.alt = "";
      if (zone.now_playing?.image_url) art.src = zone.now_playing.image_url;
      const copy = document.createElement("div");
      const title = document.createElement("p");
      title.className = "title";
      title.textContent = zone.display_name || zone.zone_id;
      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = [
        zone.state,
        zone.now_playing?.title,
        zone.now_playing?.artist,
        zone.volume?.value === null ? null : "Vol " + zone.volume?.value
      ].filter(Boolean).join(" | ");
      copy.append(title, meta);
      const actions = document.createElement("div");
      actions.className = "actions";
      actions.append(
        button("Play/Pause", "roon_now_playing_widget_action", { action: "play_pause", zone_id: zone.zone_id }),
        button("Prev", "roon_now_playing_widget_action", { action: "previous", zone_id: zone.zone_id }, true),
        button("Next", "roon_now_playing_widget_action", { action: "next", zone_id: zone.zone_id }, true),
        button("Vol -", "roon_now_playing_widget_action", { action: "volume_down", zone_id: zone.zone_id }, true),
        button("Vol +", "roon_now_playing_widget_action", { action: "volume_up", zone_id: zone.zone_id }, true),
        button("Mute", "roon_now_playing_widget_action", { action: "mute_toggle", zone_id: zone.zone_id }, true)
      );
      card.append(art, copy, actions);
      cards.append(card);
    }
    result.hidden = true;
    return true;
  }

  function renderPlaylistWidget(payload) {
    if (payload?.widget_type !== "virtual_playlists" && payload?.widget_type !== "playlist_created") return false;
    resultTitle.textContent = payload.view === "playlist_detail" ? "Playlist" : "Virtual Playlists";
    cards.className = "cards";
    cards.replaceChildren();
    if (payload.view === "playlist_detail") {
      const zoneId = latestInput.zone_id;
      for (const track of payload.tracks || []) {
        const card = document.createElement("div");
        card.className = "card with-art";
        const art = document.createElement("img");
        art.className = "art";
        art.alt = "";
        if (track.image_url) art.src = track.image_url;
        const copy = document.createElement("div");
        const title = document.createElement("p");
        title.className = "title";
        title.textContent = track.title || track.track_id;
        const meta = document.createElement("p");
        meta.className = "meta";
        meta.textContent = [track.artist, track.album, track.resolution_status].filter(Boolean).join(" | ");
        copy.append(title, meta);
        const actions = document.createElement("div");
        actions.className = "actions";
        if (zoneId) {
          actions.append(
            button("Play", "roon_playlist_widget_action", { action: "play_track", playlist_id: payload.playlist.playlist_id, track_id: track.track_id, zone_id: zoneId }),
            button("Queue", "roon_playlist_widget_action", { action: "add_track_to_queue", playlist_id: payload.playlist.playlist_id, track_id: track.track_id, zone_id: zoneId }, true)
          );
        }
        card.append(art, copy, actions);
        cards.append(card);
      }
    } else {
      for (const playlist of payload.playlists || []) {
        const card = document.createElement("div");
        card.className = "card with-art";
        const art = document.createElement("img");
        art.className = "art";
        art.alt = "";
        if (playlist.image_url) art.src = playlist.image_url;
        const copy = document.createElement("div");
        const title = document.createElement("p");
        title.className = "title";
        title.textContent = playlist.name;
        const meta = document.createElement("p");
        meta.className = "meta";
        meta.textContent = [playlist.track_count + " tracks", playlist.description].filter(Boolean).join(" | ");
        copy.append(title, meta);
        const actions = document.createElement("div");
        actions.className = "actions";
        actions.append(button("Open", "roon_get_playlist_detail_widget", { playlist_id: playlist.playlist_id }, true));
        card.append(art, copy, actions);
        cards.append(card);
      }
    }
    result.hidden = true;
    return true;
  }

  function renderSearchWidget(payload) {
    if (payload?.widget_type !== "media_search") return false;
    resultTitle.textContent = "Music Search";
    cards.className = "cards";
    cards.replaceChildren();
    const zoneId = latestInput.zone_id;
    for (const media of payload.results || payload.popular_tracks || payload.albums || []) {
      const card = document.createElement("div");
      card.className = "card with-art";
      const art = document.createElement("img");
      art.className = "art";
      art.alt = "";
      if (media.image_url) art.src = media.image_url;
      const copy = document.createElement("div");
      const title = document.createElement("p");
      title.className = "title";
      title.textContent = media.title || media.name || media.result_id;
      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = [media.media_type || media.type, media.artist, media.album, media.source, media.confidence].filter(Boolean).join(" | ");
      copy.append(title, meta);
      const actions = document.createElement("div");
      actions.className = "actions";
      if (zoneId && media.result_id) {
        actions.append(
          button("Play", "roon_media_search_widget_action", { action: "play", result_id: media.result_id, zone_id: zoneId }),
          button("Queue", "roon_media_search_widget_action", { action: "add_to_queue", result_id: media.result_id, zone_id: zoneId }, true)
        );
      }
      if (media.result_id) {
        actions.append(button("Open", "roon_open_media_entity_widget", { result_id: media.result_id }, true));
      }
      card.append(art, copy, actions);
      cards.append(card);
    }
    result.hidden = true;
    return true;
  }

  function renderMediaSearch(payload) {
    if (!payload || !Array.isArray(payload.results)) return false;
    resultTitle.textContent = "Roon Search Results";
    cards.className = "cards";
    cards.replaceChildren();
    const zoneId = latestInput.zone_id;

    for (const media of payload.results) {
      const card = document.createElement("div");
      card.className = "card with-art";
      const art = document.createElement("img");
      art.className = "art";
      art.alt = "";
      if (media.image_data_url) art.src = media.image_data_url;
      const copy = document.createElement("div");
      const title = document.createElement("p");
      title.className = "title";
      title.textContent = text(media.title);
      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = [
        media.media_type,
        media.subtitle,
        media.source && media.source !== "unknown" ? media.source : null,
        media.quality?.label
      ].filter(Boolean).join(" | ");
      copy.append(title, meta);
      card.append(art, copy);

      if (zoneId && media.result_id) {
        const play = document.createElement("button");
        play.type = "button";
        play.textContent = "Play";
        play.addEventListener("click", () => {
          callTool("roon_play_media", {
            result_id: media.result_id,
            zone_id: zoneId
          });
        });
        card.append(play);
      }
      cards.append(card);
    }
    result.hidden = true;
    return true;
  }

  function renderZones(payload) {
    if (!Array.isArray(payload)) return false;
    if (!payload.every((item) => item && typeof item.zone_id === "string")) return false;
    resultTitle.textContent = "Roon Zones";
    cards.className = "cards";
    cards.replaceChildren();
    for (const zone of payload) {
      const card = document.createElement("div");
      card.className = "card with-art";
      const art = document.createElement("img");
      art.className = "art";
      art.alt = "";
      if (zone.now_playing?.image_data_url) art.src = zone.now_playing.image_data_url;
      const copy = document.createElement("div");
      const title = document.createElement("p");
      title.className = "title";
      title.textContent = text(zone.display_name);
      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = [
        zone.state,
        zone.now_playing?.line1,
        zone.now_playing?.line2
      ].filter(Boolean).join(" | ");
      copy.append(title, meta);
      card.append(art, copy);
      cards.append(card);
    }
    result.hidden = true;
    return true;
  }

  function renderPlayback(payload) {
    if (!payload || payload.ok !== true || typeof payload.command !== "string") {
      return false;
    }
    resultTitle.textContent = "Roon Playback";
    cards.className = "cards";
    cards.replaceChildren();
    const card = document.createElement("div");
    card.className = "card";
    const copy = document.createElement("div");
    const title = document.createElement("p");
    title.className = "title";
    title.textContent = text(payload.zone_name || payload.zone_id);
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = [
      payload.command,
      payload.state,
      payload.state_verified ? "verified" : "accepted"
    ].filter(Boolean).join(" | ");
    copy.append(title, meta);
    card.append(copy);
    cards.append(card);
    result.hidden = true;
    return true;
  }

  function renderImage(payload) {
    if (!payload || typeof payload.data_url !== "string") return false;
    resultTitle.textContent = "Roon Artwork";
    cards.className = "cards";
    cards.replaceChildren();
    const image = document.createElement("img");
    image.src = payload.data_url;
    image.alt = "Roon artwork";
    image.style.maxWidth = "100%";
    image.style.borderRadius = "8px";
    cards.append(image);
    result.hidden = true;
    return true;
  }

  function render(payload) {
    cards.replaceChildren();
    cards.className = "";
    result.hidden = false;
    resultTitle.textContent = "Latest Tool Result";
    if (renderNowPlayingWidget(payload) || renderPlaylistWidget(payload) || renderSearchWidget(payload)) return;
    if (renderMediaSearch(payload) || renderZones(payload) || renderPlayback(payload) || renderImage(payload)) return;
    result.textContent = JSON.stringify(payload, null, 2);
  }

  function applyGlobals(globals) {
    if (!globals) return;
    if (globals.toolInput) latestInput = globals.toolInput;
    if (globals.toolOutput !== undefined && globals.toolOutput !== null) {
      const output = globals.toolOutput;
      render(output.result ?? output);
    }
  }

  applyGlobals(window.openai);

  window.addEventListener("openai:set_globals", (event) => {
    applyGlobals(event.detail?.globals);
  }, { passive: true });

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.method === "ui/notifications/tool-input") {
      latestInput = message.params?.arguments ?? message.params ?? {};
      return;
    }
    if (message.method !== "ui/notifications/tool-result") return;
    const structured = message.params?.structuredContent ?? {};
    render(structured.result ?? structured);
  }, { passive: true });
</script>
`.trim();

export function registerRoonAppResources(server: McpServer): void {
  const readWidget = async (uri: string) => ({
      contents: [
        {
          uri,
          mimeType: MCP_APP_MIME_TYPE,
          text: controlWidgetHtml,
          _meta: {
            ui: {
              prefersBorder: true,
              domain: "https://roonia.ipchome.com",
              csp: {
                connectDomains: ["https://roonia.ipchome.com"],
                resourceDomains: []
              }
            }
          }
        }
      ]
    });

  server.registerResource(
    "roon-control-widget",
    ROON_CONTROL_WIDGET_URI,
    {
      title: "Roon Control",
      description: "Interactive ChatGPT App widget for Roon AI Bridge."
    },
    async () => readWidget(ROON_CONTROL_WIDGET_URI)
  );

  server.registerResource(
    "roon-control-widget-tool",
    new ResourceTemplate(ROON_CONTROL_WIDGET_TEMPLATE, {
      list: undefined
    }),
    {
      title: "Roon Control Tool Widget",
      description: "Per-tool ChatGPT App widget resource for Roon AI Bridge."
    },
    async (uri) => readWidget(uri.toString())
  );
}

export const roonControlWidgetUri = ROON_CONTROL_WIDGET_URI;

export function roonControlWidgetUriForTool(toolName: string): string {
  const safeToolName = /^[a-z0-9_]+$/.test(toolName) ? toolName : "default";
  return `ui://roon-ai-bridge/control-${ROON_CONTROL_WIDGET_VERSION}/${safeToolName}.html`;
}
