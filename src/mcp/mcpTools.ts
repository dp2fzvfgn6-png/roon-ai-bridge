import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { playByQuery, queueByQuery, searchRoon } from "../roon/roonBrowseService";
import { controlPlayback } from "../roon/roonPlaybackService";
import { getQueueSnapshot, playQueueItemFromHere } from "../roon/roonQueueService";
import { listZones } from "../roon/roonZoneService";
import { changeZoneVolume } from "../roon/roonVolumeService";
import { ApiError } from "../utils/errors";
import { parsePlaybackCommand, parseVolumeMode, parseVolumeValue } from "../utils/validation";
import { McpContext } from "./mcpContext";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function jsonToolResult(value: unknown, isError = false): ToolResult {
  return {
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

export function registerRoonMcpTools(server: McpServer, context: McpContext): void {
  server.registerTool(
    "roon_status",
    {
      title: "Roon Status",
      description: "Return Roon Core connection status and service readiness."
    },
    async () => runTool(context, "roon_status", () => statusPayload(context))
  );

  server.registerTool(
    "roon_list_zones",
    {
      title: "List Roon Zones",
      description: "List available Roon zones, now playing metadata and outputs."
    },
    async () => runTool(context, "roon_list_zones", () => listZones(context.roonClient))
  );

  server.registerTool(
    "roon_control_playback",
    {
      title: "Control Roon Playback",
      description: "Send play, pause, playpause, stop, next or previous to a Roon zone.",
      inputSchema: {
        zone_id: z.string().min(1),
        command: z.enum(["play", "pause", "playpause", "stop", "next", "previous"])
      }
    },
    async ({ zone_id, command }) =>
      runTool(context, "roon_control_playback", async () => {
        const parsed = parsePlaybackCommand(command);
        await controlPlayback(context.roonClient, zone_id, parsed);
        return { ok: true, zone_id, command: parsed };
      })
  );

  server.registerTool(
    "roon_change_volume",
    {
      title: "Change Roon Volume",
      description: "Change Roon zone volume using relative or absolute mode when supported.",
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
    "roon_search",
    {
      title: "Search Roon",
      description: "Search the Roon library and Roon-connected services exposed by Roon browse.",
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
      description: "Start playback in a zone from a Roon search query.",
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
      description: "Add a Roon search query next or to the end of the queue.",
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
      description: "List local virtual playlists stored by Roon AI Bridge."
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
      description: "Create a local virtual playlist made of Roon search-query tracks.",
      inputSchema: {
        playlist_id: z.string().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        tracks: z
          .array(
            z.object({
              query: z.string().min(1),
              title: z.string().optional(),
              artist: z.string().optional(),
              album: z.string().optional()
            })
          )
          .optional()
      }
    },
    async (args) =>
      runTool(context, "roon_create_virtual_playlist", () =>
        context.playlistService.createPlaylist(args)
      )
  );

  server.registerTool(
    "roon_add_virtual_playlist_track",
    {
      title: "Add Virtual Playlist Track",
      description: "Add one search-query track to a local virtual playlist.",
      inputSchema: {
        playlist_id: z.string().min(1),
        query: z.string().min(1),
        title: z.string().optional(),
        artist: z.string().optional(),
        album: z.string().optional()
      }
    },
    async ({ playlist_id, ...track }) =>
      runTool(context, "roon_add_virtual_playlist_track", () =>
        context.playlistService.addTrack(playlist_id, track)
      )
  );

  server.registerTool(
    "roon_play_virtual_playlist",
    {
      title: "Play Virtual Playlist",
      description: "Play or enqueue a local virtual playlist in a Roon zone.",
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
}
