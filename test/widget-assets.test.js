const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createWidgetAssetUrl,
  verifyWidgetAssetSignature
} = require("../dist/services/widgetAssetService");
const { createServer } = require("../dist/api/server");

function config(overrides = {}) {
  return {
    enableAuth: true,
    apiToken: "private-test-token",
    publicBaseUrl: "https://example.test",
    ...overrides
  };
}

test("creates stable signed artwork URLs without exposing the API token", () => {
  const now = Date.UTC(2026, 6, 13, 12, 0, 0);
  const first = createWidgetAssetUrl(config(), "roon-image", "image/key 1", now);
  const second = createWidgetAssetUrl(config(), "roon-image", "image/key 1", now + 60_000);

  assert.equal(first, second);
  assert.match(first, /^https:\/\/example\.test\/mcp\?/);
  assert.equal(first.includes("private-test-token"), false);

  const parsed = new URL(first);
  assert.equal(parsed.pathname, "/mcp");
  assert.equal(parsed.searchParams.get("widget_asset"), "roon-image");
  assert.equal(parsed.searchParams.get("asset_id"), "image/key 1");
  assert.equal(
    verifyWidgetAssetSignature(
      config(),
      "roon-image",
      "image/key 1",
      parsed.searchParams.get("expires"),
      parsed.searchParams.get("signature"),
      now
    ),
    true
  );
});

test("rejects tampered and expired widget artwork signatures", () => {
  const now = Date.UTC(2026, 6, 13, 12, 0, 0);
  const parsed = new URL(createWidgetAssetUrl(config(), "playlist-cover", "cover-1", now));
  const expires = parsed.searchParams.get("expires");
  const signature = parsed.searchParams.get("signature");

  assert.equal(
    verifyWidgetAssetSignature(config(), "playlist-cover", "cover-2", expires, signature, now),
    false
  );
  assert.equal(
    verifyWidgetAssetSignature(config(), "playlist-cover", "cover-1", expires, signature, now + 3 * 60 * 60 * 1000),
    false
  );
});

test("uses the public MCP route without a signature when HTTP authentication is disabled", () => {
  const parsed = new URL(
    createWidgetAssetUrl(config({ enableAuth: false, apiToken: null }), "roon-image", "image-1")
  );
  assert.equal(parsed.pathname, "/mcp");
  assert.equal(parsed.searchParams.get("widget_asset"), "roon-image");
  assert.equal(parsed.searchParams.get("asset_id"), "image-1");
  assert.equal(parsed.searchParams.has("signature"), false);
});

test("serves a signed artwork request before bearer authentication", async () => {
  const appConfig = {
    ...config({ publicBaseUrl: "https://public.example" }),
    port: 3000,
    portalPort: 3001,
    enablePortal: false,
    nodeEnv: "test",
    logLevel: "error",
    roonExtensionName: "Test",
    roonExtensionId: "test",
    dataDir: ".",
    enableBrowse: true,
    enableMcp: true,
    portalAdminToken: null,
    portalPublicUrl: "https://portal.example",
    oauthIssuer: "https://public.example",
    oauthApprovalPin: null,
    roonStreamingSource: "tidal",
    updateChannel: "beta"
  };
  const noop = () => {};
  const context = {
    config: appConfig,
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    roonClient: {
      isCoreConnected: () => true,
      isImageReady: () => true,
      getImage: () => ({
        get_image: (key, options, callback) => {
          assert.equal(key, "cover/key");
          assert.equal(options.width, 640);
          callback(false, "image/jpeg", Buffer.from("jpeg-bytes"));
        }
      })
    },
    playlistService: {},
    mediaService: {},
    volumeLimitService: {},
    oauthService: {},
    apiKeyService: {},
    portalAuthService: {},
    systemManagementService: {},
    zonePresetService: {},
    outputVolumeSettingsService: {},
    toolAccessService: {}
  };
  const server = createServer(context).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const signed = new URL(createWidgetAssetUrl(appConfig, "roon-image", "cover/key"));
    const response = await fetch(`${baseUrl}${signed.pathname}${signed.search}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "jpeg-bytes");

    signed.searchParams.delete("signature");
    const rejected = await fetch(`${baseUrl}${signed.pathname}${signed.search}`);
    assert.equal(rejected.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
