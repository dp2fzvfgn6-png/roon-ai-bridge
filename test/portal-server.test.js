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
const { OAuthService } = require("../dist/services/oauthService");

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
    oauthService: new OAuthService(config),
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
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(page.headers.get("content-security-policy"), /img-src 'self' data: blob:/);
    const portalPageText = await page.text();
    assert.match(portalPageText, /roonIA/);
    assert.match(portalPageText, /id="context-modal"/);
    assert.match(portalPageText, /src="\/roonia-logo\.svg"/);
    assert.match(portalPageText, /href="\/styles\.css\?v=20260713\.7"/);
    assert.match(portalPageText, /src="\/app\.js\?v=20260713\.7"/);
    assert.match(portalPageText, /id="refresh"[^>]*hidden/);
    assert.match(portalPageText, /id="save-ports"[^>]*hidden/);
    assert.match(portalPageText, />library_music<\/span><span>Música<\/span>/);
    assert.match(portalPageText, /data-tab="browse">Mi Música<\/button>/);
    assert.doesNotMatch(portalPageText, /id="browse-hierarchy"/);
    assert.match(portalPageText, /id="playlist-sort"/);

    const logo = await fetch(`${baseUrl}/roonia-logo.svg`);
    assert.equal(logo.status, 200);
    assert.match(logo.headers.get("content-type"), /image\/svg\+xml/);
    assert.match(await logo.text(), /aria-label="roonIA logo"/);

    const portalStyles = await fetch(`${baseUrl}/styles.css`);
    assert.equal(portalStyles.status, 200);
    assert.equal(portalStyles.headers.get("cache-control"), "no-store");
    const portalStylesText = await portalStyles.text();
    assert.match(portalStylesText, /\.playlist-collage \{[^}]*gap: 0;[^}]*padding: 0;[^}]*background: #000;/);
    assert.match(portalStylesText, /\.playlist-collage\.collage-2x2 \{[^}]*repeat\(2,/);
    assert.match(portalStylesText, /\.playlist-collage\.collage-3x3 \{[^}]*repeat\(3,/);
    assert.match(portalStylesText, /\.playlist-collage\.collage-4x4 \{[^}]*repeat\(4,/);
    assert.match(portalStylesText, /\.playlist-collage > img \{[^}]*min-width: 0;[^}]*object-fit: cover;[^}]*object-position: center;/);
    assert.match(portalStylesText, /\.playlist-card p \{[^}]*-webkit-line-clamp:4;/);
    assert.match(portalStylesText, /\.library-destination-grid/);

    const portalScript = await fetch(`${baseUrl}/app.js`);
    assert.equal(portalScript.status, 200);
    assert.equal(portalScript.headers.get("cache-control"), "no-store");
    const portalScriptText = await portalScript.text();
    assert.match(portalScriptText, /data-image-key/);
    assert.match(portalScriptText, /active-zone-select/);
    assert.match(portalScriptText, /data-play-mode="play_next"/);
    assert.match(portalScriptText, /artist:6, album:6, ep:6, single_ep:6, single:6, track:12/);
    assert.match(portalScriptText, /data-more-results/);
    assert.match(portalScriptText, /playlist-search-form/);
    assert.match(portalScriptText, /artist-detail/);
    assert.match(portalScriptText, /album-detail/);
    assert.match(portalScriptText, /entityByline\(np\.line2,np\.line3/);
    assert.match(portalScriptText, /entityByline\(item\.artist,null,item\.subtitle\|\|""\)/);
    assert.match(portalScriptText, /entityLink\("album",item\.album,item\.artist\|\|null\)/);
    assert.match(portalScriptText, /data-entity-link="\$\{esc\(type\)\}"/);
    assert.match(portalScriptText, /playlist-collage/);
    assert.match(portalScriptText, /keys\.length<=4\?2:keys\.length<=9\?3:4/);
    assert.match(portalScriptText, /capacity=columns\*columns/);
    assert.match(portalScriptText, /collage-\$\{columns\}x\$\{columns\}/);
    assert.doesNotMatch(portalScriptText, /style="--collage-columns/);
    assert.doesNotMatch(portalScriptText, /collage-tile/);
    assert.match(portalScriptText, /500,"fill"/);
    assert.match(portalScriptText, /setInterval\(animatePlaylistCollages,2600\)/);
    assert.match(portalScriptText, /prefers-reduced-motion: reduce/);
    assert.match(portalScriptText, /playlist-cover-file/);
    assert.match(portalScriptText, /function sortedPlaylists/);
    assert.match(portalScriptText, /last_played_at/);
    assert.match(portalScriptText, /function loadMyMusic/);
    assert.match(portalScriptText, /data-library-hierarchy/);
    assert.match(portalScriptText, /\['settings','setting','ajustes','configuracion'\]/);
    assert.match(portalScriptText, /event\.target!==dialog/);
    assert.match(portalScriptText, /zone\.now_playing\|\|\{\}/);
    assert.match(portalScriptText, /data-mini-seek/);
    assert.match(portalScriptText, /data-mini-volume/);
    assert.match(portalScriptText, /miniPlayerIsInteracting/);
    assert.match(portalScriptText, /playerPendingUpdates/);
    assert.match(portalScriptText, /if\(miniPlayerIsInteracting\(\)\)return/);
    assert.match(portalScriptText, /miniRenderSignature===signature/);
    assert.match(portalScriptText, /homePlaybackSignature===signature/);
    assert.match(portalScriptText, /if\(state\.view==='home'\)renderHomePlayback\(\)/);
    assert.match(portalScriptText, /data-queue-setting="shuffle"/);
    assert.match(portalScriptText, /setInterval\(refreshMiniPlayerState,2000\)/);
    assert.match(portalPageText, /data-tab="users">Usuarios/);
    assert.match(portalPageText, /data-tab="connections">Conexiones/);
    assert.match(portalPageText, /id="system-bridge-url"/);
    assert.match(portalScriptText, /delete_forever/);
    assert.match(portalScriptText, /function confirmPortal/);

    const previewScriptText = fs.readFileSync(
      path.join(__dirname, "..", "scripts", "portal-ux-preview.js"),
      "utf8"
    );
    assert.match(previewScriptText, /function previewSearchPayload/);
    assert.match(previewScriptText, /best_match:/);
    assert.match(previewScriptText, /best_by_type/);
    assert.match(previewScriptText, /groups/);
    assert.match(previewScriptText, /release_type_source:"roon_metadata"/);
    assert.doesNotMatch(previewScriptText, /three_line/);

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

    const connectionsResponse = await fetch(`${baseUrl}/api/admin/connections`, {
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    const connections = await connectionsResponse.json();
    assert.equal(connections.chatgpt.mcp_url, "https://example.test/mcp");
    assert.equal(connections.mcp_clients.profiles.length, 3);

    const oauthClientResponse = await fetch(`${baseUrl}/api/admin/connections/oauth/clients`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_name: "ChatGPT portal",
        redirect_uris: ["https://chatgpt.com/connector/oauth/portal"]
      })
    });
    assert.equal(oauthClientResponse.status, 201);
    assert.match((await oauthClientResponse.json()).client_id, /^roonia_/);

    const mcpCredentialResponse = await fetch(`${baseUrl}/api/admin/connections/mcp-credentials`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ client_type: "generic", name: "Test host", role: "read" })
    });
    const mcpCredential = await mcpCredentialResponse.json();
    assert.equal(mcpCredentialResponse.status, 201);
    assert.match(mcpCredential.config_json, /Bearer rnb_/);

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

    const revokedResponse = await fetch(`${baseUrl}/api/admin/api-keys/${managed.key_id}/revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.ok((await revokedResponse.json()).revoked_at);
    const reactivatedResponse = await fetch(`${baseUrl}/api/admin/api-keys/${managed.key_id}/reactivate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal((await reactivatedResponse.json()).revoked_at, null);

    const usersResponse = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal((await usersResponse.json()).length, 1);
    const createdUserResponse = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username: "operator", password: "operator-password" })
    });
    assert.equal(createdUserResponse.status, 201);
    const createdUser = await createdUserResponse.json();
    const deletedUserResponse = await fetch(`${baseUrl}/api/admin/users/${createdUser.user_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal(deletedUserResponse.status, 200);

    const deletedKeyResponse = await fetch(`${baseUrl}/api/admin/api-keys/${managed.key_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal(deletedKeyResponse.status, 200);

    const toolsResponse = await fetch(`${baseUrl}/api/admin/tools`, {
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    const tools = await toolsResponse.json();
    assert.ok(tools.tools.some((tool) => tool.name === "roon_get_state"));
    assert.equal(tools.tools.some((tool) => tool.name === "roon_status"), false);
    const disabledToolResponse = await fetch(`${baseUrl}/api/admin/tools/roon_get_state`, {
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
