import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { APP_VERSION } from "../../config/version";
import { BridgeV2Context } from "../context";
import { registerBridgeV2Tools } from "./tools";
import { registerWidgetV2Resources } from "../widgets/resources";
import { registerWidgetV2Tools } from "../widgets/tools";

export function createBridgeV2McpServer(context: BridgeV2Context): McpServer {
  const server = new McpServer(
    { name: "roon-ai-bridge", version: APP_VERSION },
    {
      instructions:
        "For a user-facing request asking what is playing, call roon_show_now_playing and include the requested zone name. Use roon_show_media for visual artist, album, song or search results. Search responses expose best_match plus artist, album, EP, single and track groups; trust best_match unless the user names a different entity. When the user explicitly says artist, album or song, pass that media type. Read-only search followed by entity details is allowed for discography, latest-release or comparison requests. roon_play_media, roon_enqueue_media and roon_start_radio accept either a query or a prior result_id. If status=ambiguous, ask the user to choose. Only claim a mutation succeeded when status=completed; report verified separately."
    }
  );
  registerWidgetV2Resources(server);
  registerBridgeV2Tools(server, context);
  registerWidgetV2Tools(server, context);
  return server;
}

export async function startBridgeV2McpServer(context: BridgeV2Context): Promise<void> {
  const server = createBridgeV2McpServer(context);
  await server.connect(new StdioServerTransport());
  context.logger.info("MCP v2 stdio server listening", { service: "roon-ai-bridge" });
}
