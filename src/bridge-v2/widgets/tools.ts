import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BridgeV2Context } from "../context";
import { failed } from "../contracts";
import { WIDGET_V2_URIS } from "./resources";
import { WidgetPayload, WidgetV2ViewService } from "./viewService";
import { embedWidgetArtwork } from "./artwork";

const referenceSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional()
}).refine((value) => Boolean(value.id || value.name), "id or name is required");
const mediaType = z.enum(["track", "album", "artist", "playlist"]);
const sourcePreference = z.enum(["highest_quality", "streaming_first", "library_first"]);

function descriptorMeta(resourceUri: string): Record<string, unknown> {
  return {
    ui: { resourceUri, visibility: ["model", "app"] },
    "openai/outputTemplate": resourceUri,
    "openai/toolInvocation/invoking": "Preparando la vista…",
    "openai/toolInvocation/invoked": "Vista preparada."
  };
}

async function renderResult(operation: string, widget: WidgetPayload, context: BridgeV2Context) {
  const hydratedWidget = await embedWidgetArtwork(context, widget);
  const summary = widget.view === "now_playing"
    ? `${Array.isArray(widget.zones) ? widget.zones.length : 0} zona(s) reproduciendo.`
    : widget.view === "zones"
      ? `${Array.isArray(widget.zones) ? widget.zones.length : 0} zona(s) en el panel.`
      : widget.view === "queue"
        ? `${Array.isArray(widget.items) ? widget.items.length : 0} elemento(s) en la cola.`
        : widget.view === "playlist_library"
          ? `${Array.isArray(widget.playlists) ? widget.playlists.length : 0} playlist(s) en la biblioteca.`
          : `Mostrando ${widget.title}.`;
  return {
    structuredContent: {
      status: "completed",
      operation,
      summary,
      view: widget.view,
      generated_at: widget.generated_at
    },
    content: [{ type: "text" as const, text: summary }],
    _meta: { widget: hydratedWidget }
  };
}

function errorResult(operation: string, error: unknown) {
  const result = failed(operation, error);
  return {
    structuredContent: result as any,
    content: [{ type: "text" as const, text: result.summary }],
    isError: true
  };
}

export function registerWidgetV2Tools(server: McpServer, context: BridgeV2Context): void {
  const views = new WidgetV2ViewService(context);
  const allowed = (name: string): boolean =>
    context.manifestMode ||
    !context.toolAccessService ||
    context.toolAccessService.canUse(name, context.activeApiKey);

  if (allowed("roon_show_now_playing")) {
    server.registerTool("roon_show_now_playing", {
      title: "Show Now Playing",
      description: "Use this when the user asks what is playing or what is playing in one named zone. It displays only zones actively playing media, with artwork, song, artist, album and every grouped output volume. Do not use roon_get_state for a user-facing now-playing request.",
      inputSchema: { zone: referenceSchema.optional() },
      outputSchema: {
        status: z.literal("completed"), operation: z.string(), summary: z.string(),
        view: z.literal("now_playing"), generated_at: z.string()
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: descriptorMeta(WIDGET_V2_URIS.nowPlaying)
    } as any, async ({ zone }: any) => {
      try { return await renderResult("roon_show_now_playing", views.nowPlaying({ zone }), context); }
      catch (error) { return errorResult("roon_show_now_playing", error); }
    });
  }

  if (allowed("roon_show_zones")) {
    server.registerTool("roon_show_zones", {
      title: "Show Roon Zones",
      description: "Use this when the user wants a visual overview of every Roon zone, its playback state, grouped outputs, current media, volume, mute state, safe limit and playback options. Do not use it to change playback, volume or grouping.",
      inputSchema: {},
      outputSchema: {
        status: z.literal("completed"), operation: z.string(), summary: z.string(),
        view: z.literal("zones"), generated_at: z.string()
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: descriptorMeta(WIDGET_V2_URIS.zones)
    } as any, async () => {
      try { return await renderResult("roon_show_zones", views.zones(), context); }
      catch (error) { return errorResult("roon_show_zones", error); }
    });
  }

  if (allowed("roon_show_queue")) {
    server.registerTool("roon_show_queue", {
      title: "Show Roon Queue",
      description: "Use this when the user wants to see what is coming next in one named Roon zone. It displays the current zone context and a bounded queue snapshot; it never skips, removes, reorders or starts an item.",
      inputSchema: {
        zone: referenceSchema,
        count: z.number().int().min(1).max(100).default(30)
      },
      outputSchema: {
        status: z.literal("completed"), operation: z.string(), summary: z.string(),
        view: z.literal("queue"), generated_at: z.string()
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: descriptorMeta(WIDGET_V2_URIS.queue)
    } as any, async (input: any) => {
      try { return await renderResult("roon_show_queue", await views.queue(input), context); }
      catch (error) { return errorResult("roon_show_queue", error); }
    });
  }

  if (allowed("roon_show_media")) {
    server.registerTool("roon_show_media", {
      title: "Show Music Information",
      description: "Use this when the user wants visual information about an artist, album, song or a set of search results. Pass query for a new search, with one explicit type when the user named it, or result_id from a prior search. An unambiguous typed match expands in this single call; omit types for categorized search results. This tool only displays information and never plays media.",
      inputSchema: {
        query: z.string().min(1).optional(),
        result_id: z.string().min(1).optional(),
        types: z.array(mediaType).optional(),
        count: z.number().int().min(1).max(100).default(24),
        source_preference: sourcePreference.default("highest_quality")
      },
      outputSchema: {
        status: z.literal("completed"), operation: z.string(), summary: z.string(),
        view: z.enum(["search_results", "artist", "album", "track"]), generated_at: z.string()
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: descriptorMeta(WIDGET_V2_URIS.media)
    } as any, async (input: any) => {
      try { return await renderResult("roon_show_media", await views.media(input), context); }
      catch (error) { return errorResult("roon_show_media", error); }
    });
  }

  if (allowed("roon_show_playlist")) {
    server.registerTool("roon_show_playlist", {
      title: "Show Virtual Playlist",
      description: "Use this when the user wants to see one RoonIA virtual playlist by exact name or ID. It displays the playlist artwork, name, description and its songs with individual artwork; it never edits or starts the playlist.",
      inputSchema: {
        playlist: referenceSchema,
        limit: z.number().int().min(1).max(150).default(50),
        offset: z.number().int().min(0).default(0)
      },
      outputSchema: {
        status: z.literal("completed"), operation: z.string(), summary: z.string(),
        view: z.literal("playlist"), generated_at: z.string()
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: descriptorMeta(WIDGET_V2_URIS.playlist)
    } as any, async (input: any) => {
      try { return await renderResult("roon_show_playlist", views.playlist(input), context); }
      catch (error) { return errorResult("roon_show_playlist", error); }
    });
  }

  if (allowed("roon_show_playlist_library")) {
    server.registerTool("roon_show_playlist_library", {
      title: "Show Playlist Library",
      description: "Use this when the user wants to browse or see an overview of saved RoonIA virtual playlists. It displays covers, descriptions, track counts, known duration and recent playback; use roon_show_playlist for one exact playlist.",
      inputSchema: {
        limit: z.number().int().min(1).max(60).default(24),
        offset: z.number().int().min(0).default(0)
      },
      outputSchema: {
        status: z.literal("completed"), operation: z.string(), summary: z.string(),
        view: z.literal("playlist_library"), generated_at: z.string()
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: descriptorMeta(WIDGET_V2_URIS.playlistLibrary)
    } as any, async (input: any) => {
      try { return await renderResult("roon_show_playlist_library", views.playlistLibrary(input), context); }
      catch (error) { return errorResult("roon_show_playlist_library", error); }
    });
  }
}
