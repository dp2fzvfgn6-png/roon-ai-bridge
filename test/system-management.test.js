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
      updateChannel: "stable"
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
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
