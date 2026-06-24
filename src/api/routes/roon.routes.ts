import { Router } from "express";
import { ApiContext } from "../server";
import { browseImplemented } from "../../roon/roonBrowseService";

export function createRoonRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/status", (req, res) => {
    res.json({
      core_connected: context.roonClient.isCoreConnected(),
      core_name: context.roonClient.getCoreName(),
      transport_ready: context.roonClient.isTransportReady(),
      browse_ready: context.config.enableBrowse && context.roonClient.isBrowseReady(),
      zones_count: context.roonClient.getZones().length
    });
  });

  router.get("/capabilities", (req, res) => {
    res.json({
      implemented: {
        zones: true,
        transport: true,
        volume: true,
        browse: context.config.enableBrowse && browseImplemented,
        search: context.config.enableBrowse && browseImplemented,
        queue: false,
        virtual_playlists: false,
        mcp: false,
        auth: false
      },
      planned: [
        "library_browse",
        "music_search",
        "play_by_query",
        "queue_management",
        "virtual_playlists",
        "mcp_tools",
        "auth",
        "cloudflare_tunnel",
        "chatgpt_app"
      ]
    });
  });

  return router;
}
