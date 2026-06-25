import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const ROON_CONTROL_WIDGET_URI = "ui://roon-ai-bridge/control-v1.html";
const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

const controlWidgetHtml = `
<main class="shell">
  <section>
    <p class="eyebrow">Roon AI Bridge</p>
    <h1>Roon Control</h1>
    <p id="summary">Ask ChatGPT to list zones, search music, change playback, adjust volume, manage queue, or play a virtual playlist.</p>
  </section>
  <section class="panel">
    <h2>Latest Tool Result</h2>
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
</style>
<script type="module">
  const result = document.getElementById("result");
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.method !== "ui/notifications/tool-result") return;
    result.textContent = JSON.stringify(message.params?.structuredContent ?? message.params, null, 2);
  }, { passive: true });
</script>
`.trim();

export function registerRoonAppResources(server: McpServer): void {
  server.registerResource(
    "roon-control-widget",
    ROON_CONTROL_WIDGET_URI,
    {
      title: "Roon Control",
      description: "Minimal ChatGPT App widget for Roon AI Bridge."
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
