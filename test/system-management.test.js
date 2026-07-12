const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadRuntimePortOverrides } = require("../dist/config/env");
const {
  SystemManagementService
} = require("../dist/services/systemManagementService");

test("persists safe runtime ports and emits a fixed update request", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-system-"));
  const config = {
    port: 3000,
    portalPort: 3001,
    dataDir,
    updateChannel: "stable"
  };
  const noop = () => {};
  const service = new SystemManagementService(config, {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop
  });
  try {
    const saved = service.saveRuntimeConfig({
      api_port: 4100,
      portal_port: 4101,
      allow_beta_updates: false
    });
    assert.equal(saved.restart_required, true);
    assert.deepEqual(loadRuntimePortOverrides(dataDir), {
      port: 4100,
      portalPort: 4101,
      updateChannel: "stable",
      publicBaseUrl: "http://localhost:4100",
      portalPublicUrl: "http://localhost:4101"
    });
    assert.throws(
      () => service.savePorts({ api_port: 4100, portal_port: 4100 }),
      /must be different/
    );

    const requested = service.requestUpdate();
    const file = JSON.parse(
      fs.readFileSync(path.join(dataDir, "update-request.json"), "utf8")
    );
    assert.equal(requested.action, "update");
    assert.equal(requested.channel, "stable");
    assert.equal(file.target, "main");
    assert.equal(Object.prototype.hasOwnProperty.call(file, "command"), false);

    const betaService = new SystemManagementService({
      ...config,
      updateChannel: "beta"
    }, {
      info: noop,
      warn: noop,
      error: noop,
      debug: noop
    });
    const betaRequested = betaService.requestUpdate();
    const betaFile = JSON.parse(
      fs.readFileSync(path.join(dataDir, "update-request.json"), "utf8")
    );
    assert.equal(betaRequested.channel, "beta");
    assert.equal(betaRequested.target, "beta");
    assert.equal(betaFile.target, "beta");
    assert.equal(betaService.requestUpdate({ allow_beta_updates: false }).target, "main");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("compares update builds even when the semantic version is unchanged", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-build-check-"));
  const previousFetch = global.fetch;
  const previousCommit = process.env.GIT_COMMIT;
  process.env.GIT_COMMIT = "111111111111aaaaaaaa";
  global.fetch = async (url) => String(url).includes("package.json")
    ? new Response(JSON.stringify({ version: "0.16.1" }), { status: 200 })
    : new Response(JSON.stringify({ sha: "222222222222bbbbbbbb" }), { status: 200 });
  const noop = () => {};
  const service = new SystemManagementService({
    port: 3000,
    portalPort: 3001,
    dataDir,
    updateChannel: "stable"
  }, { info: noop, warn: noop, error: noop, debug: noop });
  try {
    const status = await service.checkForUpdates({ allow_beta_updates: false });
    assert.equal(status.current_version, "0.16.1");
    assert.equal(status.current_build, "111111111111");
    assert.equal(status.latest_build, "222222222222");
    assert.equal(status.update_available, true);
  } finally {
    global.fetch = previousFetch;
    if (previousCommit === undefined) delete process.env.GIT_COMMIT;
    else process.env.GIT_COMMIT = previousCommit;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("host update watcher is standalone and always publishes terminal failures", () => {
  const watcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "lxc-apply-update.sh"),
    "utf8"
  );
  const installer = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "lxc-update-app.sh"),
    "utf8"
  );
  assert.doesNotMatch(watcher, /node\s+-p/);
  assert.match(watcher, /"state":"failed"/);
  assert.match(watcher, /La actualización no se pudo completar/);
  assert.match(installer, /install -m 0755 "\$\{APP_DIR\}\/scripts\/lxc-apply-update\.sh"/);
  assert.doesNotMatch(installer, /cat >\/usr\/local\/sbin\/roon-ai-bridge-apply-update/);
});
