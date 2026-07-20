import { Router } from "express";
import { ApplicationContext } from "../../app/context";
import { APP_VERSION } from "../../config/version";
import { ApiError } from "../../utils/errors";

export function createPortalDashboardRouter(context: ApplicationContext): Router {
  const router = Router();

  router.get("/api/dashboard", (_req, res) => {
    const zones = context.roonClient.getZones();
    const playlists = context.playlistService.listPlaylists({ includeTracks: false, limit: 100, offset: 0 });
    const apiKeys = context.apiKeyService.list();
    const actions = context.actionLogService.list({ limit: 5 }) as any;
    const errors = context.technicalLogService.errors(5) as any;
    const manifest = context.diagnosticsService.bundle({
      include_recent_actions: false,
      include_recent_errors: false,
      include_tool_schemas: false
    }) as any;
    const recentPlaylists = [...playlists.playlists]
      .filter((playlist: any) => playlist.last_played_at)
      .sort((left: any, right: any) => String(right.last_played_at).localeCompare(String(left.last_played_at)))
      .slice(0, 6);
    const listeningHistory = context.homeHistoryService.list({ eventType: "play", limit: 5 }) as any;
    const searchHistory = context.homeHistoryService.list({ eventType: "search", limit: 5 }) as any;

    res.json({
      version: APP_VERSION,
      status: {
        core_connected: context.roonClient.isCoreConnected(),
        core_name: context.roonClient.getCoreName(),
        transport_ready: context.roonClient.isTransportReady(),
        browse_ready: context.config.enableBrowse && context.roonClient.isBrowseReady()
      },
      counts: {
        zones: zones.length,
        playing_zones: zones.filter((zone) => zone.state === "playing").length,
        playlists: playlists.total,
        playlist_tracks: playlists.playlists.reduce((total, playlist) => total + playlist.tracks_count, 0),
        active_api_keys: apiKeys.filter((key) => !key.revoked_at).length,
        mcp_tools: manifest?.mcp?.tools_count || 0,
        recent_errors: errors?.count || 0
      },
      extension_manager: context.extensionManagerService.status(),
      recent_actions: actions?.actions || [],
      recent_errors: errors?.errors || [],
      recent_playlists: recentPlaylists,
      recent_listening_history: listeningHistory?.entries || [],
      recent_search_history: searchHistory?.entries || [],
      history_totals: { play: listeningHistory?.total || 0, search: searchHistory?.total || 0 },
      now_playing: zones
        .filter((zone) => zone.state === "playing")
        .map((zone) => ({
          zone_id: zone.zone_id,
          display_name: zone.display_name,
          title: zone.now_playing?.three_line?.line1 || null,
          artist: zone.now_playing?.three_line?.line2 || null
        }))
    });
  });

  router.get("/api/history", (req, res) => {
    const eventType = req.query.type;
    if (eventType !== undefined && eventType !== "search" && eventType !== "play") {
      throw new ApiError("VALIDATION_ERROR", "type must be search or play");
    }
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    res.json(context.homeHistoryService.list({
      eventType: eventType as "search" | "play" | undefined,
      limit,
      offset
    }));
  });

  router.post("/api/history", (req, res, next) => {
    try {
      const eventType = req.body?.event_type;
      if (eventType !== "search" && eventType !== "play") {
        throw new ApiError("VALIDATION_ERROR", "event_type must be search or play");
      }
      res.status(201).json(context.homeHistoryService.record({ ...req.body, event_type: eventType }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
