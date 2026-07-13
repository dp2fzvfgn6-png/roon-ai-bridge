const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDatabase } = require("../dist/db/database");
const { ApiKeyService } = require("../dist/services/apiKeyService");
const { OAuthService } = require("../dist/services/oauthService");
const { ConnectionService } = require("../dist/services/connectionService");

function config(dataDir) {
  return {
    dataDir,
    enableMcp: true,
    enableAuth: true,
    publicBaseUrl: "https://roonia.example.test",
    oauthIssuer: "https://roonia.example.test",
    oauthApprovalPin: "123456"
  };
}

test("builds ChatGPT readiness and one-time MCP client configurations", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-connections-"));
  const appConfig = config(dataDir);
  const database = createDatabase(appConfig);
  const apiKeys = new ApiKeyService(appConfig, database);
  const oauth = new OAuthService(appConfig);
  const service = new ConnectionService(appConfig, oauth, apiKeys);

  const overview = await service.overview();
  assert.equal(overview.chatgpt.ready, true);
  assert.equal(overview.chatgpt.connection_mode, "public_url");
  assert.equal(overview.chatgpt.mcp_url, "https://roonia.example.test/mcp");
  assert.deepEqual(
    overview.mcp_clients.profiles.map((profile) => profile.id),
    ["lm_studio", "ollama_host", "generic"]
  );

  const created = service.createMcpCredential({
    client_type: "lm_studio",
    name: "Studio PC",
    role: "control"
  });
  assert.match(created.credential.token, /^rnb_/);
  assert.equal(
    created.config.mcpServers.roonia.headers.Authorization,
    `Bearer ${created.credential.token}`
  );
  assert.equal((await service.overview()).mcp_clients.credentials.length, 1);
});

test("recommends a secure tunnel for a private MCP address", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-private-connections-"));
  const appConfig = {
    ...config(dataDir),
    port: 3000,
    publicBaseUrl: "https://10.0.30.42",
    oauthIssuer: "https://10.0.30.42"
  };
  const database = createDatabase(appConfig);
  const service = new ConnectionService(
    appConfig,
    new OAuthService(appConfig),
    new ApiKeyService(appConfig, database)
  );

  const overview = await service.overview();
  assert.equal(overview.chatgpt.ready, false);
  assert.equal(overview.chatgpt.connection_mode, "secure_tunnel");
  assert.equal(overview.chatgpt.public_dns.detail, "Dirección privada");
  assert.equal(overview.chatgpt.tunnel.private_mcp_url, "http://127.0.0.1:3000/mcp");
});
