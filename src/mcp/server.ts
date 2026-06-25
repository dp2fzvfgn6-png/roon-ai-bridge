import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpContext } from "./mcpContext";
import { registerRoonMcpTools } from "./mcpTools";

export async function startMcpServer(context: McpContext): Promise<void> {
  const server = new McpServer({
    name: "roon-ai-bridge",
    version: "0.6.0"
  });

  registerRoonMcpTools(server, context);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  context.logger.info("MCP stdio server listening", {
    service: "roon-ai-bridge"
  });
}
