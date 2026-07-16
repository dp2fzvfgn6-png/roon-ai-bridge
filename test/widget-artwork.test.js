const assert = require("node:assert/strict");
const test = require("node:test");

const { embedWidgetArtwork } = require("../dist/bridge-v2/widgets/artwork");
const { registerWidgetV2Tools } = require("../dist/bridge-v2/widgets/tools");

test("embeds deduplicated Roon and custom artwork only in the private widget payload", async () => {
  const calls = [];
  const logs = [];
  const context = {
    roonClient: {
      isCoreConnected: () => true,
      isImageReady: () => true,
      getImage: () => ({
        get_image: (key, options, callback) => {
          calls.push({ key, options });
          if (key === "missing") callback("not found", "image/jpeg", Buffer.alloc(0));
          else callback(false, "image/jpeg", Buffer.from(`jpeg-${key}`));
        }
      })
    },
    playlistService: {
      getCustomCover: (id) => {
        assert.equal(id, "hero.webp");
        return { content_type: "image/webp", bytes: Buffer.from("custom-cover") };
      }
    },
    logger: {
      debug: () => {},
      info: (message, meta) => logs.push({ level: "info", message, meta }),
      warn: (message, meta) => logs.push({ level: "warn", message, meta }),
      error: () => {}
    }
  };
  const widget = {
    widget_version: 3,
    view: "playlist",
    title: "Focus",
    generated_at: new Date().toISOString(),
    playlist: { image_key: "custom:hero.webp", image_url: null },
    tracks: [
      { image_key: "roon-1", image_url: null },
      { image_key: "roon-1", image_url: null },
      { image_key: "missing", image_url: null }
    ]
  };

  const result = await embedWidgetArtwork(context, widget);

  assert.match(result.playlist.image_url, /^data:image\/webp;base64,/);
  assert.match(result.tracks[0].image_url, /^data:image\/jpeg;base64,/);
  assert.equal(result.tracks[1].image_url, result.tracks[0].image_url);
  assert.equal(result.tracks[2].image_url, null);
  assert.deepEqual(result.artwork_delivery, {
    mode: "inline_data_url",
    requested: 3,
    embedded: 2,
    failed: 1
  });
  assert.deepEqual(calls.map((call) => call.key).sort(), ["missing", "roon-1"]);
  assert.equal(calls[0].options.width, 160);
  assert.equal(calls[0].options.height, 160);
  assert.equal(logs.filter((entry) => entry.level === "warn").length, 1);
  assert.equal(logs.filter((entry) => entry.level === "info").length, 1);
});

test("render tool keeps Base64 artwork in _meta and out of model-visible content", async () => {
  const handlers = new Map();
  const server = {
    registerTool(name, options, handler) {
      handlers.set(name, handler);
    }
  };
  const zone = {
    zone_id: "office",
    display_name: "Despacho",
    state: "playing",
    now_playing: {
      image_key: "now-playing-cover",
      three_line: { line1: "Everything", line2: "Radiohead", line3: "Kid A" }
    },
    outputs: [],
    settings: { shuffle: false, auto_radio: false, loop: "disabled" }
  };
  const context = {
    config: { publicBaseUrl: "https://example.test", enableAuth: true, apiToken: "secret" },
    roonClient: {
      getZones: () => [zone],
      getZone: () => zone,
      getOutputs: () => [],
      getOutput: () => null,
      isCoreConnected: () => true,
      isImageReady: () => true,
      getImage: () => ({
        get_image: (key, options, callback) =>
          callback(false, "image/jpeg", Buffer.from(`jpeg-${key}`))
      })
    },
    playlistService: {},
    mediaService: {},
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  };

  registerWidgetV2Tools(server, context);
  const result = await handlers.get("roon_show_now_playing")({});

  assert.equal(JSON.stringify(result.structuredContent).includes("base64"), false);
  assert.equal(JSON.stringify(result.content).includes("base64"), false);
  assert.match(result._meta.widget.zones[0].media.image_url, /^data:image\/jpeg;base64,/);
  assert.deepEqual(result._meta.widget.artwork_delivery, {
    mode: "inline_data_url",
    requested: 1,
    embedded: 1,
    failed: 0
  });
});
