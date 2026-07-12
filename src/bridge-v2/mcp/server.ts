import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { APP_VERSION } from "../../config/version";
import { BridgeV2Context } from "../context";
import { registerBridgeV2Tools } from "./tools";

export function createBridgeV2McpServer(context: BridgeV2Context): McpServer {
  const server = new McpServer(
    { name: "roon-ai-bridge", version: APP_VERSION },
    {
      instructions:
        "Use one intent tool per user request. Zone and output tools accept exact names, so never call roon_get_state only to obtain IDs. roon_play_media, roon_enqueue_media and roon_start_radio accept either a query or a prior result_id and resolve searches internally. If status=ambiguous, ask the user to choose a returned candidate. Only claim a mutation succeeded when status=completed; report verified separately. Use roon_transfer_playback to move the current queue and roon_set_grouping only for synchronized playback."
    }
  );
  registerBridgeV2Tools(server, context);
  return server;
}

export async function startBridgeV2McpServer(context: BridgeV2Context): Promise<void> {
  const server = createBridgeV2McpServer(context);
  await server.connect(new StdioServerTransport());
  context.logger.info("MCP v2 stdio server listening", { service: "roon-ai-bridge" });
}
