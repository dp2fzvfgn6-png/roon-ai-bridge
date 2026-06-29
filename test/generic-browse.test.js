const assert = require("node:assert/strict");
const test = require("node:test");

const { runBrowseAction } = require("../dist/roon/roonBrowseService");

function clientFor(response, loadResponse) {
  const browse = {
    browse(opts, callback) {
      callback(false, typeof response === "function" ? response(opts) : response);
    },
    load(_opts, callback) {
      callback(false, loadResponse || { items: [], offset: 0, list: null });
    }
  };
  return {
    isCoreConnected: () => true,
    isBrowseReady: () => true,
    getBrowse: () => browse
  };
}

test("passes generic input_prompt values and preserves replace/remove effects", async () => {
  let received;
  const replaceClient = clientFor((opts) => {
    received = opts;
    return {
      action: "replace_item",
      item: { title: "Replacement", item_key: "new-key" }
    };
  });
  const replaced = await runBrowseAction(replaceClient, {
    hierarchy: "settings",
    itemKey: "prompt-key",
    sessionKey: "session",
    input: "typed value"
  });
  assert.equal(received.input, "typed value");
  assert.equal(replaced.action, "replace_item");
  assert.equal(replaced.item.title, "Replacement");

  const removed = await runBrowseAction(
    clientFor({ action: "remove_item" }),
    { hierarchy: "browse", itemKey: "remove-key" }
  );
  assert.equal(removed.action, "remove_item");
});
