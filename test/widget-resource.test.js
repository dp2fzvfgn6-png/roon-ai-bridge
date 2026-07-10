const test = require("node:test");
const assert = require("node:assert/strict");
const {
  registerRoonAppResources,
  roonControlWidgetUri,
  roonControlWidgetUriForTool
} = require("../dist/mcp/appResources");

test("serves widget v8 with artwork, identity status and initial ChatGPT tool output hydration", async () => {
  let resourceHandler;
  const server = {
    registerResource(name, uri, options, handler) {
      if (name === "roon-control-widget") {
        assert.equal(uri, "ui://roon-ai-bridge/control-v8/default.html");
        resourceHandler = handler;
      }
    }
  };

  registerRoonAppResources(server);
  const response = await resourceHandler();
  const resource = response.contents[0];

  assert.equal(roonControlWidgetUri, "ui://roon-ai-bridge/control-v8/default.html");
  assert.equal(
    roonControlWidgetUriForTool("roon_get_virtual_playlist"),
    "ui://roon-ai-bridge/control-v8/roon_get_virtual_playlist.html"
  );
  assert.equal(resource.mimeType, "text/html;profile=mcp-app");
  assert.match(resource.text, /applyGlobals\(window\.openai\)/);
  assert.match(resource.text, /openai:set_globals/);
  assert.match(resource.text, /ui\/notifications\/tool-result/);
  assert.match(resource.text, /image_data_url/);
  assert.match(resource.text, /image_url/);
});
