const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createPortalServer } = require("../dist/portal/server");
const { ApiKeyService } = require("../dist/services/apiKeyService");
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
    assert.match(await page.text(), /RoonIA Control/);

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
