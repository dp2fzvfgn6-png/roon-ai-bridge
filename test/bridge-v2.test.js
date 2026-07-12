const assert = require("node:assert/strict");
const test = require("node:test");

const { IntentGateway } = require("../dist/bridge-v2/intentGateway");
const { TargetResolver } = require("../dist/bridge-v2/targetResolver");
const { normalizeServiceResult } = require("../dist/bridge-v2/contracts");

function zone(id, name, state = "stopped") {
  return { zone_id: id, display_name: name, state, outputs: [] };
}

function roonClient(zones = []) {
  return {
    getZones: () => zones,
    getOutputs: () => [],
    getKnownOutputs: () => [],
    getZone: (id) => zones.find((item) => item.zone_id === id) || null,
    getOutput: () => null,
    isCoreConnected: () => true,
    getCoreName: () => "Core",
    isTransportReady: () => true,
    isBrowseReady: () => true,
    isImageReady: () => true
  };
}

function gatewayContext(client, mediaService) {
  const noop = () => {};
  return {
    config: {},
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    roonClient: client,
    mediaService,
    playlistService: {},
    zonePresetService: {},
    volumeLimitService: { activeSafetyLimits: () => [] }
  };
}

test("v2 target resolver accepts IDs and accent-insensitive exact names", () => {
  const client = roonClient([zone("z1", "Salón"), zone("z2", "Despacho")]);
  const resolver = new TargetResolver(client);

  assert.equal(resolver.zone({ name: "salon" }).zone_id, "z1");
  assert.equal(resolver.zone({ id: "z2" }).display_name, "Despacho");
  assert.throws(() => resolver.zone({ name: "Cocina" }), /not found/i);
});

test("v2 play intent resolves a query and acts without a preliminary zone-list call", async () => {
  const client = roonClient([zone("z1", "Despacho", "playing")]);
  let searches = 0;
  let plays = 0;
  const mediaService = {
    search: async () => {
      searches += 1;
      return {
        recommended_result_id: "result-1",
        selection_required: false,
        results: [{ result_id: "result-1", media_type: "album", title: "Kid A" }]
      };
    },
    play: async (resultId, zoneId, mode) => {
      plays += 1;
      assert.deepEqual([resultId, zoneId, mode], ["result-1", "z1", "replace_queue"]);
      return { ok: true };
    }
  };
  const gateway = new IntentGateway(gatewayContext(client, mediaService));

  const result = await gateway.playMedia({
    zone: { name: "Despacho" },
    media: { query: "Kid A de Radiohead", type: "album" }
  });

  assert.equal(searches, 1);
  assert.equal(plays, 1);
  assert.equal(result.status, "completed");
  assert.equal(result.operation, "roon_play_media");
});

test("v2 play intent returns candidates and never acts on an ambiguous search", async () => {
  const client = roonClient([zone("z1", "Despacho")]);
  let plays = 0;
  const mediaService = {
    search: async () => ({
      recommended_result_id: "one",
      selection_required: true,
      results: [
        { result_id: "one", media_type: "track", title: "Song" },
        { result_id: "two", media_type: "track", title: "Song (Live)" }
      ]
    }),
    play: async () => { plays += 1; }
  };
  const gateway = new IntentGateway(gatewayContext(client, mediaService));

  const result = await gateway.playMedia({
    zone: { name: "Despacho" },
    media: { query: "Song", type: "track" }
  });

  assert.equal(result.status, "ambiguous");
  assert.equal(plays, 0);
  assert.equal(result.data.candidates.length, 2);
});

test("v2 batch playlist edits require confirmation before removing tracks", () => {
  const client = roonClient();
  let removals = 0;
  const context = gatewayContext(client, {});
  context.playlistService = {
    removeTrack: () => { removals += 1; },
    getPlaylist: () => ({ playlist_id: "p1" })
  };
  const gateway = new IntentGateway(context);

  const pending = gateway.editPlaylistTracks({
    playlist_id: "p1",
    operations: [{ type: "remove", track_id: "t1" }]
  });
  assert.equal(pending.status, "confirmation_required");
  assert.equal(removals, 0);

  const completed = gateway.editPlaylistTracks({
    playlist_id: "p1",
    operations: [{ type: "remove", track_id: "t1" }],
    confirm: true
  });
  assert.equal(completed.status, "completed");
  assert.equal(removals, 1);
});

test("v2 never upgrades an explicitly unverified SDK result", () => {
  const result = normalizeServiceResult(
    "roon_set_volume",
    "Volume accepted.",
    { ok: true, state_verified: false },
    true
  );
  assert.equal(result.status, "completed");
  assert.equal(result.verified, false);
});
