import { Router } from "express";
import { ApiContext } from "../server";

export function createRoonRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/status", (req, res) => {
    res.json({
      core_connected: context.roonClient.isCoreConnected(),
      core_name: context.roonClient.getCoreName(),
      transport_ready: context.roonClient.isTransportReady(),
      zones_count: context.roonClient.getZones().length
    });
  });

  router.get("/capabilities", (req, res) => {
    res.json({
      implemented: {
        zones: true,
        transport: true,
        volume: true,
        browse: false,
        search: false,
        queue: false,
        virtual_playlists: false,
        mcp: false,
        auth: false
      },
      planned: [
        "library_browse",
        "music_search",
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
