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

test("keeps the 100 newest portal searches and playback entries", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-home-history-"));
  const database = createDatabase(createConfig(dataDir));
  const history = new HomeHistoryService(database);

  for (let index = 0; index < 101; index += 1) {
    history.record({
      event_type: index % 2 ? "play" : "search",
      title: `Entry ${index}`,
      query: index % 2 ? null : `Query ${index}`,
      result_id: index % 2 ? `result-${index}` : null,
      zone_name: index % 2 ? "Despacho" : null
    });
  }

  const list = history.list(100);
  assert.equal(list.total, 100);
  assert.equal(list.entries.length, 100);
  assert.equal(list.entries.some((entry) => entry.title === "Entry 0"), false);
  assert.equal(list.entries.some((entry) => entry.title === "Entry 100"), true);
  database.close();
});
