import crypto from "crypto";
import { registerBridgeV2Tools } from "../bridge-v2/mcp/tools";
import { BridgeV2Context } from "../bridge-v2/context";

function classificationFromAnnotations(annotations: any): Record<string, unknown> {
  const readOnly = annotations?.readOnlyHint === true;
  return {
    read_only: readOnly,
    mutation: !readOnly,
    destructive: annotations?.destructiveHint === true,
    open_world: annotations?.openWorldHint === true
  };
}

function schemaSummary(inputSchema: any): Record<string, unknown> {
  if (!inputSchema) return { type: "object", properties: [] };
  return {
    type: "object",
    properties: Object.keys(inputSchema),
    required: Object.entries(inputSchema)
      .filter(([, value]: any) => value?._def?.typeName && !String(value._def.typeName).includes("Optional"))
      .map(([key]) => key)
  };
}

export function buildToolsManifest(context: BridgeV2Context): Record<string, unknown> {
  const tools: Array<Record<string, unknown>> = [];
  const server = {
    registerTool(name: string, options: any): void {
      const schema = schemaSummary(options.inputSchema);
      const security = classificationFromAnnotations(options.annotations);
      const serialized = JSON.stringify({
        name,
        description: options.description,
        schema
      });
      tools.push({
        name,
        title: options.title || name,
        description: options.description,
        input_schema: schema,
        classification: security,
        security,
        schema_hash: crypto.createHash("sha256").update(serialized).digest("hex").slice(0, 16),
        widget_uri: options._meta?.ui?.resourceUri || options._meta?.["openai/outputTemplate"] || null
      });
    }
  };
  registerBridgeV2Tools(server as any, { ...context, manifestMode: true });
  for (const tool of tools) {
    tool.enabled = context.toolAccessService?.isGloballyEnabled(String(tool.name)) !== false;
  }
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    tools_count: tools.length,
    enabled_tools_count: tools.filter((tool) => tool.enabled).length,
    tools
  };
}
