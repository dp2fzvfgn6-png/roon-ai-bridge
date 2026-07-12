const assert = require("node:assert/strict");
const test = require("node:test");

const { roonSdkCall } = require("../dist/roon/roonSdk");

test("Roon SDK adapter resolves successful callbacks", async () => {
  const result = await roonSdkCall(
    "test operation",
    (callback) => callback(false, { ok: true }),
    {},
    { timeoutMs: 20 }
  );
  assert.deepEqual(result, { ok: true });
});

test("Roon SDK adapter times out and ignores a late callback", async () => {
  let callback;
  await assert.rejects(
    () => roonSdkCall(
      "test operation",
      (provided) => { callback = provided; },
      { target: "zone" },
      { timeoutMs: 20 }
    ),
    (error) =>
      error.code === "ROON_REQUEST_TIMEOUT" &&
      error.details.operation === "test operation"
  );
  assert.doesNotThrow(() => callback(false, { too_late: true }));
});
