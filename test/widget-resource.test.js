const test = require("node:test");
const assert = require("node:assert/strict");
const {
  registerWidgetV2Resources,
  WIDGET_V2_URIS
} = require("../dist/bridge-v2/widgets/resources");

test("serves three focused v12 MCP Apps widget resources", async () => {
  const resources = new Map();
  const server = {
    registerResource(name, uri, options, handler) {
      resources.set(uri, { name, options, handler });
    }
  };

  registerWidgetV2Resources(server);
  assert.deepEqual([...resources.keys()].sort(), Object.values(WIDGET_V2_URIS).sort());

  for (const uri of Object.values(WIDGET_V2_URIS)) {
    const response = await resources.get(uri).handler();
    const resource = response.contents[0];
    assert.equal(resource.uri, uri);
    assert.equal(resource.mimeType, "text/html;profile=mcp-app");
    assert.match(resource.text, /window\.openai\?\.toolInput/);
    assert.match(resource.text, /ui\/notifications\/tool-input/);
    assert.match(resource.text, /ui\/notifications\/tool-result/);
    assert.match(resource.text, /ui\/update-model-context/);
    assert.match(resource.text, /roon_ui_navigate/);
    assert.match(resource.text, /roon_ui_action/);
    assert.match(resource.text, /setWidgetState/);
    assert.match(resource.text, /Explorador musical/);
    assert.match(resource.text, /Resultados para/);
    assert.match(resource.text, /M8 5h3v14H8zM14 5h3v14h-3z/);
    assert.match(resource.text, /data-open-playlist/);
    assert.match(resource.text, /setInterval\(tick,250\)/);
    assert.match(resource.text, /function patchPlayer/);
    assert.doesNotMatch(resource.text, /content\.innerHTML\s*=\s*['"]<div class=['"]loading/);
    assert.doesNotMatch(resource.text, /image_data_url/);
    assert.deepEqual(resource._meta.ui.csp.resourceDomains, ["https://roonia.ipchome.com"]);
    assert.equal(resource._meta["openai/widgetDomain"], "https://roonia.ipchome.com");
  }
});
