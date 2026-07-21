const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOTS = ["src", "portal", "scripts"];
const TEXT_EXTENSIONS = new Set([".ts", ".js", ".html", ".css", ".sh", ".md", ".sql"]);
const MOJIBAKE = /Ã.|Â.|â€|�/u;

function textFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return textFiles(target);
    return TEXT_EXTENSIONS.has(path.extname(entry.name)) ? [target] : [];
  });
}

test("production sources contain no common UTF-8 mojibake", () => {
  const failures = ROOTS
    .flatMap(textFiles)
    .filter((file) => MOJIBAKE.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(failures, []);
});
