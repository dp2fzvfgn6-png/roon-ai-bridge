import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BridgeV2Context } from "../context";
import { failed, TargetReference } from "../contracts";
import { WIDGET_V2_URIS } from "./resources";
import { WidgetPayload, WidgetV2ViewService } from "./viewService";

const targetSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional()
}).refine((value) => Boolean(value.id || value.name), "id or name is required");
const mediaType = z.enum(["track", "album", "artist", "playlist"]);
const sourcePreference = z.enum(["highest_quality", "streaming_first", "library_first"]);
const viewSchema = z.enum(["player", "search", "artist", "album", "track", "queue", "playlists", "playlist"]);

function descriptorMeta(resourceUri: string, visibility: Array<"model" | "app">): Record<string, unknown> {
  return {
    ui: { resourceUri, visibility },
    "openai/outputTemplate": resourceUri,
    "openai/toolInvocation/invoking": "Opening RoonIA…",
    "openai/toolInvocation/invoked": "RoonIA is ready."
  };
}

function defaultZone(context: BridgeV2Context, requested?: TargetReference): TargetReference | undefined {
  if (requested) return requested;
  const zone = context.roonClient.getZones().find((item) => item.state === "playing") || context.roonClient.getZones()[0];
  return zone ? { id: zone.zone_id } : undefined;
}

function renderResult(operation: string, widget: WidgetPayload) {
  return {
    structuredContent: {
      status: "completed",
      operation,
      summary: `Opened RoonIA ${widget.view} view.`,
      view: widget.view,
      generated_at: widget.generated_at
    },
    content: [{ type: "text" as const, text: `Opened RoonIA ${widget.view} view.` }],
    _meta: { widget }
  };
}

export function registerWidgetV2Tools(server: McpServer, context: BridgeV2Context): void {
  const views = new WidgetV2ViewService(context);
  const allowed = (name: string): boolean =>
    context.manifestMode ||
    !context.toolAccessService ||
    context.toolAccessService.canUse(name, context.activeApiKey);

  if (allowed("roon_open_player")) {
    server.registerTool("roon_open_player", {
      title: "Open RoonIA Player",
      description: "Use this when the user wants an interactive now-playing view with live zone, queue, transport and safe volume controls.",
      inputSchema: { zone: targetSchema.optional() },
      outputSchema: {
        status: z.literal("completed"), operation: z.string(), summary: z.string(),
        view: z.literal("player"), generated_at: z.string()
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: descriptorMeta(WIDGET_V2_URIS.player, ["model", "app"])
    } as any, async ({ zone }: any) => {
      try { return renderResult("roon_open_player", await views.player({ zone })); }
      catch (error) {
        const result = failed("roon_open_player", error);
        return { structuredContent: result as any, content: [{ type: "text" as const, text: result.summary }], isError: true };
      }
    });
  }

  if (allowed("roon_open_media_explorer")) {
    server.registerTool("roon_open_media_explorer", {
      title: "Open RoonIA Media Explorer",
      description: "Use this when the user wants visual, navigable search results for artists, albums, tracks or playlists with artwork and playback actions.",
      inputSchema: {
        query: z.string().min(1),
        types: z.array(mediaType).optional(),
        zone: targetSchema.optional(),
        count: z.number().int().min(1).max(25).default(20),
        source_preference: sourcePreference.default("highest_quality")
      },
      outputSchema: {
        status: z.literal("completed"), operation: z.string(), summary: z.string(),
        view: z.literal("search"), generated_at: z.string()
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: descriptorMeta(WIDGET_V2_URIS.media, ["model", "app"])
    } as any, async (input: any) => {
      try { return renderResult("roon_open_media_explorer", await views.search(input)); }
      catch (error) {
        const result = failed("roon_open_media_explorer", error);
        return { structuredContent: result as any, content: [{ type: "text" as const, text: result.summary }], isError: true };
      }
    });
  }

  if (allowed("roon_open_library")) {
    server.registerTool("roon_open_library", {
      title: "Open RoonIA Library",
      description: "Use this when the user wants an interactive queue or virtual-playlist library. Use the playlist_id input to open one playlist directly.",
      inputSchema: {
        view: z.enum(["queue", "playlists"]).default("playlists"),
        zone: targetSchema.optional(),
        playlist_id: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional()
      },
      outputSchema: {
        status: z.literal("completed"), operation: z.string(), summary: z.string(),
        view: z.enum(["queue", "playlists", "playlist"]), generated_at: z.string()
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: descriptorMeta(WIDGET_V2_URIS.library, ["model", "app"])
    } as any, async (input: any) => {
      try {
        const widget = input.playlist_id
          ? views.playlist(input)
          : input.view === "queue"
            ? await views.queue({ ...input, zone: defaultZone(context, input.zone) })
            : views.playlists(input);
        return renderResult("roon_open_library", widget);
      } catch (error) {
        const result = failed("roon_open_library", error);
        return { structuredContent: result as any, content: [{ type: "text" as const, text: result.summary }], isError: true };
      }
    });
  }

  if (allowed("roon_ui_navigate")) {
    server.registerTool("roon_ui_navigate", {
      title: "Navigate RoonIA Widget",
      description: "Use this when a RoonIA widget needs internal navigation or refreshed view data. This is app-only; models must use a roon_open_* tool instead.",
      inputSchema: {
        view: viewSchema,
        zone: targetSchema.optional(),
        query: z.string().optional(),
        types: z.array(mediaType).optional(),
        result_id: z.string().optional(),
        playlist_id: z.string().optional(),
        count: z.number().int().min(1).max(100).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        source_preference: sourcePreference.optional()
      },
      outputSchema: {
        status: z.literal("completed"),
        view: viewSchema,
        widget: z.record(z.string(), z.unknown())
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } }
    } as any, async (input: any) => {
      try {
        const effective = input.view === "queue"
          ? { ...input, zone: defaultZone(context, input.zone) }
          : input;
        const widget = await views.navigate(effective);
        return {
          structuredContent: { status: "completed", view: widget.view, widget },
          content: []
        };
      } catch (error) {
        const result = failed("roon_ui_navigate", error);
        return { structuredContent: result as any, content: [], isError: true };
      }
    });
  }
}
