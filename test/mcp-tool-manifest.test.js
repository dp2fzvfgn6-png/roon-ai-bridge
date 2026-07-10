const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createServer } = require("../dist/api/server");
const { registerRoonMcpTools } = require("../dist/mcp/mcpTools");
const { createDatabase } = require("../dist/db/database");
const { PlaylistService } = require("../dist/services/playlistService");
const { VolumeLimitService } = require("../dist/services/volumeLimitService");
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
  assert.ok(tools.has("roon_validate_virtual_playlist"));
  assert.ok(tools.has("roon_expand_media_search"));
  assert.ok(tools.has("roon_set_virtual_playlist_track_match"));
  assert.ok(tools.has("roon_set_virtual_playlist_cover_image"));
  assert.match(tools.get("roon_set_virtual_playlist_cover_image").options.description, /^Use this when/);
  assert.ok(tools.has("roon_get_now_playing_widget"));
  assert.ok(tools.has("roon_get_playlists_widget"));
  assert.ok(tools.has("roon_get_media_search_widget"));
});

test("HTTP MCP tools/list exposes final schemas, descriptions, and widget URI", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-mcp-manifest-"));
  const config = createConfig(dataDir);
  const database = createDatabase(config);
  const volumeLimitService = new VolumeLimitService(config, database);
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
    outputVolumeSettingsService: {},
    volumeLimitService
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
    for (const name of [
      "roon_validate_virtual_playlist",
      "roon_resolve_virtual_playlist",
      "roon_deduplicate_virtual_playlist",
      "roon_sort_virtual_playlist",
      "roon_export_virtual_playlist",
      "roon_import_virtual_playlist",
      "roon_expand_media_search",
      "roon_set_virtual_playlist_track_match",
      "roon_add_search_result_to_virtual_playlist",
      "roon_set_virtual_playlist_cover_image"
    ]) {
      assert.ok(tools.has(name), `${name} should be exposed`);
      assert.ok(tools.get(name).inputSchema, `${name} should expose a schema`);
    }
    assert.equal(
      getPlaylist._meta["openai/outputTemplate"],
      roonControlWidgetUriForTool("roon_get_virtual_playlist")
    );
    assert.equal(
      getPlaylist._meta["openai/outputTemplate"],
      "ui://roon-ai-bridge/control-v8/roon_get_virtual_playlist.html"
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
    for (const name of [
      "roon_get_now_playing_widget",
      "roon_now_playing_widget_action",
      "roon_get_playlists_widget",
      "roon_get_playlist_detail_widget",
      "roon_playlist_widget_action",
      "roon_get_media_search_widget",
      "roon_media_search_widget_action",
      "roon_open_media_entity_widget",
      "roon_get_image_url"
    ]) {
      assert.ok(tools.has(name), `${name} should be exposed`);
      assert.ok(tools.get(name).inputSchema, `${name} should expose a schema`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
  }
});
