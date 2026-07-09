const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createServer } = require("../dist/api/server");
const { registerRoonMcpTools } = require("../dist/mcp/mcpTools");
const { createDatabase } = require("../dist/db/database");
const { PlaylistService } = require("../dist/services/playlistService");
const { roonControlWidgetUriForTool } = require("../dist/mcp/appResources");

function createConfig(dataDir) {
  return {
    port: 3000,
    portalPort: 3001,
    enablePortal: false,
    nodeEnv: "test",
    logLevel: "error",
    roonExtensionName: "Test",
    roonExtensionId: "test",
    dataDir,
    enableBrowse: true,
    enableMcp: true,
    enableAuth: false,
    apiToken: null,
    portalAdminToken: null,
    publicBaseUrl: "https://example.test",
    oauthIssuer: "https://example.test",
    oauthApprovalPin: null,
    roonStreamingSource: "tidal"
  };
}

async function readMcpJson(response) {
  const text = await response.text();
  if ((response.headers.get("content-type") || "").includes("text/event-stream")) {
    const dataLine = text
      .split(/\r?\n/)
      .find((line) => line.startsWith("data: "));
    assert.ok(dataLine, `Expected SSE data line, got: ${text}`);
    return JSON.parse(dataLine.slice("data: ".length));
  }
  return JSON.parse(text);
}

test("registers tool-specific descriptions instead of reusing roon_status copy", () => {
  const tools = new Map();
  const server = {
    registerTool(name, options, handler) {
      tools.set(name, { options, handler });
    }
  };
  const noop = () => {};
  const context = {
    logger: { info: noop, warn: noop, error: noop, debug: noop }
  };

  registerRoonMcpTools(server, context);

  const statusDescription = tools.get("roon_status").options.description;
  assert.equal(statusDescription, "Return Roon Core connection status and service readiness.");

  for (const [name, registration] of tools.entries()) {
    assert.ok(registration.options.description, `${name} should have a description`);
    if (name !== "roon_status") {
      assert.notEqual(
        registration.options.description,
        statusDescription,
        `${name} must not reuse roon_status description`
      );
    }
  }

  assert.match(tools.get("roon_search_media").options.description, /result_id/);
  assert.match(tools.get("roon_get_queue").options.description, /queue/i);
  assert.match(tools.get("roon_change_volume").options.description, /volume/i);
  assert.match(tools.get("roon_get_virtual_playlist").options.description, /paginated tracks/i);
});

test("HTTP MCP tools/list exposes final schemas, descriptions, and widget URI", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-mcp-manifest-"));
  const config = createConfig(dataDir);
  const database = createDatabase(config);
  const noop = () => {};
  const context = {
    config,
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    roonClient: {
      getZones: () => [],
      isCoreConnected: () => false,
      getCoreName: () => null,
      isTransportReady: () => false,
      isBrowseReady: () => false,
      isImageReady: () => false,
      getOutputs: () => []
    },
    playlistService: new PlaylistService(config, database),
    oauthService: {},
    mediaService: {},
    apiKeyService: {},
    portalAuthService: {},
    systemManagementService: {},
    zonePresetService: {},
    outputVolumeSettingsService: {}
  };
  const server = createServer(context).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      })
    });
    assert.equal(response.status, 200);
    const payload = await readMcpJson(response);
    const tools = new Map(payload.result.tools.map((tool) => [tool.name, tool]));
    const statusDescription = tools.get("roon_status").description;
    const getPlaylist = tools.get("roon_get_virtual_playlist");

    assert.ok(getPlaylist.inputSchema.properties.include_tracks);
    assert.ok(getPlaylist.inputSchema.properties.limit);
    assert.ok(getPlaylist.inputSchema.properties.offset);
    assert.equal(
      getPlaylist._meta["openai/outputTemplate"],
      roonControlWidgetUriForTool("roon_get_virtual_playlist")
    );
    assert.equal(
      getPlaylist._meta["openai/outputTemplate"],
      "ui://roon-ai-bridge/control-v6/roon_get_virtual_playlist.html"
    );
    assert.notEqual(
      tools.get("roon_status")._meta["openai/outputTemplate"],
      getPlaylist._meta["openai/outputTemplate"]
    );

    for (const [name, tool] of tools.entries()) {
      assert.ok(tool.description, `${name} should have a description`);
      if (name !== "roon_status") {
        assert.notEqual(tool.description, statusDescription);
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
  }
});
