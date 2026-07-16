const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createDatabase } = require("../dist/db/database");
const { HomeHistoryService } = require("../dist/services/homeHistoryService");

function createConfig(dataDir) {
  return { dataDir };
}

test("keeps independent limits for searches and listening history", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-home-history-"));
  const database = createDatabase(createConfig(dataDir));
  const history = new HomeHistoryService(database);

  for (let index = 0; index < 501; index += 1) {
    history.record({
      event_type: "play",
      title: `Track ${index}`,
      zone_name: "Despacho"
    });
  }
  for (let index = 0; index < 101; index += 1) {
    history.record({ event_type: "search", title: `Query ${index}`, query: `Query ${index}` });
  }

  const plays = history.list({ eventType: "play", limit: 500 });
  const searches = history.list({ eventType: "search", limit: 100 });
  assert.equal(plays.total, 500);
  assert.equal(plays.entries.some((entry) => entry.title === "Track 0"), false);
  assert.equal(plays.entries.some((entry) => entry.title === "Track 500"), true);
  assert.equal(searches.total, 100);
  assert.equal(searches.entries.some((entry) => entry.title === "Query 0"), false);
  assert.equal(searches.entries.some((entry) => entry.title === "Query 100"), true);
  database.close();
});

test("filters and pages each history independently", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-home-history-page-"));
  const database = createDatabase(createConfig(dataDir));
  const history = new HomeHistoryService(database);
  for (let index = 0; index < 12; index += 1) {
    history.record({ event_type: "search", title: `Query ${index}`, query: `Query ${index}` });
  }

  const page = history.list({ eventType: "search", limit: 5, offset: 5 });
  assert.equal(page.total, 12);
  assert.equal(page.entries.length, 5);
  assert.equal(page.offset, 5);
  assert.equal(page.event_type, "search");
  database.close();
});

test("records real track transitions per zone without duplicating seek updates", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-home-history-zones-"));
  const database = createDatabase(createConfig(dataDir));
  const history = new HomeHistoryService(database);
  const zone = (title, seekPosition, state = "playing") => ({
    zone_id: "office",
    display_name: "Despacho",
    state,
    now_playing: {
      image_key: `cover-${title}`,
      seek_position: seekPosition,
      three_line: { line1: title, line2: "Artist", line3: "Album" }
    }
  });

  assert.equal(history.observeZones([zone("First", 1)]), 1);
  assert.equal(history.observeZones([zone("First", 12)]), 0);
  assert.equal(history.observeZones([zone("First", 12, "paused")]), 0);
  assert.equal(history.observeZones([zone("First", 13)]), 0);
  assert.equal(history.observeZones([zone("Second", 0)]), 1);
  assert.equal(history.observeZones([zone("Second", 40)]), 0);
  assert.equal(history.observeZones([zone("Second", 1)]), 1);

  const plays = history.list({ eventType: "play", limit: 10 });
  assert.equal(plays.total, 3);
  assert.equal(plays.entries[0].title, "Second");
  assert.equal(plays.entries[0].zone_name, "Despacho");
  assert.equal(plays.entries[0].image_key, "cover-Second");
  database.close();
});
