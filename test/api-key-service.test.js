const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");

const { ApiKeyService, roleCanControl } = require("../dist/services/apiKeyService");
const { createDatabase } = require("../dist/db/database");
const { createAuthMiddleware } = require("../dist/api/middleware/auth");

function config(dataDir) {
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
    apiToken: "bootstrap-secret",
    portalAdminToken: "bootstrap-secret",
    publicBaseUrl: "https://example.test",
    oauthIssuer: "https://example.test",
    oauthApprovalPin: "pin",
    roonStreamingSource: "tidal"
  };
}

test("creates hashed API keys, authenticates roles and permanently revokes keys", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-keys-"));
  const database = createDatabase(config(dataDir));
  const service = new ApiKeyService(config(dataDir), database);

  try {
    const created = service.create({ name: "Portal test", role: "admin" });
    assert.match(created.token, /^rnb_[A-Za-z0-9_-]+$/);
    assert.equal(created.role, "admin");

    const raw = database.db
      .prepare("SELECT key_hash FROM api_keys WHERE key_id = ?")
      .get(created.key_id);
    assert.notEqual(raw.key_hash, created.token);
    assert.equal(JSON.stringify(service.list()).includes(created.token), false);

    const authenticated = service.authenticate(created.token);
    assert.equal(authenticated.key_id, created.key_id);
    assert.ok(authenticated.last_used_at);
    assert.equal(roleCanControl(authenticated.role), true);
    assert.equal(roleCanControl("read"), false);

    const revoked = service.revoke(created.key_id);
    assert.ok(revoked.revoked_at);
    assert.equal(service.authenticate(created.token), null);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("enforces read and control roles on the main HTTP API", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-roles-"));
  const appConfig = config(dataDir);
  const database = createDatabase(appConfig);
  const service = new ApiKeyService(appConfig, database);
  const readKey = service.create({ name: "Reader", role: "read" });
  const controlKey = service.create({ name: "Controller", role: "control" });
  const context = {
    config: appConfig,
    apiKeyService: service,
    oauthService: {
      tokenIsValid: () => false,
      getExpectedResource: () => "https://example.test/mcp"
    }
  };
  const app = express();
  app.use(createAuthMiddleware(context));
  app.get("/resource", (_req, res) => res.json({ ok: true }));
  app.post("/resource", (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: error.code || "INTERNAL_ERROR" });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/resource`;

  try {
    const readResponse = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${readKey.token}` }
    });
    assert.equal(readResponse.status, 200);

    const deniedWrite = await fetch(baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${readKey.token}` }
    });
    assert.equal(deniedWrite.status, 403);

    const allowedWrite = await fetch(baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${controlKey.token}` }
    });
    assert.equal(allowedWrite.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
