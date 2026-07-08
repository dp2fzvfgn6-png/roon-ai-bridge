const assert = require("node:assert/strict");
const test = require("node:test");

const { registerRoonMcpTools } = require("../dist/mcp/mcpTools");

test("registers tool-specific descriptions instead of reusing roon_status copy", () => {
  const tools = new Map();
  const server = {
    registerTool(name, options, handler) {
      tools.set(name, { options, handler });
    }
  };
  const noop = () => {};
  const context = {
    logger: { info: noop, warn: noop, error: noop, debug: noop }
  };

  registerRoonMcpTools(server, context);

  const statusDescription = tools.get("roon_status").options.description;
  assert.equal(statusDescription, "Return Roon Core connection status and service readiness.");

  for (const [name, registration] of tools.entries()) {
    assert.ok(registration.options.description, `${name} should have a description`);
    if (name !== "roon_status") {
      assert.notEqual(
        registration.options.description,
        statusDescription,
        `${name} must not reuse roon_status description`
      );
    }
  }

  assert.match(tools.get("roon_search_media").options.description, /result_id/);
  assert.match(tools.get("roon_get_queue").options.description, /queue/i);
  assert.match(tools.get("roon_change_volume").options.description, /volume/i);
  assert.match(tools.get("roon_get_virtual_playlist").options.description, /paginated tracks/i);
});
