const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { closeHttpServer } = require("../dist/app/shutdown");
const { createApplication } = require("../dist/app/createApplication");

test("closes an HTTP listener gracefully", async () => {
  const server = http.createServer((_req, res) => res.end("ok"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  assert.equal(await closeHttpServer(server, 100), "graceful");
  assert.equal(server.listening, false);
});

test("forces server connections closed after the grace period", async () => {
  let forced = false;
  const server = {
    listening: true,
    close() {},
    closeIdleConnections() {},
    closeAllConnections() { forced = true; }
  };
  assert.equal(await closeHttpServer(server, 5), "forced");
  assert.equal(forced, true);
});

test("application shutdown is safe to call more than once", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-shutdown-"));
  const runtime = createApplication({
    port: 3000,
    portalPort: 3001,
    enablePortal: false,
    nodeEnv: "test",
    logLevel: "error",
    roonExtensionName: "RoonIA Test",
    roonExtensionId: "test.roonia.shutdown",
    dataDir,
    enableBrowse: true,
    enableMcp: true,
    enableAuth: false,
    apiToken: null,
    portalAdminToken: null,
    publicBaseUrl: "http://localhost:3000",
    portalPublicUrl: "http://localhost:3001",
    oauthIssuer: "http://localhost:3000",
    oauthApprovalPin: null,
    roonStreamingSource: "tidal",
    updateChannel: "beta",
    automaticUpdateChecks: false,
    debugMode: false
  });
  runtime.shutdown();
  assert.doesNotThrow(() => runtime.shutdown());
  fs.rmSync(dataDir, { recursive: true, force: true });
});
