const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createDatabase } = require("../dist/db/database");
const { PortalAuthService } = require("../dist/services/portalAuthService");

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
    apiToken: "bootstrap",
    portalAdminToken: "bootstrap",
    publicBaseUrl: "https://example.test",
    oauthIssuer: "https://example.test",
    oauthApprovalPin: "pin",
    roonStreamingSource: "tidal"
  };
}

test("bootstraps one portal administrator and manages hashed sessions", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-admin-"));
  const appConfig = config(dataDir);
  const database = createDatabase(appConfig);
  const service = new PortalAuthService(appConfig, database);
  try {
    assert.equal(service.setupRequired(), true);
    const first = service.setup({
      username: "owner",
      password: "a-secure-password"
    });
    assert.match(first.token, /^rns_/);
    assert.equal(service.setupRequired(), false);
    assert.equal(service.authenticate(first.token).username, "owner");

    const stored = database.db
      .prepare("SELECT password_hash, token_hash FROM portal_users, portal_sessions")
      .get();
    assert.notEqual(stored.password_hash, "a-secure-password");
    assert.notEqual(stored.token_hash, first.token);

    assert.throws(
      () => service.setup({ username: "other", password: "another-password" }),
      /already been configured/
    );
    const login = service.login({
      username: "OWNER",
      password: "a-secure-password"
    });
    assert.equal(service.authenticate(login.token).username, "owner");
    service.logout(login.token);
    assert.equal(service.authenticate(login.token), null);

    const second = service.createUser({ username: "operator", password: "operator-password" });
    assert.equal(service.listUsers().length, 2);
    service.resetPassword(second.user_id, { password: "replacement-password" });
    assert.equal(service.login({ username: "operator", password: "replacement-password" }).user.user_id, second.user_id);
    assert.equal(service.deleteUser(second.user_id).username, "operator");
    assert.throws(() => service.deleteUser(first.user.user_id), /last portal user/);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
