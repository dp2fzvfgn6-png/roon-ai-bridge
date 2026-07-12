const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createPortalServer } = require("../dist/portal/server");
const { ApiKeyService } = require("../dist/services/apiKeyService");
const { ToolAccessService } = require("../dist/services/toolAccessService");
const { createDatabase } = require("../dist/db/database");
const { PortalAuthService } = require("../dist/services/portalAuthService");

function createConfig(dataDir) {
  return {
    port: 3000,
    portalPort: 3001,
    enablePortal: true,
    nodeEnv: "test",
    logLevel: "error",
    roonExtensionName: "Test",
    roonExtensionId: "test",
    dataDir,
    enableBrowse: true,
    enableMcp: true,
    enableAuth: true,
    apiToken: "portal-test-token",
    portalAdminToken: "portal-test-token",
    publicBaseUrl: "https://example.test",
    oauthIssuer: "https://example.test",
    oauthApprovalPin: "pin",
    roonStreamingSource: "tidal"
  };
}

test("serves portal assets publicly but protects every administration endpoint", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-portal-"));
  const config = createConfig(dataDir);
  const database = createDatabase(config);
  const apiKeyService = new ApiKeyService(config, database);
  const toolAccessService = new ToolAccessService(database);
  const portalAuthService = new PortalAuthService(config, database);
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
    playlistService: {
      listPlaylists: () => ({
        playlists: [],
        total: 0,
        limit: 100,
        offset: 0,
        include_tracks: false
      })
    },
    oauthService: {},
    mediaService: {},
    apiKeyService,
    portalAuthService,
    toolAccessService,
    systemManagementService: { getSystemInfo: () => ({}) },
    zonePresetService: {},
    outputVolumeSettingsService: {}
  };
  const server = createPortalServer(context).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /img-src 'self' data: blob:/);
    const portalPageText = await page.text();
    assert.match(portalPageText, /roonIA/);
    assert.match(portalPageText, /id="context-modal"/);
    assert.match(portalPageText, /src="\/roonia-logo\.svg"/);
    assert.match(portalPageText, />library_music<\/span><span>Música<\/span>/);

    const logo = await fetch(`${baseUrl}/roonia-logo.svg`);
    assert.equal(logo.status, 200);
    assert.match(logo.headers.get("content-type"), /image\/svg\+xml/);
    assert.match(await logo.text(), /aria-label="roonIA logo"/);

    const portalStyles = await fetch(`${baseUrl}/styles.css`);
    assert.equal(portalStyles.status, 200);
    const portalStylesText = await portalStyles.text();
    assert.match(portalStylesText, /\.playlist-collage \{[^}]*gap: 0;[^}]*padding: 0;[^}]*background: #000;/);
    assert.match(portalStylesText, /\.playlist-collage > img \{[^}]*min-width: 0;[^}]*object-fit: cover;[^}]*object-position: center;/);

    const portalScript = await fetch(`${baseUrl}/app.js`);
    assert.equal(portalScript.status, 200);
    const portalScriptText = await portalScript.text();
    assert.match(portalScriptText, /data-image-key/);
    assert.match(portalScriptText, /active-zone-select/);
    assert.match(portalScriptText, /data-play-mode="play_next"/);
    assert.match(portalScriptText, /artist:6, album:6, track:12/);
    assert.match(portalScriptText, /data-more-results/);
    assert.match(portalScriptText, /playlist-search-form/);
    assert.match(portalScriptText, /artist-detail/);
    assert.match(portalScriptText, /album-detail/);
    assert.match(portalScriptText, /playlist-collage/);
    assert.match(portalScriptText, /keys\.length<=4\?2:keys\.length<=9\?3:4/);
    assert.match(portalScriptText, /capacity=columns\*columns/);
    assert.match(portalScriptText, /collage-\$\{columns\}x\$\{columns\}/);
    assert.doesNotMatch(portalScriptText, /collage-tile/);
    assert.match(portalScriptText, /500,"fill"/);
    assert.doesNotMatch(portalScriptText, /animatePlaylistCollages/);
    assert.match(portalScriptText, /playlist-cover-file/);
    assert.match(portalScriptText, /event\.target!==dialog/);
    assert.match(portalScriptText, /zone\.now_playing\|\|\{\}/);
    assert.match(portalScriptText, /data-mini-seek/);
    assert.match(portalScriptText, /data-mini-volume/);
    assert.match(portalScriptText, /miniPlayerIsInteracting/);
    assert.match(portalScriptText, /playerPendingUpdates/);
    assert.match(portalScriptText, /if\(miniPlayerIsInteracting\(\)\)return/);
    assert.match(portalScriptText, /data-queue-setting="shuffle"/);
    assert.match(portalScriptText, /setInterval\(refreshMiniPlayerState,2000\)/);

    const authStatus = await fetch(`${baseUrl}/api/auth/status`);
    assert.equal((await authStatus.json()).setup_required, true);

    const setup = await fetch(`${baseUrl}/api/auth/setup`, {
      method: "POST",
      headers: {
        Authorization: "Bearer portal-test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: "administrator",
        password: "long-test-password"
      })
    });
    assert.equal(setup.status, 201);
    const setupBody = await setup.json();
    assert.match(setupBody.token, /^rns_/);

    const denied = await fetch(`${baseUrl}/api/session`);
    assert.equal(denied.status, 401);

    const session = await fetch(`${baseUrl}/api/session`, {
      headers: { Authorization: "Bearer portal-test-token" }
    });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).portal_port, 3001);

    const userSession = await fetch(`${baseUrl}/api/session`, {
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal(userSession.status, 200);
    assert.equal((await userSession.json()).user.username, "administrator");

    const managed = apiKeyService.create({ name: "Scoped", role: "control" });
    const restricted = await fetch(`${baseUrl}/api/admin/api-keys/${managed.key_id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tool_permissions: ["roon_status"] })
    });
    assert.deepEqual((await restricted.json()).tool_permissions, ["roon_status"]);

    const revokedResponse = await fetch(`${baseUrl}/api/admin/api-keys/${managed.key_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.ok((await revokedResponse.json()).revoked_at);
    const reactivatedResponse = await fetch(`${baseUrl}/api/admin/api-keys/${managed.key_id}/reactivate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal((await reactivatedResponse.json()).revoked_at, null);

    const toolsResponse = await fetch(`${baseUrl}/api/admin/tools`, {
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    const tools = await toolsResponse.json();
    assert.ok(tools.tools.some((tool) => tool.name === "roon_status"));
    const disabledToolResponse = await fetch(`${baseUrl}/api/admin/tools/roon_status`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ enabled: false })
    });
    assert.equal((await disabledToolResponse.json()).enabled, false);

    const readKey = apiKeyService.create({ name: "Read only", role: "read" });
    const forbidden = await fetch(`${baseUrl}/api/session`, {
      headers: { Authorization: `Bearer ${readKey.token}` }
    });
    assert.equal(forbidden.status, 403);

    const adminKey = apiKeyService.create({ name: "Admin", role: "admin" });
    const allowed = await fetch(`${baseUrl}/api/session`, {
      headers: { Authorization: `Bearer ${adminKey.token}` }
    });
    assert.equal(allowed.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
