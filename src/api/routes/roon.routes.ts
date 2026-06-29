import { Router } from "express";
import { ApiContext } from "../server";
import { browseImplemented } from "../../roon/roonBrowseService";
import { queueImplemented } from "../../roon/roonQueueService";
import { playlistServiceImplemented } from "../../services/playlistService";

export function createRoonRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/status", (req, res) => {
    res.json({
      core_connected: context.roonClient.isCoreConnected(),
      core_name: context.roonClient.getCoreName(),
      transport_ready: context.roonClient.isTransportReady(),
      browse_ready: context.config.enableBrowse && context.roonClient.isBrowseReady(),
      image_ready: context.roonClient.isImageReady(),
      zones_count: context.roonClient.getZones().length,
      outputs_count: context.roonClient.getOutputs().length
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
        typed_search: context.config.enableBrowse && browseImplemented,
        media_references: true,
        artist_radio: true,
        zone_grouping: true,
        outputs: true,
        seek: true,
        mute: true,
        standby: true,
        transport_settings: true,
        images: context.roonClient.isImageReady(),
        generic_browse_actions: true,
        zone_presets: true,
        output_volume_settings: true,
        queue: queueImplemented,
        virtual_playlists: playlistServiceImplemented,
        mcp: true,
        auth: context.config.enableAuth,
        oauth: true,
        chatgpt_app: true
      },
      planned: [
        "cloudflare_tunnel",
        "tidal_playlist_sync",
        "listening_history",
        "preferences"
      ]
    });
  });

  return router;
}
