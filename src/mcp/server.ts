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
        "To move or transfer what is currently playing between zones, call roon_transfer_playback exactly once; never search for the music or rebuild the destination queue. Call roon_list_zones first when either zone ID is unknown. For new music, call roon_search_media and pass its result_id to roon_play_media or roon_add_media_to_queue. roon_play_media on an artist plays only that artist; roon_start_radio includes similar artists. Be conservative with volume and queue-changing actions."
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
