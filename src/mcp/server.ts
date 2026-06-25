import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpContext } from "./mcpContext";
import { registerRoonAppResources } from "./appResources";
import { registerRoonMcpTools } from "./mcpTools";

export function createRoonMcpServer(context: McpContext): McpServer {
  const server = new McpServer(
    {
      name: "roon-ai-bridge",
      version: "0.8.0"
    },
    {
      instructions:
        "Use Roon AI Bridge to control the user's private Roon system. Always list zones or confirm the target zone when ambiguous. Be conservative with volume and queue-changing actions."
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
