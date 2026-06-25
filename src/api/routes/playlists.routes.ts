import { Router } from "express";
import { ApiContext } from "../server";

export function createPlaylistsRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/playlists", (req, res, next) => {
    try {
      res.json(context.playlistService.listPlaylists());
    } catch (error) {
      next(error);
    }
  });

  router.post("/playlists", (req, res, next) => {
    try {
      context.logger.info("Virtual playlist creation request received", {
        name: req.body?.name
      });
      res.status(201).json(context.playlistService.createPlaylist(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.get("/playlists/:playlist_id", (req, res, next) => {
    try {
      res.json(context.playlistService.getPlaylist(req.params.playlist_id));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/playlists/:playlist_id", (req, res, next) => {
    try {
      res.json(context.playlistService.deletePlaylist(req.params.playlist_id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/playlists/:playlist_id/tracks", (req, res, next) => {
    try {
      context.logger.info("Virtual playlist track add request received", {
        playlistId: req.params.playlist_id,
        query: req.body?.query
      });
      res.json(context.playlistService.addTrack(req.params.playlist_id, req.body));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/playlists/:playlist_id/tracks/:track_id", (req, res, next) => {
    try {
      res.json(
        context.playlistService.removeTrack(
          req.params.playlist_id,
          req.params.track_id
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/playlists/:playlist_id/play", async (req, res, next) => {
    try {
      context.logger.info("Virtual playlist playback request received", {
        playlistId: req.params.playlist_id,
        zoneId: req.body?.zone_id,
        mode: req.body?.mode
      });
      res.json(
        await context.playlistService.playPlaylist(
          context.roonClient,
          req.params.playlist_id,
          req.body || {}
        )
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}
