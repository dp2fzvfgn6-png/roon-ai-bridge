import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BridgeV2Context } from "../context";
import { failed, OperationResult } from "../contracts";
import { IntentGateway } from "../intentGateway";

const readOnly = { readOnlyHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

const outputSchema = {
  status: z.enum(["completed", "ambiguous", "confirmation_required", "not_available", "failed"]),
  operation: z.string(),
  summary: z.string(),
  verified: z.boolean(),
  data: z.unknown(),
  references: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown())
  }).optional()
};

const targetSchema = z.object({
  id: z.string().min(1).optional().describe("Stable Roon ID when already known."),
  name: z.string().min(1).optional().describe("Exact human-readable zone or output name.")
}).refine((value) => Boolean(value.id || value.name), "id or name is required");

const mediaType = z.enum(["track", "album", "artist", "playlist"]);
const sourcePreference = z.enum(["highest_quality", "streaming_first", "library_first"]);
const mediaSelector = z.object({
  result_id: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  type: mediaType.optional(),
  source_preference: sourcePreference.optional()
}).refine((value) => Boolean(value.result_id || value.query), "result_id or query is required");
const looseObject = z.object({}).catchall(z.unknown());

type ToolOptions = {
  title: string;
  description: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
  annotations: Record<string, boolean>;
};

export function registerBridgeV2Tools(server: McpServer, context: BridgeV2Context): void {
  const gateway = new IntentGateway(context);

  const register = (
    name: string,
    options: ToolOptions,
    handler: (input: any) => Promise<OperationResult> | OperationResult
  ): void => {
    if (
      !context.manifestMode &&
      context.activeApiKey?.role === "read" &&
      options.annotations.readOnlyHint !== true
    ) return;
    if (
      !context.manifestMode &&
      context.toolAccessService &&
      !context.toolAccessService.canUse(name, context.activeApiKey)
    ) return;
    server.registerTool(name, {
      ...options,
      outputSchema
    } as any, async (input: any) => {
      const started = Date.now();
      let result: OperationResult;
      try {
        context.logger.info("MCP v2 intent started", { tool: name });
        result = await handler(input || {});
      } catch (error) {
        result = failed(name, error);
        context.logger.warn("MCP v2 intent failed", { tool: name, error: result.error });
      }
      context.actionLogService?.record({
        source: "mcp",
        toolOrEndpoint: name,
        classification: {
          read_only: options.annotations.readOnlyHint === true,
          mutation: options.annotations.readOnlyHint !== true,
          destructive: options.annotations.destructiveHint === true
        },
        arguments: input,
        result,
        durationMs: Date.now() - started,
        requiresConfirmation: result.status === "confirmation_required",
        confirmed: Boolean(input?.confirm),
        warnings: result.warnings,
        errorCode: result.error?.code
      });
      return {
        structuredContent: result as any,
        content: [{ type: "text" as const, text: result.summary }],
        isError: result.status === "failed"
      };
    });
  };

  register("roon_get_state", {
    title: "Get Roon State",
    description: "Use this when programmatic Roon system, zone or output state is needed for diagnostics or follow-up reasoning. For a user-facing request asking what is playing or for now-playing status, use roon_open_player instead so the interactive widget is shown. It accepts a zone name directly, so do not list zones first.",
    annotations: readOnly,
    inputSchema: {
      scope: z.enum(["system", "zones", "zone", "outputs"]).default("system"),
      zone: targetSchema.optional(),
      include_unavailable_outputs: z.boolean().default(false)
    }
  }, (input) => gateway.getState(input));

  register("roon_control_playback", {
    title: "Control Roon Playback",
    description: "Use this when the user wants to control an existing queue: play, pause, toggle, stop, skip, go back or seek. Do not use it to choose new music.",
    annotations: write,
    inputSchema: {
      target: z.enum(["zone", "all"]).default("zone"),
      zone: targetSchema.optional(),
      action: z.enum(["play", "pause", "toggle", "stop", "next", "previous", "seek"]),
      seek: z.object({ mode: z.enum(["absolute", "relative"]), seconds: z.number() }).optional()
    }
  }, (input) => gateway.controlPlayback(input));

  register("roon_set_volume", {
    title: "Set Roon Volume",
    description: "Use this when the user wants absolute or relative volume, mute or unmute for a named zone, named output or all outputs. Safe zone limits are enforced internally.",
    annotations: write,
    inputSchema: {
      target: z.enum(["zone", "output", "all"]).default("zone"),
      zone: targetSchema.optional(),
      output: targetSchema.optional(),
      mode: z.enum(["absolute", "relative", "relative_step", "mute", "unmute"]),
      value: z.number().optional(),
      confirm: z.boolean().optional()
    }
  }, (input) => gateway.setVolume(input));

  register("roon_control_output", {
    title: "Control Roon Output",
    description: "Use this when one physical output must receive a supported standby or convenience-switch command. Use roon_set_volume for mute and volume.",
    annotations: write,
    inputSchema: {
      output: targetSchema,
      action: z.enum(["standby", "toggle_standby", "convenience_switch"]),
      control_key: z.string().optional()
    }
  }, (input) => gateway.controlOutput(input));

  register("roon_set_playback_options", {
    title: "Set Roon Playback Options",
    description: "Use this when shuffle, automatic radio or loop behavior should change for a named zone. Do not use it for play, pause or selecting music.",
    annotations: write,
    inputSchema: {
      zone: targetSchema,
      shuffle: z.boolean().optional(),
      auto_radio: z.boolean().optional(),
      loop: z.enum(["loop", "loop_one", "disabled", "next"]).optional()
    }
  }, (input) => gateway.setPlaybackOptions(input));

  register("roon_set_grouping", {
    title: "Set Roon Zone Grouping",
    description: "Use this when zones should play synchronously or a current group should be split. Do not emulate grouping with separate playback calls.",
    annotations: write,
    inputSchema: {
      action: z.enum(["group", "ungroup"]),
      primary_zone: targetSchema,
      additional_zones: z.array(targetSchema).optional()
    }
  }, (input) => gateway.setGrouping(input));

  register("roon_transfer_playback", {
    title: "Transfer Roon Playback",
    description: "Use this when current playback and its queue should move from one named zone to another. Do not search for or rebuild the music.",
    annotations: write,
    inputSchema: { source_zone: targetSchema, target_zone: targetSchema }
  }, (input) => gateway.transfer(input));

  register("roon_search_media", {
    title: "Search Roon Media",
    description: "Use this when the user wants to explore or select tracks, albums, artists or playlists. It never starts playback.",
    annotations: readOnly,
    inputSchema: {
      query: z.string().min(1),
      types: z.array(mediaType).optional(),
      count: z.number().int().min(1).max(25).default(10),
      source_preference: sourcePreference.default("highest_quality")
    }
  }, (input) => gateway.searchMedia(input));

  register("roon_get_media_entity", {
    title: "Get Roon Media Entity",
    description: "Use this when a selected artist, album, track or playlist needs deep details. Artist results include releases and popular tracks; album results include their track list.",
    annotations: readOnly,
    inputSchema: {
      result_id: z.string().min(1),
      zone: targetSchema.optional(),
      count: z.number().int().min(1).max(100).optional()
    }
  }, (input) => gateway.getMediaEntity(input));

  register("roon_play_media", {
    title: "Play Roon Media",
    description: "Use this when the user wants new music to start now and replace the zone queue. Pass either a prior result_id or a query; ambiguous matches are returned without playing.",
    annotations: write,
    inputSchema: { zone: targetSchema, media: mediaSelector }
  }, (input) => gateway.playMedia(input));

  register("roon_enqueue_media", {
    title: "Enqueue Roon Media",
    description: "Use this when selected or queried music should play next or be appended without replacing the current queue.",
    annotations: write,
    inputSchema: {
      zone: targetSchema,
      media: mediaSelector,
      position: z.enum(["next", "end"]).default("end")
    }
  }, (input) => gateway.enqueueMedia(input));

  register("roon_start_radio", {
    title: "Start Roon Artist Radio",
    description: "Use this when the user explicitly wants an artist radio including similar artists. Use roon_play_media for only the selected artist catalog.",
    annotations: write,
    inputSchema: { zone: targetSchema, artist: mediaSelector }
  }, (input) => gateway.startRadio(input));

  register("roon_get_queue", {
    title: "Get Roon Queue",
    description: "Use this when the current queue for a named zone must be inspected.",
    annotations: readOnly,
    inputSchema: {
      zone: targetSchema,
      count: z.number().int().min(1).max(500).default(100)
    }
  }, (input) => gateway.getQueue(input));

  register("roon_play_queue_item", {
    title: "Play Roon Queue Item",
    description: "Use this when playback should continue from a queue_item_id returned by roon_get_queue.",
    annotations: write,
    inputSchema: { zone: targetSchema, queue_item_id: z.number().int().nonnegative() }
  }, (input) => gateway.playQueueItem(input));

  register("roon_list_playlists", {
    title: "List RoonIA Playlists",
    description: "Use this when the user wants a paginated list of virtual playlists without track details.",
    annotations: readOnly,
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0)
    }
  }, (input) => gateway.listPlaylists(input));

  register("roon_get_playlist", {
    title: "Get RoonIA Playlist",
    description: "Use this when one virtual playlist and its paginated tracks are needed.",
    annotations: readOnly,
    inputSchema: {
      playlist_id: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0)
    }
  }, (input) => gateway.getPlaylist(input));

  register("roon_save_playlist", {
    title: "Save RoonIA Playlist",
    description: "Use this when a virtual playlist should be created or its name and description updated. Omit playlist_id to create it.",
    annotations: write,
    inputSchema: {
      playlist_id: z.string().optional(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      tracks: z.array(looseObject).optional()
    }
  }, (input) => gateway.savePlaylist(input));

  register("roon_edit_playlist_tracks", {
    title: "Edit RoonIA Playlist Tracks",
    description: "Use this when one or more playlist track additions, updates, removals, replacements or reorderings should be applied as a single batch.",
    annotations: destructive,
    inputSchema: {
      playlist_id: z.string().min(1),
      operations: z.array(looseObject).min(1).max(250),
      confirm: z.boolean().default(false)
    }
  }, (input) => gateway.editPlaylistTracks(input));

  register("roon_delete_playlist", {
    title: "Delete RoonIA Playlist",
    description: "Use this when the user explicitly wants a virtual playlist permanently deleted. It requires confirm=true.",
    annotations: destructive,
    inputSchema: { playlist_id: z.string().min(1), confirm: z.boolean().default(false) }
  }, (input) => gateway.deletePlaylist(input));

  register("roon_play_playlist", {
    title: "Play RoonIA Playlist",
    description: "Use this when a virtual playlist should start now, play next or be appended in a named zone.",
    annotations: write,
    inputSchema: {
      playlist_id: z.string().min(1),
      zone: targetSchema,
      mode: z.enum(["play_now", "add_next", "add_to_queue"]).default("play_now"),
      limit: z.number().int().min(1).optional()
    }
  }, (input) => gateway.playPlaylist(input));

  register("roon_play_playlist_track", {
    title: "Play RoonIA Playlist Track",
    description: "Use this when one stored track from a virtual playlist should play now, play next or be appended in a named zone.",
    annotations: write,
    inputSchema: {
      playlist_id: z.string().min(1),
      track_id: z.string().min(1),
      zone: targetSchema,
      mode: z.enum(["play_now", "add_next", "add_to_queue"]).default("play_now")
    }
  }, (input) => gateway.playPlaylistTrack(input));

  register("roon_analyze_playlist", {
    title: "Analyze RoonIA Playlist",
    description: "Use this when playlist identity readiness, missing metadata, ambiguity or probable duplicates should be checked without modifying it.",
    annotations: readOnly,
    inputSchema: { playlist_id: z.string().min(1), include_duplicates: z.boolean().default(true) }
  }, (input) => gateway.analyzePlaylist(input));

  register("roon_resolve_playlist", {
    title: "Resolve RoonIA Playlist",
    description: "Use this when stale, missing or ambiguous playlist identities should be searched again and their resolution state updated.",
    annotations: write,
    inputSchema: { playlist_id: z.string().min(1) }
  }, (input) => gateway.resolvePlaylist(input));

  register("roon_export_playlist", {
    title: "Export RoonIA Playlist",
    description: "Use this when a virtual playlist should be exported as JSON, CSV or M3U.",
    annotations: readOnly,
    inputSchema: {
      playlist_id: z.string().min(1),
      format: z.enum(["json", "csv", "m3u"]).default("json")
    }
  }, (input) => gateway.exportPlaylist(input));

  register("roon_import_playlist", {
    title: "Import RoonIA Playlist",
    description: "Use this when a validated RoonIA playlist JSON payload should be imported. Replacing an existing playlist requires confirm=true.",
    annotations: destructive,
    inputSchema: { payload: looseObject, confirm: z.boolean().default(false) }
  }, (input) => gateway.importPlaylist(input));

  register("roon_get_configuration", {
    title: "Get RoonIA Configuration",
    description: "Use this when configured safe volume limits or zone presets must be listed or read by ID.",
    annotations: readOnly,
    inputSchema: {
      resource: z.enum(["volume_limits", "zone_presets"]),
      id: z.string().optional()
    }
  }, (input) => gateway.getConfiguration(input));

  register("roon_save_configuration", {
    title: "Save RoonIA Configuration",
    description: "Use this when a safe volume limit or zone preset should be created or updated. Omit id to create it.",
    annotations: write,
    inputSchema: {
      resource: z.enum(["volume_limit", "zone_preset"]),
      id: z.string().optional(),
      value: looseObject
    }
  }, (input) => gateway.saveConfiguration(input));

  register("roon_delete_configuration", {
    title: "Delete RoonIA Configuration",
    description: "Use this when one safe volume limit or zone preset should be permanently deleted. It requires confirm=true.",
    annotations: destructive,
    inputSchema: {
      resource: z.enum(["volume_limit", "zone_preset"]),
      id: z.string().min(1),
      confirm: z.boolean().default(false)
    }
  }, (input) => gateway.deleteConfiguration(input));

  register("roon_apply_zone_preset", {
    title: "Apply RoonIA Zone Preset",
    description: "Use this when a stored zone preset should configure real grouping and volumes without selecting new music.",
    annotations: write,
    inputSchema: { preset_id: z.string().min(1), confirm: z.boolean().default(false) }
  }, (input) => gateway.applyZonePreset(input));

  register("roon_run_diagnostics", {
    title: "Run RoonIA Diagnostics",
    description: "Use this when RoonIA or Roon connectivity must be diagnosed with a sanitized operational bundle. Do not use it for routine state queries.",
    annotations: readOnly,
    inputSchema: {
      include_logs: z.boolean().default(true),
      include_actions: z.boolean().default(true)
    }
  }, (input) => gateway.runDiagnostics(input));
}
