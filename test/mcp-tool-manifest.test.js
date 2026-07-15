const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createServer } = require("../dist/api/server");
const { registerBridgeV2Tools } = require("../dist/bridge-v2/mcp/tools");
const { registerWidgetV2Tools } = require("../dist/bridge-v2/widgets/tools");
const { createDatabase } = require("../dist/db/database");
const { PlaylistService } = require("../dist/services/playlistService");
const { VolumeLimitService } = require("../dist/services/volumeLimitService");
const { ZonePresetService } = require("../dist/services/zonePresetService");

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

function createContext(config, database) {
  const noop = () => {};
  return {
    config,
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    roonClient: {
      getZones: () => [],
      getOutputs: () => [],
      getKnownOutputs: () => [],
      getZone: () => null,
      getOutput: () => null,
      isCoreConnected: () => false,
      getCoreName: () => null,
      isTransportReady: () => false,
      isBrowseReady: () => false,
      isImageReady: () => false
    },
    playlistService: new PlaylistService(config, database),
    mediaService: {},
    zonePresetService: new ZonePresetService(config, database),
    volumeLimitService: new VolumeLimitService(config, database),
    oauthService: {},
    apiKeyService: {},
    portalAuthService: {},
    systemManagementService: {},
    outputVolumeSettingsService: {}
  };
}

async function readMcpJson(response) {
  const text = await response.text();
  if ((response.headers.get("content-type") || "").includes("text/event-stream")) {
    const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data: "));
    assert.ok(dataLine, `Expected SSE data line, got: ${text}`);
    return JSON.parse(dataLine.slice("data: ".length));
  }
  return JSON.parse(text);
}

test("registers the compact MCP v2 intent catalog", () => {
  const tools = new Map();
  const server = {
    registerTool(name, options, handler) {
      tools.set(name, { options, handler });
    }
  };
  const context = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    roonClient: {},
    volumeLimitService: {}
  };

  registerBridgeV2Tools(server, context);

  assert.equal(tools.size, 31);
  for (const [name, registration] of tools) {
    assert.match(registration.options.description, /^Use this when/);
    assert.ok(registration.options.outputSchema.status, `${name} should declare status output`);
    assert.equal(registration.options._meta, undefined, `${name} must not attach a widget`);
  }
  for (const name of [
    "roon_get_state",
    "roon_control_playback",
    "roon_search_media",
    "roon_get_media_entity",
    "roon_play_media",
    "roon_enqueue_media",
    "roon_edit_playlist_tracks",
    "roon_set_playlist_cover",
    "roon_play_playlist_track",
    "roon_get_configuration",
    "roon_run_diagnostics"
  ]) assert.ok(tools.has(name), `${name} should be exposed`);
  assert.equal(tools.get("roon_edit_playlist_tracks").options.annotations.destructiveHint, true);
  assert.equal(tools.get("roon_import_playlist").options.annotations.destructiveHint, true);

  for (const legacy of ["roon_status", "roon_list_zones", "roon_play_by_query", "roon_get_now_playing_widget"])
    assert.equal(tools.has(legacy), false, `${legacy} should not be exposed`);
});

test("read-only MCP credentials expose query tools and the three read-only widgets", () => {
  const tools = new Map();
  const server = { registerTool(name, options) { tools.set(name, options); } };
  const context = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    roonClient: {},
    volumeLimitService: {},
    activeApiKey: { role: "read", tool_permissions: null }
  };

  registerBridgeV2Tools(server, context);
  registerWidgetV2Tools(server, context);

  assert.ok(tools.has("roon_get_state"));
  assert.ok(tools.has("roon_search_media"));
  assert.equal(tools.has("roon_control_playback"), false);
  assert.equal(tools.has("roon_play_media"), false);
  assert.ok(tools.has("roon_show_now_playing"));
  assert.ok(tools.has("roon_show_media"));
  assert.ok(tools.has("roon_show_playlist"));
  assert.equal(tools.has("roon_open_player"), false);
  assert.equal(tools.has("roon_ui_action"), false);
  assert.equal(tools.has("roon_ui_navigate"), false);
  for (const tool of tools.values()) assert.equal(tool.annotations.readOnlyHint, true);
});

test("HTTP MCP tools/list exposes v2 intents plus three minimal read-only render tools", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-mcp-v2-"));
  const config = createConfig(dataDir);
  const database = createDatabase(config);
  const context = createContext(config, database);
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });
    assert.equal(response.status, 200);
    const payload = await readMcpJson(response);
    const tools = new Map(payload.result.tools.map((tool) => [tool.name, tool]));

    assert.equal(tools.size, 34);
    assert.ok(tools.get("roon_get_state").inputSchema.properties.scope);
    assert.ok(tools.get("roon_play_media").inputSchema.properties.zone);
    assert.ok(tools.get("roon_play_media").inputSchema.properties.media);
    assert.ok(tools.get("roon_get_media_entity").outputSchema.properties.status);
    assert.ok(tools.get("roon_set_playlist_cover").inputSchema.properties.image_base64);
    const renderTools = ["roon_show_now_playing", "roon_show_media", "roon_show_playlist"];
    for (const [name, tool] of tools) {
      if (renderTools.includes(name)) {
        assert.match(tool._meta["openai/outputTemplate"], /^ui:\/\/roon-ai-bridge\/v16\//);
        assert.deepEqual(tool._meta.ui.visibility, ["model", "app"]);
      } else {
        assert.equal(tool._meta?.["openai/outputTemplate"], undefined);
      }
      assert.match(tool.description, /^Use this when/);
    }
    assert.equal(tools.has("roon_status"), false);
    assert.equal(tools.has("roon_get_media_search_widget"), false);
    for (const name of renderTools) {
      assert.equal(tools.get(name).annotations.readOnlyHint, true);
      assert.equal(tools.get(name)._meta["openai/widgetAccessible"], undefined);
    }
    for (const removed of [
      "roon_open_player",
      "roon_open_media_explorer",
      "roon_open_library",
      "roon_ui_navigate",
      "roon_ui_action"
    ]) assert.equal(tools.has(removed), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
  }
});
