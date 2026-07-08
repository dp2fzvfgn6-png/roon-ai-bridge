import { Router } from "express";
import { ApiContext } from "../server";

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return fallback;
}

function parsePageNumber(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createPlaylistsRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/playlists", (req, res, next) => {
    try {
      res.json(
        context.playlistService.listPlaylists({
          includeTracks: parseBoolean(req.query.include_tracks, false),
          limit: parsePageNumber(req.query.limit, 25),
          offset: parsePageNumber(req.query.offset, 0),
          trackLimit: parsePageNumber(req.query.track_limit, 25),
          trackOffset: parsePageNumber(req.query.track_offset, 0)
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/playlists", async (req, res, next) => {
    try {
      context.logger.info("Virtual playlist creation request received", {
        name: req.body?.name
      });
      res.status(201).json(
        await context.playlistService.createPlaylistResolved(req.body || {}, {
          mediaService: context.mediaService,
          logger: context.logger
        })
      );
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

  router.patch("/playlists/:playlist_id", (req, res, next) => {
    try {
      res.json(
        context.playlistService.updatePlaylist(req.params.playlist_id, req.body || {})
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/playlists/:playlist_id/tracks", async (req, res, next) => {
    try {
      context.logger.info("Virtual playlist track add request received", {
        playlistId: req.params.playlist_id,
        query: req.body?.query
      });
      res.json(
        await context.playlistService.addTrackResolved(
          req.params.playlist_id,
          req.body,
          {
            mediaService: context.mediaService,
            logger: context.logger
          }
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.put("/playlists/:playlist_id/tracks", async (req, res, next) => {
    try {
      res.json(
        await context.playlistService.replaceTracksResolved(
          req.params.playlist_id,
          req.body?.tracks ?? req.body,
          {
            mediaService: context.mediaService,
            logger: context.logger
          }
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/playlists/:playlist_id/resolve", async (req, res, next) => {
    try {
      context.logger.info("Virtual playlist resolution retry received", {
        playlistId: req.params.playlist_id,
        force: req.body?.force
      });
      res.json(
        await context.playlistService.resolveVirtualPlaylistItems(
          req.params.playlist_id,
          {
            mediaService: context.mediaService,
            logger: context.logger,
            force: Boolean(req.body?.force),
            sourcePreference: req.body?.source_preference
          }
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/playlists/:playlist_id/tracks/reorder", (req, res, next) => {
    try {
      res.json(
        context.playlistService.reorderTracks(
          req.params.playlist_id,
          req.body?.track_ids
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.patch("/playlists/:playlist_id/tracks/:track_id", (req, res, next) => {
    try {
      res.json(
        context.playlistService.updateTrack(
          req.params.playlist_id,
          req.params.track_id,
          req.body || {}
        )
      );
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
