const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createServer } = require("../dist/api/server");
const { createDatabase } = require("../dist/db/database");
const { ZonePresetService } = require("../dist/services/zonePresetService");
const { VolumeLimitService } = require("../dist/services/volumeLimitService");

function config() {
  return {
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "roonia-lot2-")),
    port: 3000,
    portalPort: 3001,
    enablePortal: false,
    nodeEnv: "test",
    logLevel: "silent",
    roonExtensionName: "RoonIA",
    roonExtensionId: "test",
    enableBrowse: true,
    enableMcp: true,
    enableAuth: false,
    apiToken: null,
    portalAdminToken: null,
    publicBaseUrl: "http://localhost",
    oauthIssuer: "http://localhost",
    oauthApprovalPin: null,
    roonStreamingSource: "tidal"
  };
}

function logger() {
  const noop = () => {};
  return { info: noop, warn: noop, error: noop, debug: noop };
}

function client() {
  const output = {
    output_id: "salon-output",
    zone_id: "salon-zone",
    display_name: "Salon",
    can_group_with_output_ids: ["cocina-output"],
    volume: { type: "number", min: 0, max: 60, value: 20 }
  };
  const cocina = {
    output_id: "cocina-output",
    zone_id: "cocina-zone",
    display_name: "Cocina",
    can_group_with_output_ids: ["salon-output"],
    volume: { type: "number", min: 0, max: 60, value: 10 }
  };
  const zones = [
    { zone_id: "salon-zone", display_name: "Salon", state: "paused", outputs: [output] },
    { zone_id: "cocina-zone", display_name: "Cocina", state: "paused", outputs: [cocina] }
  ];
  return {
    isCoreConnected: () => true,
    isTransportReady: () => true,
    getZones: () => zones,
    getOutputs: () => [output, cocina],
    getOutput: (id) => [output, cocina].find((item) => item.output_id === id) || null,
    getZone: (id) => zones.find((zone) => zone.zone_id === id) || null,
    getTransport: () => ({
      group_outputs(outputs, callback) { callback(false); },
      change_volume(target, _mode, value, callback) {
        target.volume.value = value;
        callback(false);
      },
      control(_zone, _command, callback) { callback(false); }
    })
  };
}

test("volume limits evaluate schedules, priority and overlap validation", () => {
  const cfg = config();
  const database = createDatabase(cfg);
  const service = new VolumeLimitService(cfg, database);
  try {
    service.create({
      limit_id: "salon_output_specific",
      target_ref: { type: "output_id", value: "salon-output" },
      name: "Output specific",
      safe_max: 31
    });
    service.create({
      limit_id: "salon_night",
      target_ref: { type: "output_name", value: "Salon" },
      name: "Night",
      safe_max: 22,
      schedule: {
        timezone: "Europe/Madrid",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        from: "22:30",
        to: "08:00"
      }
    });
    service.create({
      limit_id: "cocina_general_test",
      target_ref: { type: "output_name", value: "Cocina" },
      name: "General",
      safe_max: 19
    });
    service.create({
      limit_id: "cocina_night_test",
      target_ref: { type: "output_name", value: "Cocina" },
      name: "Night",
      safe_max: 12,
      schedule: {
        timezone: "Europe/Madrid",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        from: "22:30",
        to: "08:00"
      }
    });

    const allowed = service.evaluate(client(), {
      target_ref: { type: "output_id", value: "salon-output" },
      requested_volume: 30,
      at: "2026-07-09T23:00:00+02:00"
    });
    assert.equal(allowed.safe_limit_source, "output_id");
    assert.equal(allowed.policy_result, "allowed");

    const blocked = service.evaluate(client(), {
      target_ref: { type: "output_name", value: "Salon" },
      requested_volume: 30,
      at: "2026-07-09T23:00:00+02:00"
    });
    assert.equal(blocked.active_limit.limit_id, "salon_output_specific");
    assert.equal(blocked.policy_result, "allowed");

    const scheduled = service.evaluate(client(), {
      target_ref: { type: "output_name", value: "Cocina" },
      requested_volume: 18,
      at: "2026-07-09T23:00:00+02:00"
    });
    assert.equal(scheduled.active_limit.limit_id, "cocina_night_test");
    assert.equal(scheduled.policy_result, "above_safe_limit");
    assert.equal(scheduled.requires_confirmation, true);

    assert.throws(
      () => service.create({
        target_ref: { type: "output_name", value: "Salon" },
        name: "Overlap",
        safe_max: 20,
        schedule: {
          timezone: "Europe/Madrid",
          days: ["thu"],
          from: "23:00",
          to: "07:00"
        }
      }),
      (error) => error.code === "VOLUME_LIMIT_OVERLAP"
    );
  } finally {
    database.close();
    fs.rmSync(cfg.dataDir, { recursive: true, force: true });
  }
});

test("zone preset dry-run returns confirmation when a requested volume exceeds active limit", async () => {
  const cfg = config();
  const database = createDatabase(cfg);
  const presets = new ZonePresetService(cfg, database);
  const limits = new VolumeLimitService(cfg, database);
  try {
    limits.create({
      limit_id: "salon_strict",
      target_ref: { type: "output_id", value: "salon-output" },
      name: "Strict",
      safe_max: 25
    });
    const preset = presets.create(client(), {
      preset_id: "dinner",
      name: "Dinner",
      grouping: {
        enabled: false,
        members: [{ type: "output_id", value: "salon-output" }]
      },
      volumes: [
        { target_ref: { type: "output_id", value: "salon-output" }, volume: 30 }
      ],
      playback: { action: "keep_current" }
    });
    const result = await presets.apply(client(), preset.preset_id, {
      dryRun: true,
      volumeLimitService: limits
    });
    assert.equal(result.requires_confirmation, true);
    assert.equal(result.confirmation_reason, "volume_above_safe_limit");
  } finally {
    database.close();
    fs.rmSync(cfg.dataDir, { recursive: true, force: true });
  }
});

test("HTTP endpoints expose preset and volume-limit payloads for the portal", async () => {
  const cfg = config();
  const database = createDatabase(cfg);
  const volumeLimitService = new VolumeLimitService(cfg, database);
  const context = {
    config: cfg,
    logger: logger(),
    roonClient: client(),
    playlistService: { listPlaylists: () => [] },
    oauthService: {},
    mediaService: {},
    apiKeyService: {},
    portalAuthService: {},
    systemManagementService: {},
    zonePresetService: new ZonePresetService(cfg, database),
    outputVolumeSettingsService: {},
    volumeLimitService
  };
  const server = createServer(context).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const created = await fetch(`${baseUrl}/volume-limits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target_ref: { type: "output_name", value: "Salon" },
        name: "Portal",
        safe_max: 32
      })
    });
    assert.equal(created.status, 201);

    const evaluate = await fetch(`${baseUrl}/volume-limits/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target_ref: { type: "output_name", value: "Salon" },
        requested_volume: 30
      })
    });
    assert.equal(evaluate.status, 200);
    assert.equal((await evaluate.json()).policy_result, "allowed");

    const preset = await fetch(`${baseUrl}/zone-presets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preset_id: "portal_test",
        name: "Portal test",
        grouping: { enabled: false, members: [{ type: "output_id", value: "salon-output" }] },
        volumes: [{ target_ref: { type: "output_id", value: "salon-output" }, volume: 24 }]
      })
    });
    assert.equal(preset.status, 201);
    assert.equal((await fetch(`${baseUrl}/zone-presets`)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
    fs.rmSync(cfg.dataDir, { recursive: true, force: true });
  }
});
