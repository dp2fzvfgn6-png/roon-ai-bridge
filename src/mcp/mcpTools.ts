import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  playByQuery,
  queueByQuery,
  runBrowseAction,
  searchRoon
} from "../roon/roonBrowseService";
import { controlPlayback } from "../roon/roonPlaybackService";
import { getQueueSnapshot, playQueueItemFromHere } from "../roon/roonQueueService";
import { listZones } from "../roon/roonZoneService";
import { changeZoneVolume } from "../roon/roonVolumeService";
import { transferZonePlayback } from "../roon/roonTransferService";
import { groupZones, ungroupZone } from "../roon/roonGroupingService";
import { ApiError } from "../utils/errors";
import { parsePlaybackCommand, parseVolumeMode, parseVolumeValue } from "../utils/validation";
import { roonControlWidgetUriForTool } from "./appResources";
import { McpContext } from "./mcpContext";
import {
  changeZoneSettings,
  changeOutputVolume,
  listOutputs,
  muteAll,
  muteOutput,
  outputPowerAction,
  pauseAll,
  restartQueuePlayback,
  seekZone
} from "../roon/roonAdvancedTransportService";
import { getRoonImage } from "../roon/roonImageService";
import { WidgetService } from "../services/widgetService";
import type { MediaType } from "../roon/roonMediaService";
import {
  confirmationRequiredResponse,
  dryRunResponse,
  getToolClassification,
  mutationSuccess
} from "../safety/actionSafety";

type ToolResult = {
  structuredContent: Record<string, unknown>;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function jsonToolResult(value: unknown, isError = false): ToolResult {
  return {
    structuredContent: { result: value },
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    isError
  };
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof ApiError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    };
  }

  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
      details: {}
    }
  };
}

async function runTool<T>(
  context: McpContext,
  name: string,
  fn: () => Promise<T> | T
): Promise<ToolResult> {
  try {
    context.logger.info("MCP tool called", { tool: name });
    return jsonToolResult(await fn());
  } catch (error) {
    const payload = errorPayload(error);
    context.logger.warn("MCP tool failed", { tool: name, payload });
    return jsonToolResult(payload, true);
  }
}

async function imageDataUrl(
  context: McpContext,
  imageKey: unknown
): Promise<string | null> {
  if (typeof imageKey !== "string" || !imageKey || !context.roonClient.isImageReady()) {
    return null;
  }
  try {
    const image = await getRoonImage(context.roonClient, imageKey, {
      width: 240,
      height: 240,
      scale: "fill",
      format: "image/jpeg"
    });
    return `data:${image.contentType};base64,${image.bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function statusPayload(context: McpContext): Record<string, unknown> {
  return {
    core_connected: context.roonClient.isCoreConnected(),
    core_name: context.roonClient.getCoreName(),
    transport_ready: context.roonClient.isTransportReady(),
    browse_ready: context.roonClient.isBrowseReady(),
    image_ready: context.roonClient.isImageReady(),
    zones_count: context.roonClient.getZones().length,
    outputs_count: context.roonClient.getOutputs().length
  };
}

function createWidgetService(context: McpContext): WidgetService {
  return new WidgetService({
    roonClient: context.roonClient,
    playlistService: context.playlistService,
    mediaService: context.mediaService,
    volumeLimitService: context.volumeLimitService,
    publicBaseUrl: context.config.publicBaseUrl
  });
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  openWorldHint: false
};

const writeAnnotations = {
  readOnlyHint: false,
  openWorldHint: false,
  destructiveHint: false
};

const destructiveAnnotations = {
  readOnlyHint: false,
  openWorldHint: false,
  destructiveHint: true
};

const structuredOutputSchema = {
  outputSchema: {
    result: z.unknown()
  }
};

const widgetMeta = Symbol("model-and-app-widget");
const legacyWidgetMeta = Symbol("app-only-widget");

function widgetMetaForTool(
  toolName: string,
  visibility: Array<"model" | "app">
): Record<string, unknown> {
  const resourceUri = roonControlWidgetUriForTool(toolName);
  return {
    ui: {
      resourceUri,
      visibility
    },
    "openai/outputTemplate": resourceUri
  };
}

const playlistTrackMetadataSchema = z
  .object({})
  .catchall(z.unknown());

const dryRunSchema = z.boolean().optional();
const confirmSchema = z.boolean().optional();
const targetRefSchema = z.object({
  type: z.enum(["output_id", "zone_id", "output_name", "zone_name", "global"]),
  value: z.string().min(1)
});
const presetTargetRefSchema = z.object({
  type: z.enum(["output_id", "zone_id", "output_name", "zone_name"]),
  value: z.string().min(1)
});
const scheduleSchema = z.object({
  timezone: z.string().min(1),
  days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).min(1),
  from: z.string().regex(/^\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{2}:\d{2}$/)
}).nullable().optional();
const zonePresetInputSchema = {
  preset_id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  virtual_zone: z.object({
    enabled: z.boolean().optional(),
    display_name: z.string().optional(),
    show_in_portal: z.boolean().optional(),
    show_in_roon_if_supported: z.boolean().optional()
  }).optional(),
  grouping: z.object({
    enabled: z.boolean().optional(),
    primary_zone_ref: presetTargetRefSchema.nullable().optional(),
    members: z.array(presetTargetRefSchema).optional()
  }).optional(),
  volumes: z.array(z.object({
    target_ref: presetTargetRefSchema,
    volume: z.number()
  })).optional(),
  playback: z.object({
    action: z.enum(["keep_current", "pause"]).default("keep_current")
  }).optional(),
  queue: z.object({
    action: z.enum(["keep_current"]).default("keep_current")
  }).optional(),
  portal_metadata: z.object({}).catchall(z.unknown()).optional()
};

const playlistTrackInputSchema = z.object({
  track_id: z.string().optional(),
  query: z.string().min(1).optional(),
  roon_item_key: z.string().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  position: z.number().int().min(1).optional(),
  metadata: playlistTrackMetadataSchema.optional(),
  audio_metadata: playlistTrackMetadataSchema.optional(),
  user_metadata: playlistTrackMetadataSchema.optional(),
  resolution: playlistTrackMetadataSchema.optional(),
  image_key: z.string().optional(),
  duration_seconds: z.number().optional(),
  track_number: z.number().int().optional(),
  disc_number: z.number().int().optional(),
  release_year: z.number().int().optional(),
  album_artist: z.string().optional(),
  composer: z.string().optional(),
  genre: z.union([z.string(), z.array(z.string())]).optional(),
  source: z.string().optional(),
  quality: z.unknown().optional(),
  cover: z
    .object({
      image_key: z.string()
    })
    .optional()
});

const playlistTrackWritableShape = {
  query: z.string().min(1).optional(),
  roon_item_key: z.string().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  position: z.number().int().min(1).optional(),
  metadata: playlistTrackMetadataSchema.optional(),
  audio_metadata: playlistTrackMetadataSchema.optional(),
  user_metadata: playlistTrackMetadataSchema.optional(),
  resolution: playlistTrackMetadataSchema.optional(),
  image_key: z.string().optional(),
  duration_seconds: z.number().optional(),
  track_number: z.number().int().optional(),
  disc_number: z.number().int().optional(),
  release_year: z.number().int().optional(),
  album_artist: z.string().optional(),
  composer: z.string().optional(),
  genre: z.union([z.string(), z.array(z.string())]).optional(),
  source: z.string().optional(),
  quality: z.unknown().optional(),
  cover: z
    .object({
      image_key: z.string()
    })
    .optional()
};

const mediaTypeSchema = z.enum(["track", "album", "artist", "playlist"]);
const mediaTypesInputSchema = z
  .union([z.array(mediaTypeSchema), mediaTypeSchema])
  .optional();

function normalizeMediaTypesInput(value: unknown): MediaType[] | undefined {
  if (Array.isArray(value)) return value as MediaType[];
  if (typeof value === "string" && value.trim() !== "") return [value as MediaType];
  return undefined;
}

export function registerRoonMcpTools(server: McpServer, context: McpContext): void {
  const registerTool = (name: string, options: any, handler: any): void => {
    const visibility = options._meta === legacyWidgetMeta
      ? ["app" as const]
      : ["model" as const, "app" as const];
    server.registerTool(name, {
      ...options,
      _meta: widgetMetaForTool(name, visibility)
    }, handler);
  };

  registerTool(
    "roon_status",
    {
      title: "Roon Status",
      description: "Return Roon Core connection status and service readiness.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta
    },
    async () => runTool(context, "roon_status", () => statusPayload(context))
  );

  registerTool(
    "roon_get_now_playing_widget",
    {
      title: "Get Now Playing Widget",
      description:
        "Use this when the user asks what is playing, zone status, or wants a reusable now-playing widget contract for ChatGPT or the portal.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        selected_zone_id: z.string().optional()
      }
    },
    async ({ selected_zone_id }) =>
      runTool(context, "roon_get_now_playing_widget", () =>
        createWidgetService(context).getNowPlaying({ selected_zone_id })
      )
  );

  registerTool(
    "roon_now_playing_widget_action",
    {
      title: "Run Now Playing Widget Action",
      description:
        "Use this when a ChatGPT or portal now-playing widget button requests playback, safe volume, mute, zone selection or refresh.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        action: z.enum(["play_pause", "previous", "next", "volume_down", "volume_up", "mute_toggle", "select_zone", "refresh"]),
        zone_id: z.string().min(1),
        confirm: confirmSchema
      }
    },
    async (input) =>
      runTool(context, "roon_now_playing_widget_action", () =>
        createWidgetService(context).nowPlayingAction(input)
      )
  );

  registerTool(
    "roon_get_playlists_widget",
    {
      title: "Get Playlists Widget",
      description:
        "Use this when the user wants a navigable virtual playlists widget list. Do not use it to start playback.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0)
      }
    },
    async ({ limit, offset }) =>
      runTool(context, "roon_get_playlists_widget", () =>
        createWidgetService(context).getPlaylists({ limit, offset })
      )
  );

  registerTool(
    "roon_get_playlist_detail_widget",
    {
      title: "Get Playlist Detail Widget",
      description:
        "Use this when the user opens one virtual playlist widget detail or when a newly created playlist should be shown. It paginates tracks.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
        widget_type: z.enum(["virtual_playlists", "playlist_created"]).optional()
      }
    },
    async (input) =>
      runTool(context, "roon_get_playlist_detail_widget", () =>
        createWidgetService(context).getPlaylistDetail(input)
      )
  );

  registerTool(
    "roon_playlist_widget_action",
    {
      title: "Run Playlist Widget Action",
      description:
        "Use this when a playlist widget button requests opening, playing, queueing, refreshing, or track playback. Do not delete playlists from widgets.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        action: z.enum(["open_playlist", "play_playlist", "add_playlist_to_queue", "play_track", "add_track_to_queue", "refresh"]),
        playlist_id: z.string().min(1),
        track_id: z.string().optional(),
        zone_id: z.string().optional()
      }
    },
    async (input) =>
      runTool(context, "roon_playlist_widget_action", () =>
        createWidgetService(context).playlistAction(input)
      )
  );

  registerTool(
    "roon_get_media_search_widget",
    {
      title: "Get Media Search Widget",
      description:
        "Use this when the user wants navigable music search results for tracks, albums, artists or playlists. Do not play automatically.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        query: z.string().min(1),
        types: mediaTypesInputSchema,
        zone_id: z.string().optional(),
        count: z.number().int().min(1).max(25).default(10),
        source_preference: z.enum(["highest_quality", "streaming_first", "library_first"]).default("highest_quality")
      }
    },
    async ({ query, types, zone_id, count, source_preference }) =>
      runTool(context, "roon_get_media_search_widget", () =>
        createWidgetService(context).getMediaSearch({
          query,
          types: normalizeMediaTypesInput(types),
          zone_id,
          count,
          source_preference
        })
      )
  );

  registerTool(
    "roon_media_search_widget_action",
    {
      title: "Run Media Search Widget Action",
      description:
        "Use this when a media search widget button requests play, queue, open album, open artist, artist radio or expanded search.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        action: z.enum(["play", "add_to_queue", "open_album", "open_artist", "open_entity", "play_album", "add_album_to_queue", "play_artist", "start_artist_radio", "expand_search"]),
        result_id: z.string().optional(),
        zone_id: z.string().optional(),
        query: z.string().optional(),
        types: mediaTypesInputSchema,
        strategy: z.enum(["broaden", "remove_context", "artist_only", "title_only", "fuzzy", "all"]).optional()
      }
    },
    async ({ types, ...input }: any) =>
      runTool(context, "roon_media_search_widget_action", () =>
        createWidgetService(context).mediaSearchAction({
          ...input,
          types: normalizeMediaTypesInput(types)
        })
      )
  );

  registerTool(
    "roon_open_media_entity_widget",
    {
      title: "Open Media Entity Widget",
      description:
        "Use this when the user opens an album, artist, track or playlist entity from a widget result_id.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        result_id: z.string().min(1)
      }
    },
    async ({ result_id }) =>
      runTool(context, "roon_open_media_entity_widget", () =>
        createWidgetService(context).getMediaEntity({ result_id })
      )
  );

  registerTool(
    "roon_get_image_url",
    {
      title: "Get Roon Image URL",
      description:
        "Use this when a Roon image_key should be rendered by URL instead of embedding base64 in widget structuredContent.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        image_key: z.string().min(1)
      }
    },
    async ({ image_key }) =>
      runTool(context, "roon_get_image_url", () => ({
        image_key,
        image_url: `${context.config.publicBaseUrl?.replace(/\/+$/, "") || ""}/roon/images/${encodeURIComponent(image_key)}`
      }))
  );

  registerTool(
    "roon_list_zones",
    {
      title: "List Roon Zones",
      description: "List available Roon zones, now playing metadata and outputs.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        include_image_data: z.boolean().default(false)
      }
    },
    async ({ include_image_data }) =>
      runTool(context, "roon_list_zones", async () =>
        include_image_data
          ? Promise.all(
              listZones(context.roonClient).map(async (zone) => ({
                ...zone,
                now_playing: {
                  ...zone.now_playing,
                  image_data_url: await imageDataUrl(
                    context,
                    zone.now_playing.image_key
                  )
                }
              }))
            )
          : listZones(context.roonClient)
      )
  );

  registerTool(
    "roon_control_playback",
    {
      title: "Control Roon Playback",
      description:
        "Use this when the user asks to play, resume, pause, stop, skip or go back in an existing Roon zone queue. For play, pause, playpause and stop, only report success when state_verified is true.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        zone_id: z.string().min(1),
        command: z.enum(["play", "pause", "playpause", "stop", "next", "previous"]),
        dry_run: dryRunSchema
      }
    },
    async ({ zone_id, command, dry_run }) =>
      runTool(context, "roon_control_playback", async () => {
        const parsed = parsePlaybackCommand(command);
        context.logger.info("MCP playback arguments", {
          zoneId: zone_id,
          command: parsed
        });
        if (dry_run) {
          const before = context.roonClient.getZone(zone_id) || { zone_id };
          return dryRunResponse("roon_control_playback", {
            before,
            after: {
              zone_id,
              command: parsed,
              state: parsed === "pause" ? "paused" : parsed === "play" ? "playing" : "unknown"
            }
          }, {
            before,
            warnings: parsed === "next" || parsed === "previous"
              ? ["Queue position after this playback command is best-effort only."]
              : []
          });
        }
        const before = context.roonClient.getZone(zone_id) || null;
        const result = await controlPlayback(context.roonClient, zone_id, parsed);
        return mutationSuccess("roon_control_playback", result, {
          before,
          after: result
        });
      })
  );

  registerTool(
    "roon_change_volume",
    {
      title: "Change Roon Volume",
      description: "Change Roon zone volume using relative or absolute mode when supported.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        zone_id: z.string().min(1),
        mode: z.enum(["relative", "absolute", "relative_step"]),
        value: z.number(),
        dry_run: dryRunSchema,
        confirm: confirmSchema
      }
    },
    async ({ zone_id, mode, value, dry_run, confirm }) =>
      runTool(context, "roon_change_volume", async () => {
        const parsedMode = parseVolumeMode(mode);
        const parsedValue = parseVolumeValue(value);
        return changeZoneVolume(context.roonClient, zone_id, parsedMode, parsedValue, {
          dryRun: Boolean(dry_run),
          confirm: Boolean(confirm)
        });
      })
  );

  registerTool(
    "roon_list_volume_limits",
    {
      title: "List Volume Limits",
      description: "Use this when the user wants to see configured safe volume limits and scheduled limits.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta
    },
    async () => runTool(context, "roon_list_volume_limits", () => context.volumeLimitService.list())
  );

  registerTool(
    "roon_get_volume_limit",
    {
      title: "Get Volume Limit",
      description: "Use this when the user wants the full configuration for one safe volume limit.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: { limit_id: z.string().min(1) }
    },
    async ({ limit_id }) => runTool(context, "roon_get_volume_limit", () => context.volumeLimitService.get(limit_id))
  );

  registerTool(
    "roon_create_volume_limit",
    {
      title: "Create Volume Limit",
      description: "Use this when the user wants to add a safe volume limit for a zone, output or schedule.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        limit_id: z.string().optional(),
        target_ref: targetRefSchema,
        name: z.string().min(1),
        safe_max: z.number().positive(),
        schedule: scheduleSchema,
        enabled: z.boolean().optional()
      }
    },
    async (input) => runTool(context, "roon_create_volume_limit", () => context.volumeLimitService.create(input))
  );

  registerTool(
    "roon_update_volume_limit",
    {
      title: "Update Volume Limit",
      description: "Use this when the user wants to edit an existing safe volume limit or its schedule.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        limit_id: z.string().min(1),
        target_ref: targetRefSchema.optional(),
        name: z.string().min(1).optional(),
        safe_max: z.number().positive().optional(),
        schedule: scheduleSchema,
        enabled: z.boolean().optional()
      }
    },
    async ({ limit_id, ...input }) => runTool(context, "roon_update_volume_limit", () => context.volumeLimitService.update(limit_id, input))
  );

  registerTool(
    "roon_delete_volume_limit",
    {
      title: "Delete Volume Limit",
      description: "Use this when the user wants to delete one configured safe volume limit.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
      _meta: widgetMeta,
      inputSchema: { limit_id: z.string().min(1) }
    },
    async ({ limit_id }) => runTool(context, "roon_delete_volume_limit", () => {
      context.volumeLimitService.delete(limit_id);
      return { ok: true, limit_id };
    })
  );

  registerTool(
    "roon_evaluate_volume_policy",
    {
      title: "Evaluate Volume Policy",
      description: "Use this when the user wants to preview which safe volume limit would apply without changing Roon volume.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        target_ref: targetRefSchema,
        requested_volume: z.number().positive(),
        at: z.string().optional()
      }
    },
    async ({ target_ref, requested_volume, at }) =>
      runTool(context, "roon_evaluate_volume_policy", () =>
        context.volumeLimitService.evaluate(context.roonClient, { target_ref, requested_volume, at })
      )
  );

  registerTool(
    "roon_list_zone_presets",
    {
      title: "List Zone Presets",
      description: "Use this when the user wants to see RoonIA zone presets and portal-only virtual zones.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta
    },
    async () => runTool(context, "roon_list_zone_presets", () => context.zonePresetService.list())
  );

  registerTool(
    "roon_get_zone_preset",
    {
      title: "Get Zone Preset",
      description: "Use this when the user wants the full stored configuration for one RoonIA zone preset.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: { preset_id: z.string().min(1) }
    },
    async ({ preset_id }) => runTool(context, "roon_get_zone_preset", () => context.zonePresetService.get(preset_id))
  );

  registerTool(
    "roon_create_zone_preset",
    {
      title: "Create Zone Preset",
      description: "Use this when the user wants to save a reusable RoonIA zone preset; do not use it to start music.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: zonePresetInputSchema
    },
    async (input) => runTool(context, "roon_create_zone_preset", () => context.zonePresetService.create(context.roonClient, input))
  );

  registerTool(
    "roon_update_zone_preset",
    {
      title: "Update Zone Preset",
      description: "Use this when the user wants to edit a RoonIA zone preset without applying it.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        preset_id: z.string().min(1),
        ...Object.fromEntries(Object.entries(zonePresetInputSchema).filter(([key]) => key !== "name"))
      }
    },
    async ({ preset_id, ...input }) => runTool(context, "roon_update_zone_preset", () => context.zonePresetService.update(preset_id, input))
  );

  registerTool(
    "roon_delete_zone_preset",
    {
      title: "Delete Zone Preset",
      description: "Use this when the user wants to delete one RoonIA zone preset.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
      _meta: widgetMeta,
      inputSchema: { preset_id: z.string().min(1) }
    },
    async ({ preset_id }) => runTool(context, "roon_delete_zone_preset", () => {
      context.zonePresetService.delete(preset_id);
      return { ok: true, preset_id };
    })
  );

  registerTool(
    "roon_apply_zone_preset",
    {
      title: "Apply Zone Preset",
      description: "Use this when the user wants to apply a RoonIA zone preset to real Roon zones; it does not start music or replace queues.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        preset_id: z.string().min(1),
        dry_run: dryRunSchema,
        confirm: confirmSchema
      }
    },
    async ({ preset_id, dry_run, confirm }) =>
      runTool(context, "roon_apply_zone_preset", () =>
        context.zonePresetService.apply(context.roonClient, preset_id, {
          dryRun: Boolean(dry_run),
          confirm: Boolean(confirm),
          volumeLimitService: context.volumeLimitService
        })
      )
  );

  registerTool(
    "roon_transfer_playback",
    {
      title: "Transfer Roon Playback",
      description:
        "Use this when the user asks to move, transfer, pass or continue what is currently playing from one Roon zone to another. This natively transfers the current queue and playback state; do not search for the music or rebuild the queue.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        source_zone_id: z
          .string()
          .min(1)
          .describe("Zone ID currently owning the playback and queue."),
        target_zone_id: z
          .string()
          .min(1)
          .describe("Different zone ID that should receive the playback and queue."),
        dry_run: dryRunSchema
      }
    },
    async ({ source_zone_id, target_zone_id, dry_run }) =>
      runTool(context, "roon_transfer_playback", async () => {
        const before = {
          source: context.roonClient.getZone(source_zone_id) || { zone_id: source_zone_id },
          target: context.roonClient.getZone(target_zone_id) || { zone_id: target_zone_id }
        };
        if (dry_run) {
          return dryRunResponse("roon_transfer_playback", {
            before,
            after: {
              source_zone_id,
              target_zone_id,
              transferred: "queue_and_playback"
            }
          }, {
            before,
            warnings: ["Exact target playback state is verified only during execution."]
          });
        }
        const result = await transferZonePlayback(context.roonClient, source_zone_id, target_zone_id);
        return mutationSuccess("roon_transfer_playback", result, { before, after: result });
      })
  );

  registerTool(
    "roon_group_zones",
    {
      title: "Group Roon Zones",
      description:
        "Use this when the user asks to group or synchronize Roon zones. The primary zone's queue is preserved and the additional zones join it; never emulate grouping with separate playback commands.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        primary_zone_id: z
          .string()
          .min(1)
          .describe("Zone whose current queue and playback should be preserved."),
        additional_zone_ids: z
          .array(z.string().min(1))
          .min(1)
          .describe("Different compatible zones that should join the primary zone."),
        dry_run: dryRunSchema
      }
    },
    async ({ primary_zone_id, additional_zone_ids, dry_run }) =>
      runTool(context, "roon_group_zones", async () => {
        context.logger.info("MCP zone grouping arguments", {
          primaryZoneId: primary_zone_id,
          additionalZoneIds: additional_zone_ids
        });
        const before = {
          primary: context.roonClient.getZone(primary_zone_id) || { zone_id: primary_zone_id },
          additional: additional_zone_ids.map((zoneId) =>
            context.roonClient.getZone(zoneId) || { zone_id: zoneId }
          )
        };
        if (dry_run) {
          return dryRunResponse("roon_group_zones", {
            before,
            after: {
              primary_zone_id,
              additional_zone_ids
            }
          }, {
            before,
            warnings: ["Grouping compatibility and final grouped zone id are verified during execution."]
          });
        }
        const result = await groupZones(context.roonClient, primary_zone_id, additional_zone_ids);
        return mutationSuccess("roon_group_zones", result, { before, after: result });
      })
  );

  registerTool(
    "roon_ungroup_zone",
    {
      title: "Ungroup Roon Zone",
      description:
        "Use this when the user asks to split or fully ungroup a grouped Roon zone. Every output in the selected grouped zone becomes an independent zone.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        zone_id: z
          .string()
          .min(1)
          .describe("Current zone ID containing two or more grouped outputs."),
        dry_run: dryRunSchema
      }
    },
    async ({ zone_id, dry_run }) =>
      runTool(context, "roon_ungroup_zone", async () => {
        context.logger.info("MCP zone ungrouping arguments", { zoneId: zone_id });
        const before = context.roonClient.getZone(zone_id) || { zone_id };
        if (dry_run) {
          return dryRunResponse("roon_ungroup_zone", {
            before,
            after: { zone_id, separated_outputs: "all_group_members" }
          }, {
            before,
            warnings: ["Separated output zone ids are known only after execution."]
          });
        }
        const result = await ungroupZone(context.roonClient, zone_id);
        return mutationSuccess("roon_ungroup_zone", result, { before, after: result });
      })
  );

  registerTool(
    "roon_search",
    {
      title: "Search Roon",
      description: "Legacy untyped Roon search. Prefer roon_search_media for new requests.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: legacyWidgetMeta,
      inputSchema: {
        query: z.string().min(1),
        zone_id: z.string().optional(),
        offset: z.number().int().min(0).default(0),
        count: z.number().int().min(1).max(100).default(10),
        session_key: z.string().optional()
      }
    },
    async ({ query, zone_id, offset, count, session_key }) =>
      runTool(context, "roon_search", () =>
        searchRoon(context.roonClient, {
          query,
          zoneOrOutputId: zone_id,
          offset,
          count,
          sessionKey: session_key
        })
      )
  );

  registerTool(
    "roon_play_by_query",
    {
      title: "Play Roon Query",
      description: "Legacy play-by-query tool. Prefer roon_search_media followed by roon_play_media.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: legacyWidgetMeta,
      inputSchema: {
        zone_id: z.string().min(1),
        query: z.string().min(1),
        session_key: z.string().optional()
      }
    },
    async ({ zone_id, query, session_key }) =>
      runTool(context, "roon_play_by_query", () =>
        playByQuery(context.roonClient, { zoneId: zone_id, query, sessionKey: session_key })
      )
  );

  registerTool(
    "roon_get_queue",
    {
      title: "Get Roon Queue",
      description: "Read a Roon queue snapshot for a zone.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        zone_id: z.string().min(1),
        max_item_count: z.number().int().min(1).max(500).default(50)
      }
    },
    async ({ zone_id, max_item_count }) =>
      runTool(context, "roon_get_queue", () =>
        getQueueSnapshot(context.roonClient, zone_id, max_item_count)
      )
  );

  registerTool(
    "roon_queue_by_query",
    {
      title: "Queue Roon Query",
      description: "Legacy queue-by-query tool. Prefer roon_search_media followed by roon_add_media_to_queue.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: legacyWidgetMeta,
      inputSchema: {
        zone_id: z.string().min(1),
        query: z.string().min(1),
        mode: z.enum(["add_next", "add_to_queue"]),
        session_key: z.string().optional()
      }
    },
    async ({ zone_id, query, mode, session_key }) =>
      runTool(context, "roon_queue_by_query", () =>
        queueByQuery(context.roonClient, { zoneId: zone_id, query, mode, sessionKey: session_key })
      )
  );

  registerTool(
    "roon_play_queue_item_from_here",
    {
      title: "Play Roon Queue Item",
      description: "Start playback from a queue item ID in a Roon zone.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        zone_id: z.string().min(1),
        queue_item_id: z.union([z.string().min(1), z.number()])
      }
    },
    async ({ zone_id, queue_item_id }) =>
      runTool(context, "roon_play_queue_item_from_here", () =>
        playQueueItemFromHere(context.roonClient, zone_id, queue_item_id)
      )
  );

  registerTool(
    "roon_list_virtual_playlists",
    {
      title: "List Virtual Playlists",
      description: "List local virtual playlists stored by Roon AI Bridge.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        include_tracks: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
        track_limit: z.number().int().min(1).max(100).default(25),
        track_offset: z.number().int().min(0).default(0)
      }
    },
    async ({ include_tracks, limit, offset, track_limit, track_offset }) =>
      runTool(context, "roon_list_virtual_playlists", () =>
        context.playlistService.listPlaylists({
          includeTracks: include_tracks,
          limit,
          offset,
          trackLimit: track_limit,
          trackOffset: track_offset
        })
      )
  );

  registerTool(
    "roon_create_virtual_playlist",
    {
      title: "Create Virtual Playlist",
      description: "Create a local virtual playlist stored in SQLite with optional rich track metadata.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        tracks: z.array(playlistTrackInputSchema).optional(),
        dry_run: dryRunSchema
      }
    },
    async (args) =>
      runTool(context, "roon_create_virtual_playlist", async () => {
        if (args.dry_run) {
          return dryRunResponse("roon_create_virtual_playlist", {
            before: null,
            after: {
              playlist_id: args.playlist_id || "generated_from_name",
              name: args.name,
              description: args.description || null,
              tracks_count: Array.isArray(args.tracks) ? args.tracks.length : 0
            }
          }, {
            warnings: ["Final playlist_id and resolved Roon track metadata are known only during execution."]
          });
        }
        const playlist = await context.playlistService.createPlaylistResolved(args, {
          mediaService: context.mediaService,
          logger: context.logger
        });
        return {
          ...playlist,
          ui: {
            widget_type: "playlist_created",
            playlist_id: playlist.playlist_id,
            recommended_view: "playlist_detail"
          }
        };
      })
  );

  registerTool(
    "roon_get_virtual_playlist",
    {
      title: "Get Virtual Playlist",
      description: "Read one local virtual playlist with paginated tracks and metadata.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        include_tracks: z.boolean().default(true),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0)
      }
    },
    async ({ playlist_id, include_tracks, limit, offset }) =>
      runTool(context, "roon_get_virtual_playlist", () =>
        context.playlistService.getPlaylistDetail(playlist_id, {
          includeTracks: include_tracks,
          limit,
          offset
        })
      )
  );

  registerTool(
    "roon_update_virtual_playlist",
    {
      title: "Update Virtual Playlist",
      description: "Rename or change the description of a local virtual playlist.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        dry_run: dryRunSchema
      }
    },
    async ({ playlist_id, dry_run, ...changes }) =>
      runTool(context, "roon_update_virtual_playlist", () => {
        const before = context.playlistService.getPlaylist(playlist_id);
        if (dry_run) {
          return dryRunResponse("roon_update_virtual_playlist", {
            before,
            after: {
              ...before,
              ...changes,
              description: changes.description === undefined
                ? before.description
                : changes.description || null
            }
          }, { before });
        }
        const result = context.playlistService.updatePlaylist(playlist_id, changes);
        return mutationSuccess("roon_update_virtual_playlist", result, { before, after: result });
      })
  );

  registerTool(
    "roon_delete_virtual_playlist",
    {
      title: "Delete Virtual Playlist",
      description: "Delete a local virtual playlist from SQLite storage.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        dry_run: dryRunSchema,
        confirm: confirmSchema
      }
    },
    async ({ playlist_id, dry_run, confirm }) =>
      runTool(context, "roon_delete_virtual_playlist", () => {
        if (dry_run) {
          const before = context.playlistService.getPlaylist(playlist_id);
          return dryRunResponse("roon_delete_virtual_playlist", {
            before,
            after: null
          }, { before });
        }
        if (!confirm) {
          return confirmationRequiredResponse(
            "roon_delete_virtual_playlist",
            "destructive_action",
            "This action deletes a virtual playlist and requires confirmation.",
            { playlist_id },
            { playlist_id },
            "Delete virtual playlist."
          );
        }
        const before = context.playlistService.getPlaylist(playlist_id);
        const result = context.playlistService.deletePlaylist(playlist_id);
        return mutationSuccess("roon_delete_virtual_playlist", result, { before, after: null });
      })
  );

  registerTool(
    "roon_add_virtual_playlist_track",
    {
      title: "Add Virtual Playlist Track",
      description: "Add one track with query and optional metadata to a local virtual playlist.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        ...playlistTrackWritableShape,
        dry_run: dryRunSchema
      }
    },
    async ({ playlist_id, dry_run, ...track }) =>
      runTool(context, "roon_add_virtual_playlist_track", async () => {
        const before = context.playlistService.getPlaylist(playlist_id);
        if (dry_run) {
          return dryRunResponse("roon_add_virtual_playlist_track", {
            before,
            after: {
              playlist_id,
              tracks_count: before.tracks_count + 1,
              track
            }
          }, {
            before,
            warnings: ["Final track_id and resolved Roon metadata are known only during execution."]
          });
        }
        const playlist = await context.playlistService.addTrackResolved(playlist_id, track, {
          mediaService: context.mediaService,
          logger: context.logger
        });
        return {
          ...playlist,
          ui: {
            widget_type: "playlist_created",
            playlist_id: playlist.playlist_id,
            recommended_view: "playlist_detail"
          }
        };
      })
  );

  registerTool(
    "roon_update_virtual_playlist_track",
    {
      title: "Update Virtual Playlist Track",
      description: "Update a stored virtual playlist track, including query, metadata and position.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        track_id: z.string().min(1),
        ...playlistTrackWritableShape,
        dry_run: dryRunSchema
      }
    },
    async ({ playlist_id, track_id, dry_run, ...track }) =>
      runTool(context, "roon_update_virtual_playlist_track", () => {
        const before = context.playlistService.getPlaylist(playlist_id);
        if (dry_run) {
          return dryRunResponse("roon_update_virtual_playlist_track", {
            before,
            after: { playlist_id, track_id, track }
          }, {
            before,
            warnings: ["Full updated playlist is known only during execution."]
          });
        }
        const result = context.playlistService.updateTrack(playlist_id, track_id, track);
        return mutationSuccess("roon_update_virtual_playlist_track", result, { before, after: result });
      })
  );

  registerTool(
    "roon_remove_virtual_playlist_track",
    {
      title: "Remove Virtual Playlist Track",
      description: "Remove one track from a local virtual playlist.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        track_id: z.string().min(1),
        dry_run: dryRunSchema,
        confirm: confirmSchema
      }
    },
    async ({ playlist_id, track_id, dry_run, confirm }) =>
      runTool(context, "roon_remove_virtual_playlist_track", () => {
        const before = context.playlistService.getPlaylist(playlist_id);
        if (dry_run) {
          return dryRunResponse("roon_remove_virtual_playlist_track", {
            before,
            after: {
              ...before,
              tracks: before.tracks.filter((track) => track.track_id !== track_id),
              tracks_count: Math.max(0, before.tracks_count - 1),
              track_count: Math.max(0, before.track_count - 1)
            }
          }, { before });
        }
        if (!confirm) {
          return confirmationRequiredResponse(
            "roon_remove_virtual_playlist_track",
            "destructive_action",
            "This action deletes a track from a virtual playlist and requires confirmation.",
            { playlist_id, track_id },
            { playlist_id, track_id },
            "Remove track from virtual playlist."
          );
        }
        const result = context.playlistService.removeTrack(playlist_id, track_id);
        return mutationSuccess("roon_remove_virtual_playlist_track", result, { before, after: result });
      })
  );

  registerTool(
    "roon_replace_virtual_playlist_tracks",
    {
      title: "Replace Virtual Playlist Tracks",
      description: "Replace the full track list of a virtual playlist in one operation.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        tracks: z.array(playlistTrackInputSchema),
        dry_run: dryRunSchema,
        confirm: confirmSchema
      }
    },
    async ({ playlist_id, tracks, dry_run, confirm }) =>
      runTool(context, "roon_replace_virtual_playlist_tracks", () => {
        const before = context.playlistService.getPlaylist(playlist_id);
        if (dry_run) {
          return dryRunResponse("roon_replace_virtual_playlist_tracks", {
            before,
            after: {
              playlist_id,
              tracks_count: tracks.length,
              tracks
            }
          }, {
            before,
            warnings: ["Resolved Roon track metadata is known only during execution."]
          });
        }
        if (!confirm) {
          return confirmationRequiredResponse(
            "roon_replace_virtual_playlist_tracks",
            "destructive_action",
            "This action replaces all tracks in a virtual playlist and requires confirmation.",
            { playlist_id, replacement_track_count: tracks.length },
            { playlist_id, tracks },
            "Replace all tracks in virtual playlist."
          );
        }
        return context.playlistService.replaceTracksResolved(playlist_id, tracks, {
          mediaService: context.mediaService,
          logger: context.logger
        });
      })
  );

  registerTool(
    "roon_resolve_virtual_playlist",
    {
      title: "Resolve Virtual Playlist",
      description:
        "Use this when an existing local virtual playlist has unresolved or low-confidence tracks and should be re-matched against Roon search.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        track_ids: z.array(z.string().min(1)).optional(),
        mode: z.enum(["unresolved_only", "all", "selected"]).default("unresolved_only"),
        dry_run: dryRunSchema,
        force: z.boolean().default(false),
        strategy: z.object({
          source_preference: z
            .enum(["highest_quality", "streaming_first", "library_first"])
            .default("highest_quality"),
          avoid_live: z.boolean().optional(),
          avoid_remix: z.boolean().optional(),
          avoid_cover: z.boolean().optional(),
          prefer_original_album: z.boolean().optional()
        }).optional(),
        source_preference: z
          .enum(["highest_quality", "streaming_first", "library_first"])
          .default("highest_quality")
      }
    },
    async ({ playlist_id, track_ids, mode, dry_run, force, strategy, source_preference }) =>
      runTool(context, "roon_resolve_virtual_playlist", () => {
        if (dry_run) {
          return dryRunResponse("roon_resolve_virtual_playlist", {
            before: context.playlistService.getPlaylist(playlist_id),
            after: { playlist_id, mode, track_ids, strategy }
          }, { warnings: ["Roon search candidates are known only during execution."] });
        }
        return context.playlistService.resolveVirtualPlaylistItems(playlist_id, {
          mediaService: context.mediaService,
          logger: context.logger,
          trackIds: mode === "selected" ? track_ids : undefined,
          force: force || mode === "all",
          sourcePreference: strategy?.source_preference || source_preference
        });
      })
  );

  registerTool(
    "roon_validate_virtual_playlist",
    {
      title: "Validate Virtual Playlist",
      description: "Use this when a virtual playlist should be checked for unresolved tracks, ambiguous matches, duplicate positions, missing metadata and probable duplicates without modifying it.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: { playlist_id: z.string().min(1) }
    },
    async ({ playlist_id }) =>
      runTool(context, "roon_validate_virtual_playlist", () =>
        context.playlistService.validatePlaylist(playlist_id)
      )
  );

  registerTool(
    "roon_deduplicate_virtual_playlist",
    {
      title: "Deduplicate Virtual Playlist",
      description: "Use this when duplicate tracks in a virtual playlist should be detected and suggested; it never deletes tracks.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        dry_run: dryRunSchema,
        strategy: z.object({}).catchall(z.unknown()).optional()
      }
    },
    async ({ playlist_id, dry_run, strategy }) =>
      runTool(context, "roon_deduplicate_virtual_playlist", () =>
        context.playlistService.deduplicatePlaylist(playlist_id, { dry_run, strategy })
      )
  );

  registerTool(
    "roon_sort_virtual_playlist",
    {
      title: "Sort Virtual Playlist",
      description: "Use this when a virtual playlist should be ordered by standard audio metadata, position, season_episode or arbitrary user_metadata fields.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        sort_by: z.array(z.object({
          field: z.string().min(1),
          direction: z.enum(["asc", "desc"]).default("asc")
        })).optional(),
        dry_run: dryRunSchema
      }
    },
    async ({ playlist_id, sort_by, dry_run }) =>
      runTool(context, "roon_sort_virtual_playlist", () =>
        context.playlistService.sortPlaylist(playlist_id, { sort_by, dry_run })
      )
  );

  registerTool(
    "roon_export_virtual_playlist",
    {
      title: "Export Virtual Playlist",
      description: "Use this when a virtual playlist should be exported as full JSON, CSV with dynamic user metadata columns, or M3U.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        format: z.enum(["json", "csv", "m3u"]).default("json")
      }
    },
    async ({ playlist_id, format }) =>
      runTool(context, "roon_export_virtual_playlist", () =>
        context.playlistService.exportPlaylist(playlist_id, format)
      )
  );

  registerTool(
    "roon_import_virtual_playlist",
    {
      title: "Import Virtual Playlist",
      description: "Use this when a virtual playlist JSON payload should be created or update an existing playlist; existing playlists require confirm or overwrite.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist: z.object({}).catchall(z.unknown()),
        dry_run: dryRunSchema,
        overwrite: z.boolean().optional(),
        confirm: confirmSchema
      }
    },
    async (input) =>
      runTool(context, "roon_import_virtual_playlist", () => {
        const result = context.playlistService.importPlaylist(input);
        return {
          ...result,
          ui: {
            widget_type: "playlist_created",
            playlist_id: (result as any).playlist_id || (input.playlist as any)?.playlist_id || null,
            recommended_view: "playlist_detail"
          }
        };
      })
  );

  registerTool(
    "roon_set_virtual_playlist_track_match",
    {
      title: "Set Virtual Playlist Track Match",
      description: "Use this when the user manually chooses a search result for an existing virtual playlist track; it preserves user_metadata.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        track_id: z.string().min(1),
        result_id: z.string().min(1),
        selection_reason: z.string().optional()
      }
    },
    async ({ playlist_id, track_id, result_id, selection_reason }) =>
      runTool(context, "roon_set_virtual_playlist_track_match", () =>
        context.playlistService.setTrackMatch(playlist_id, track_id, result_id, {
          mediaService: context.mediaService,
          selectionReason: selection_reason
        })
      )
  );

  registerTool(
    "roon_add_search_result_to_virtual_playlist",
    {
      title: "Add Search Result To Virtual Playlist",
      description: "Use this when a user-selected result_id should be added to a virtual playlist with audio metadata and arbitrary user_metadata.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        result_id: z.string().min(1),
        position: z.number().int().min(1).optional(),
        user_metadata: playlistTrackMetadataSchema.optional()
      }
    },
    async ({ playlist_id, ...input }) =>
      runTool(context, "roon_add_search_result_to_virtual_playlist", () => {
        const result = context.playlistService.addSearchResultToPlaylist(playlist_id, input, context.mediaService);
        return {
          ...result,
          ui: {
            widget_type: "playlist_created",
            playlist_id,
            recommended_view: "playlist_detail"
          }
        };
      })
  );

  registerTool(
    "roon_expand_media_search",
    {
      title: "Expand Media Search",
      description: "Use this when the first search did not show the right song and broader, context-stripped or fuzzy candidate searches are needed.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        original_query: z.string().min(1),
        previous_query: z.string().optional(),
        types: mediaTypesInputSchema,
        strategy: z.enum(["broaden", "remove_context", "artist_only", "title_only", "fuzzy", "all"]).default("all"),
        count: z.number().int().min(1).max(25).default(25),
        zone_id: z.string().optional(),
        source_preference: z.enum(["highest_quality", "streaming_first", "library_first"]).default("highest_quality")
      }
    },
    async ({ original_query, previous_query, types, strategy, count, zone_id, source_preference }) =>
      runTool(context, "roon_expand_media_search", () =>
        context.mediaService.expandSearch({
          originalQuery: original_query,
          previousQuery: previous_query,
          types: normalizeMediaTypesInput(types),
          strategy,
          count,
          zoneId: zone_id,
          sourcePreference: source_preference
        })
      )
  );

  registerTool(
    "roon_reorder_virtual_playlist_tracks",
    {
      title: "Reorder Virtual Playlist Tracks",
      description: "Reorder all tracks of a virtual playlist by passing the full ordered track_id list.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        track_ids: z.array(z.string().min(1)).min(1),
        dry_run: dryRunSchema
      }
    },
    async ({ playlist_id, track_ids, dry_run }) =>
      runTool(context, "roon_reorder_virtual_playlist_tracks", () => {
        const before = context.playlistService.getPlaylist(playlist_id);
        if (dry_run) {
          return dryRunResponse("roon_reorder_virtual_playlist_tracks", {
            before,
            after: { playlist_id, track_ids }
          }, { before });
        }
        const result = context.playlistService.reorderTracks(playlist_id, track_ids);
        return mutationSuccess("roon_reorder_virtual_playlist_tracks", result, { before, after: result });
      })
  );

  registerTool(
    "roon_play_virtual_playlist",
    {
      title: "Play Virtual Playlist",
      description: "Play or enqueue a local virtual playlist in a Roon zone.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        zone_id: z.string().min(1),
        mode: z.enum(["add_to_queue", "add_next", "play_now"]).default("add_to_queue"),
        limit: z.number().int().min(1).optional(),
        session_key: z.string().optional(),
        dry_run: dryRunSchema
      }
    },
    async ({ playlist_id, zone_id, mode, limit, session_key, dry_run }) =>
      runTool(context, "roon_play_virtual_playlist", () => {
        if (dry_run) {
          const playlist = context.playlistService.getPlaylist(playlist_id);
          return dryRunResponse("roon_play_virtual_playlist", {
            before: {
              playlist,
              zone: context.roonClient.getZone(zone_id) || { zone_id }
            },
            after: {
              playlist_id,
              zone_id,
              mode,
              requested: Math.min(limit || playlist.tracks_count, playlist.tracks_count)
            }
          }, {
            warnings: ["Roon queue results are known only during execution."]
          });
        }
        return context.playlistService.playPlaylist(context.roonClient, playlist_id, {
          zone_id,
          mode,
          limit,
          session_key
        });
      })
  );

  registerTool(
    "roon_search_media",
    {
      title: "Search Roon Media",
      description:
        "Search Roon by media type and return temporary result_id references. Use this before playing or queueing a specific track, album, artist or playlist. Results include best-effort source and quality metadata.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        query: z.string().min(1),
        types: mediaTypesInputSchema,
        zone_id: z.string().optional(),
        count: z.number().int().min(1).max(25).default(10),
        source_preference: z
          .enum(["highest_quality", "streaming_first", "library_first"])
          .default("highest_quality"),
        include_images: z.boolean().default(false)
      }
    },
    async ({ query, types, zone_id, count, source_preference, include_images }) =>
      runTool(context, "roon_search_media", async () => {
        const payload = await context.mediaService.search({
          query,
          types: normalizeMediaTypesInput(types),
          zoneId: zone_id,
          count,
          sourcePreference: source_preference
        });
        if (!include_images) return payload;
        return {
          ...payload,
          results: await Promise.all(
            payload.results.map(async (media: any) => ({
              ...media,
              image_data_url: await imageDataUrl(
                context,
                media.image_key || media.cover?.image_key
              )
            }))
          )
        };
      })
  );

  registerTool(
    "roon_get_media_details",
    {
      title: "Get Roon Media Details",
      description:
        "Read the type, title, source, quality and expiry of a result_id returned by roon_search_media.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        result_id: z.string().min(1)
      }
    },
    async ({ result_id }) =>
      runTool(context, "roon_get_media_details", () =>
        context.mediaService.get(result_id)
      )
  );

  registerTool(
    "roon_list_artist_releases",
    {
      title: "List Roon Artist Releases",
      description:
        "List album releases for an artist result_id. Use this to resolve requests such as the latest album or early albums before choosing a release to play.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        result_id: z.string().min(1),
        zone_id: z.string().optional(),
        count: z.number().int().min(1).max(100).default(50)
      }
    },
    async ({ result_id, zone_id, count }) =>
      runTool(context, "roon_list_artist_releases", () =>
        context.mediaService.listArtistReleases(result_id, zone_id, count)
      )
  );

  registerTool(
    "roon_play_media",
    {
      title: "Play Selected Roon Media",
      description:
        "Start a new playback from an exact result_id in a Roon zone and replace the existing queue. For an artist, play only that artist's catalog using Roon Shuffle; use roon_start_radio for similar music.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        result_id: z.string().min(1),
        zone_id: z.string().min(1),
        dry_run: dryRunSchema
      }
    },
    async ({ result_id, zone_id, dry_run }) =>
      runTool(context, "roon_play_media", () => {
        const media = context.mediaService.get(result_id);
        const before = {
          zone: context.roonClient.getZone(zone_id) || { zone_id },
          media
        };
        if (dry_run) {
          return dryRunResponse("roon_play_media", {
            before,
            after: {
              zone_id,
              result_id,
              mode: "replace_queue",
              queue: "would_replace_queue"
            }
          }, {
            before,
            warnings: ["Exact Roon browse action and queue state are known only during execution."]
          });
        }
        return context.mediaService.play(result_id, zone_id, "replace_queue");
      })
  );

  registerTool(
    "roon_start_radio",
    {
      title: "Start Roon Artist Radio",
      description:
        "Start Roon Radio from an artist result_id. This intentionally includes similar artists; use roon_play_media to play only the selected artist.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        result_id: z.string().min(1),
        zone_id: z.string().min(1)
      }
    },
    async ({ result_id, zone_id }) =>
      runTool(context, "roon_start_radio", () =>
        context.mediaService.startRadio(result_id, zone_id)
      )
  );

  registerTool(
    "roon_add_media_to_queue",
    {
      title: "Add Selected Roon Media To Queue",
      description:
        "Add an exact result_id next or at the end of a Roon zone queue without replacing current playback.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        result_id: z.string().min(1),
        zone_id: z.string().min(1),
        position: z.enum(["next", "end"]).default("end"),
        dry_run: dryRunSchema
      }
    },
    async ({ result_id, zone_id, position, dry_run }) =>
      runTool(context, "roon_add_media_to_queue", () => {
        const media = context.mediaService.get(result_id);
        const before = {
          zone: context.roonClient.getZone(zone_id) || { zone_id },
          media
        };
        if (dry_run) {
          return dryRunResponse("roon_add_media_to_queue", {
            before,
            after: {
              zone_id,
              result_id,
              position,
              queue: position === "next" ? "would_add_next" : "would_append"
            }
          }, {
            before,
            warnings: ["Exact queue item ids are known only during execution."]
          });
        }
        return context.mediaService.play(
          result_id,
          zone_id,
          position === "next" ? "play_next" : "append"
        );
      })
  );

  registerTool(
    "roon_list_outputs",
    {
      title: "List Roon Outputs",
      description:
        "Use this when output-level volume, mute, standby, source control or presets require stable output IDs.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta
    },
    async () => runTool(context, "roon_list_outputs", () => listOutputs(context.roonClient))
  );

  registerTool(
    "roon_seek",
    {
      title: "Seek Roon Playback",
      description:
        "Use this when the user asks to jump to an absolute playback time or move forward/backward by a relative number of seconds.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        zone_id: z.string().min(1),
        mode: z.enum(["absolute", "relative"]),
        seconds: z.number()
      }
    },
    async ({ zone_id, mode, seconds }) =>
      runTool(context, "roon_seek", () =>
        seekZone(context.roonClient, zone_id, mode, seconds)
      )
  );

  registerTool(
    "roon_mute_output",
    {
      title: "Mute Roon Output",
      description:
        "Use this when the user asks to mute or unmute one specific output; do not use for every zone.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        output_id: z.string().min(1),
        action: z.enum(["mute", "unmute"])
      }
    },
    async ({ output_id, action }) =>
      runTool(context, "roon_mute_output", () =>
        muteOutput(context.roonClient, output_id, action)
      )
  );

  registerTool(
    "roon_change_output_volume",
    {
      title: "Change Roon Output Volume",
      description:
        "Use this for one output, especially incremental outputs that require relative_step instead of zone-wide absolute volume.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        output_id: z.string().min(1),
        mode: z.enum(["absolute", "relative", "relative_step"]),
        value: z.number()
      }
    },
    async ({ output_id, mode, value }) =>
      runTool(context, "roon_change_output_volume", () =>
        changeOutputVolume(context.roonClient, output_id, mode, value)
      )
  );

  registerTool(
    "roon_mute_all",
    {
      title: "Mute All Roon Outputs",
      description:
        "Use this only when the user explicitly asks to mute or unmute every mutable Roon output.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
      _meta: widgetMeta,
      inputSchema: { action: z.enum(["mute", "unmute"]) }
    },
    async ({ action }) =>
      runTool(context, "roon_mute_all", () => muteAll(context.roonClient, action))
  );

  registerTool(
    "roon_pause_all",
    {
      title: "Pause All Roon Zones",
      description: "Use this when the user explicitly asks to pause playback in every Roon zone.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
      _meta: widgetMeta
    },
    async () => runTool(context, "roon_pause_all", () => pauseAll(context.roonClient))
  );

  registerTool(
    "roon_output_power",
    {
      title: "Control Roon Output Power",
      description:
        "Use this for standby, toggling standby or convenience-switching one output that exposes source controls.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        output_id: z.string().min(1),
        action: z.enum(["standby", "toggle_standby", "convenience_switch"]),
        control_key: z.string().optional()
      }
    },
    async ({ output_id, action, control_key }) =>
      runTool(context, "roon_output_power", () =>
        outputPowerAction(context.roonClient, output_id, action, control_key)
      )
  );

  registerTool(
    "roon_change_playback_settings",
    {
      title: "Change Roon Playback Settings",
      description:
        "Use this to change shuffle, auto-radio or loop settings for one existing Roon zone.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        zone_id: z.string().min(1),
        shuffle: z.boolean().optional(),
        auto_radio: z.boolean().optional(),
        loop: z.enum(["loop", "loop_one", "disabled", "next"]).optional()
      }
    },
    async ({ zone_id, shuffle, auto_radio, loop }) =>
      runTool(context, "roon_change_playback_settings", () =>
        changeZoneSettings(context.roonClient, zone_id, {
          shuffle,
          auto_radio,
          loop
        })
      )
  );

  registerTool(
    "roon_restart_queue",
    {
      title: "Restart Roon Queue Playback",
      description:
        "Use this when the user asks to restart the existing queue from its first item without clearing or rebuilding it.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
      _meta: widgetMeta,
      inputSchema: { zone_id: z.string().min(1) }
    },
    async ({ zone_id }) =>
      runTool(context, "roon_restart_queue", () =>
        restartQueuePlayback(context.roonClient, zone_id)
      )
  );

  registerTool(
    "roon_run_browse_action",
    {
      title: "Run Generic Roon Browse Action",
      description:
        "Use this only with an item_key returned by the same Browse session, including actions with input_prompt and settings hierarchy items.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        hierarchy: z.enum([
          "browse", "playlists", "settings", "internet_radio",
          "albums", "artists", "genres", "composers", "search"
        ]),
        item_key: z.string().min(1),
        session_key: z.string().optional(),
        zone_id: z.string().optional(),
        input: z.string().optional()
      }
    },
    async ({ hierarchy, item_key, session_key, zone_id, input }) =>
      runTool(context, "roon_run_browse_action", () =>
        runBrowseAction(context.roonClient, {
          hierarchy,
          itemKey: item_key,
          sessionKey: session_key,
          zoneOrOutputId: zone_id,
          input
        })
      )
  );

  registerTool(
    "roon_get_image",
    {
      title: "Get Roon Image",
      description:
        "Use this when a Roon image_key must be rendered in the ChatGPT widget for a track, album, artist or playlist.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        image_key: z.string().min(1),
        width: z.number().int().min(1).max(1000).default(320),
        height: z.number().int().min(1).max(1000).default(320)
      }
    },
    async ({ image_key, width, height }) =>
      runTool(context, "roon_get_image", async () => {
        const image = await getRoonImage(context.roonClient, image_key, {
          width,
          height,
          scale: "fit",
          format: "image/jpeg"
        });
        return {
          image_key,
          content_type: image.contentType,
          data_url: `data:${image.contentType};base64,${image.bytes.toString("base64")}`
        };
      })
  );
}
