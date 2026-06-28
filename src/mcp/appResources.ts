import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const ROON_CONTROL_WIDGET_URI = "ui://roon-ai-bridge/control-v2.html";
const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

const controlWidgetHtml = `
<main class="shell">
  <section>
    <p class="eyebrow">Roon AI Bridge</p>
    <h1>Roon Control</h1>
    <p id="summary">Ask ChatGPT to list zones, search music, change playback, adjust volume, manage queue, or play a virtual playlist.</p>
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
    window.parent.postMessage({
      jsonrpc: "2.0",
      id: requestId++,
      method: "tools/call",
      params: { name, arguments: args }
    }, "*");
  }

  function renderMediaSearch(payload) {
    if (!payload || !Array.isArray(payload.results)) return false;
    resultTitle.textContent = "Roon Search Results";
    cards.className = "cards";
    cards.replaceChildren();
    const zoneId = latestInput.zone_id;

    for (const media of payload.results) {
      const card = document.createElement("div");
      card.className = "card";
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
      ].filter(Boolean).join(" · ");
      copy.append(title, meta);
      card.append(copy);

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
      card.className = "card";
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
      ].filter(Boolean).join(" · ");
      copy.append(title, meta);
      card.append(copy);
      cards.append(card);
    }
    result.hidden = true;
    return true;
  }

  function render(payload) {
    cards.replaceChildren();
    cards.className = "";
    result.hidden = false;
    resultTitle.textContent = "Latest Tool Result";
    if (renderMediaSearch(payload) || renderZones(payload)) return;
    result.textContent = JSON.stringify(payload, null, 2);
  }

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
  server.registerResource(
    "roon-control-widget",
    ROON_CONTROL_WIDGET_URI,
    {
      title: "Roon Control",
      description: "Interactive ChatGPT App widget for Roon AI Bridge."
    },
    async () => ({
      contents: [
        {
          uri: ROON_CONTROL_WIDGET_URI,
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
    })
  );
}

export const roonControlWidgetUri = ROON_CONTROL_WIDGET_URI;
