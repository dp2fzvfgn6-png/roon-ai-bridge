import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpContext } from "./mcpContext";
import { registerRoonAppResources } from "./appResources";
import { registerRoonMcpTools } from "./mcpTools";
import { APP_VERSION } from "../config/version";

export function createRoonMcpServer(context: McpContext): McpServer {
  const server = new McpServer(
    {
      name: "roon-ai-bridge",
      version: APP_VERSION
    },
    {
      instructions:
        "For output-level volume, mute or power, call roon_list_outputs first and use the returned output_id. To group zones, call roon_list_zones then roon_group_zones with the queue-owning zone as primary; never emulate grouping with separate playback. To split a group, call roon_ungroup_zone. To move playback without grouping, call roon_transfer_playback exactly once and never rebuild the queue. Only claim playback/grouping success when state_verified=true. For new music, call roon_search_media, then use its result_id with roon_play_media or roon_add_media_to_queue."
    }
  );

  registerRoonAppResources(server);
  registerRoonMcpTools(server, context);

  return server;
}

export async function startMcpServer(context: McpContext): Promise<void> {
  const server = createRoonMcpServer(context);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  context.logger.info("MCP stdio server listening", {
    service: "roon-ai-bridge"
  });
}
