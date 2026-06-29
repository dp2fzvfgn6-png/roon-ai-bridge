import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { playByQuery, queueByQuery, searchRoon } from "../roon/roonBrowseService";
import { controlPlayback } from "../roon/roonPlaybackService";
import { getQueueSnapshot, playQueueItemFromHere } from "../roon/roonQueueService";
import { listZones } from "../roon/roonZoneService";
import { changeZoneVolume } from "../roon/roonVolumeService";
import { transferZonePlayback } from "../roon/roonTransferService";
import { groupZones, ungroupZone } from "../roon/roonGroupingService";
import { ApiError } from "../utils/errors";
import { parsePlaybackCommand, parseVolumeMode, parseVolumeValue } from "../utils/validation";
import { roonControlWidgetUri } from "./appResources";
import { McpContext } from "./mcpContext";

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
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    };
  }

  return {
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

function statusPayload(context: McpContext): Record<string, unknown> {
  return {
    core_connected: context.roonClient.isCoreConnected(),
    core_name: context.roonClient.getCoreName(),
    transport_ready: context.roonClient.isTransportReady(),
    browse_ready: context.roonClient.isBrowseReady(),
    zones_count: context.roonClient.getZones().length
  };
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

const widgetMeta = {
  ui: {
    resourceUri: roonControlWidgetUri,
    visibility: ["model", "app"]
  },
  "openai/outputTemplate": roonControlWidgetUri
};

const legacyWidgetMeta = {
  ui: {
    resourceUri: roonControlWidgetUri,
    visibility: ["app"]
  },
  "openai/outputTemplate": roonControlWidgetUri
};

const playlistTrackMetadataSchema = z
  .object({})
  .catchall(z.unknown());

const playlistTrackInputSchema = z.object({
  track_id: z.string().optional(),
  query: z.string().min(1),
  roon_item_key: z.string().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  position: z.number().int().min(1).optional(),
  metadata: playlistTrackMetadataSchema.optional(),
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
  query: z.string().min(1),
  roon_item_key: z.string().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  position: z.number().int().min(1).optional(),
  metadata: playlistTrackMetadataSchema.optional(),
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

export function registerRoonMcpTools(server: McpServer, context: McpContext): void {
  server.registerTool(
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

  server.registerTool(
    "roon_list_zones",
    {
      title: "List Roon Zones",
      description: "List available Roon zones, now playing metadata and outputs.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta
    },
    async () => runTool(context, "roon_list_zones", () => listZones(context.roonClient))
  );

  server.registerTool(
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
        command: z.enum(["play", "pause", "playpause", "stop", "next", "previous"])
      }
    },
    async ({ zone_id, command }) =>
      runTool(context, "roon_control_playback", async () => {
        const parsed = parsePlaybackCommand(command);
        context.logger.info("MCP playback arguments", {
          zoneId: zone_id,
          command: parsed
        });
        return controlPlayback(context.roonClient, zone_id, parsed);
      })
  );

  server.registerTool(
    "roon_change_volume",
    {
      title: "Change Roon Volume",
      description: "Change Roon zone volume using relative or absolute mode when supported.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        zone_id: z.string().min(1),
        mode: z.enum(["relative", "absolute"]),
        value: z.number()
      }
    },
    async ({ zone_id, mode, value }) =>
      runTool(context, "roon_change_volume", async () => {
        const parsedMode = parseVolumeMode(mode);
        const parsedValue = parseVolumeValue(value);
        const outputs = await changeZoneVolume(context.roonClient, zone_id, parsedMode, parsedValue);
        return {
          ok: true,
          zone_id,
          mode: parsedMode,
          value: parsedValue,
          outputs: outputs.map((output) => ({
            output_id: output.output_id,
            display_name: output.display_name
          }))
        };
      })
  );

  server.registerTool(
    "roon_transfer_playback",
    {
      title: "Transfer Roon Playback",
      description:
        "Use this when the user asks to move, transfer, pass or continue what is currently playing from one Roon zone to another. This natively transfers the current queue and playback state; do not search for the music or rebuild the queue.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        source_zone_id: z
          .string()
          .min(1)
          .describe("Zone ID currently owning the playback and queue."),
        target_zone_id: z
          .string()
          .min(1)
          .describe("Different zone ID that should receive the playback and queue.")
      }
    },
    async ({ source_zone_id, target_zone_id }) =>
      runTool(context, "roon_transfer_playback", () =>
        transferZonePlayback(context.roonClient, source_zone_id, target_zone_id)
      )
  );

  server.registerTool(
    "roon_group_zones",
    {
      title: "Group Roon Zones",
      description:
        "Use this when the user asks to group or synchronize Roon zones. The primary zone's queue is preserved and the additional zones join it; never emulate grouping with separate playback commands.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        primary_zone_id: z
          .string()
          .min(1)
          .describe("Zone whose current queue and playback should be preserved."),
        additional_zone_ids: z
          .array(z.string().min(1))
          .min(1)
          .describe("Different compatible zones that should join the primary zone.")
      }
    },
    async ({ primary_zone_id, additional_zone_ids }) =>
      runTool(context, "roon_group_zones", async () => {
        context.logger.info("MCP zone grouping arguments", {
          primaryZoneId: primary_zone_id,
          additionalZoneIds: additional_zone_ids
        });
        return groupZones(context.roonClient, primary_zone_id, additional_zone_ids);
      })
  );

  server.registerTool(
    "roon_ungroup_zone",
    {
      title: "Ungroup Roon Zone",
      description:
        "Use this when the user asks to split or fully ungroup a grouped Roon zone. Every output in the selected grouped zone becomes an independent zone.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        zone_id: z
          .string()
          .min(1)
          .describe("Current zone ID containing two or more grouped outputs.")
      }
    },
    async ({ zone_id }) =>
      runTool(context, "roon_ungroup_zone", async () => {
        context.logger.info("MCP zone ungrouping arguments", { zoneId: zone_id });
        return ungroupZone(context.roonClient, zone_id);
      })
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "roon_list_virtual_playlists",
    {
      title: "List Virtual Playlists",
      description: "List local virtual playlists stored by Roon AI Bridge.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta
    },
    async () =>
      runTool(context, "roon_list_virtual_playlists", () =>
        context.playlistService.listPlaylists()
      )
  );

  server.registerTool(
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
        tracks: z.array(playlistTrackInputSchema).optional()
      }
    },
    async (args) =>
      runTool(context, "roon_create_virtual_playlist", () =>
        context.playlistService.createPlaylist(args)
      )
  );

  server.registerTool(
    "roon_get_virtual_playlist",
    {
      title: "Get Virtual Playlist",
      description: "Read one local virtual playlist with all tracks and metadata.",
      ...structuredOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1)
      }
    },
    async ({ playlist_id }) =>
      runTool(context, "roon_get_virtual_playlist", () =>
        context.playlistService.getPlaylist(playlist_id)
      )
  );

  server.registerTool(
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
        description: z.string().optional()
      }
    },
    async ({ playlist_id, ...changes }) =>
      runTool(context, "roon_update_virtual_playlist", () =>
        context.playlistService.updatePlaylist(playlist_id, changes)
      )
  );

  server.registerTool(
    "roon_delete_virtual_playlist",
    {
      title: "Delete Virtual Playlist",
      description: "Delete a local virtual playlist from SQLite storage.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1)
      }
    },
    async ({ playlist_id }) =>
      runTool(context, "roon_delete_virtual_playlist", () =>
        context.playlistService.deletePlaylist(playlist_id)
      )
  );

  server.registerTool(
    "roon_add_virtual_playlist_track",
    {
      title: "Add Virtual Playlist Track",
      description: "Add one track with query and optional metadata to a local virtual playlist.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        ...playlistTrackWritableShape
      }
    },
    async ({ playlist_id, ...track }) =>
      runTool(context, "roon_add_virtual_playlist_track", () =>
        context.playlistService.addTrack(playlist_id, track)
      )
  );

  server.registerTool(
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
        ...playlistTrackWritableShape
      }
    },
    async ({ playlist_id, track_id, ...track }) =>
      runTool(context, "roon_update_virtual_playlist_track", () =>
        context.playlistService.updateTrack(playlist_id, track_id, track)
      )
  );

  server.registerTool(
    "roon_remove_virtual_playlist_track",
    {
      title: "Remove Virtual Playlist Track",
      description: "Remove one track from a local virtual playlist.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        track_id: z.string().min(1)
      }
    },
    async ({ playlist_id, track_id }) =>
      runTool(context, "roon_remove_virtual_playlist_track", () =>
        context.playlistService.removeTrack(playlist_id, track_id)
      )
  );

  server.registerTool(
    "roon_replace_virtual_playlist_tracks",
    {
      title: "Replace Virtual Playlist Tracks",
      description: "Replace the full track list of a virtual playlist in one operation.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        tracks: z.array(playlistTrackInputSchema)
      }
    },
    async ({ playlist_id, tracks }) =>
      runTool(context, "roon_replace_virtual_playlist_tracks", () =>
        context.playlistService.replaceTracks(playlist_id, tracks)
      )
  );

  server.registerTool(
    "roon_reorder_virtual_playlist_tracks",
    {
      title: "Reorder Virtual Playlist Tracks",
      description: "Reorder all tracks of a virtual playlist by passing the full ordered track_id list.",
      ...structuredOutputSchema,
      annotations: writeAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        playlist_id: z.string().min(1),
        track_ids: z.array(z.string().min(1)).min(1)
      }
    },
    async ({ playlist_id, track_ids }) =>
      runTool(context, "roon_reorder_virtual_playlist_tracks", () =>
        context.playlistService.reorderTracks(playlist_id, track_ids)
      )
  );

  server.registerTool(
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
        session_key: z.string().optional()
      }
    },
    async ({ playlist_id, zone_id, mode, limit, session_key }) =>
      runTool(context, "roon_play_virtual_playlist", () =>
        context.playlistService.playPlaylist(context.roonClient, playlist_id, {
          zone_id,
          mode,
          limit,
          session_key
        })
      )
  );

  server.registerTool(
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
        types: z
          .array(z.enum(["track", "album", "artist", "playlist"]))
          .optional(),
        zone_id: z.string().optional(),
        count: z.number().int().min(1).max(25).default(10),
        source_preference: z
          .enum(["highest_quality", "streaming_first", "library_first"])
          .default("highest_quality")
      }
    },
    async ({ query, types, zone_id, count, source_preference }) =>
      runTool(context, "roon_search_media", () =>
        context.mediaService.search({
          query,
          types,
          zoneId: zone_id,
          count,
          sourcePreference: source_preference
        })
      )
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "roon_play_media",
    {
      title: "Play Selected Roon Media",
      description:
        "Start a new playback from an exact result_id in a Roon zone and replace the existing queue. For an artist, play only that artist's catalog using Roon Shuffle; use roon_start_radio for similar music.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
      _meta: widgetMeta,
      inputSchema: {
        result_id: z.string().min(1),
        zone_id: z.string().min(1)
      }
    },
    async ({ result_id, zone_id }) =>
      runTool(context, "roon_play_media", () =>
        context.mediaService.play(result_id, zone_id, "replace_queue")
      )
  );

  server.registerTool(
    "roon_start_radio",
    {
      title: "Start Roon Artist Radio",
      description:
        "Start Roon Radio from an artist result_id. This intentionally includes similar artists; use roon_play_media to play only the selected artist.",
      ...structuredOutputSchema,
      annotations: destructiveAnnotations,
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

  server.registerTool(
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
        position: z.enum(["next", "end"]).default("end")
      }
    },
    async ({ result_id, zone_id, position }) =>
      runTool(context, "roon_add_media_to_queue", () =>
        context.mediaService.play(
          result_id,
          zone_id,
          position === "next" ? "play_next" : "append"
        )
      )
  );
}
