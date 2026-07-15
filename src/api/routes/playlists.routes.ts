import { Router } from "express";
import { ApiContext } from "../server";
import {
  confirmationRequiredResponse,
  dryRunResponse,
  mutationSuccess
} from "../../safety/actionSafety";

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

  router.get("/playlists/covers/:cover_id", (req, res, next) => {
    try {
      const cover = context.playlistService.getCustomCover(req.params.cover_id);
      res.setHeader("Content-Type", cover.content_type);
      res.setHeader("Cache-Control", "private, max-age=86400, immutable");
      res.send(cover.bytes);
    } catch (error) {
      next(error);
    }
  });

  router.post("/playlists/:playlist_id/cover", async (req, res, next) => {
    try {
      context.logger.info("Virtual playlist custom cover upload received", {
        playlistId: req.params.playlist_id,
        contentType: req.body?.content_type || String(req.body?.data_url || "").slice(5, 30)
      });
      res.json(await context.playlistService.setCustomCover(req.params.playlist_id, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/playlists/:playlist_id/cover", (req, res, next) => {
    try {
      res.json(context.playlistService.clearCustomCover(req.params.playlist_id));
    } catch (error) {
      next(error);
    }
  });

  router.get("/playlists/:playlist_id", (req, res, next) => {
    try {
      res.json(
        context.playlistService.getPlaylistDetail(req.params.playlist_id, {
          includeTracks: parseBoolean(req.query.include_tracks, true),
          limit: parsePageNumber(req.query.limit, 50),
          offset: parsePageNumber(req.query.offset, 0)
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.delete("/playlists/:playlist_id", (req, res, next) => {
    try {
      const dryRun = parseBoolean(req.query.dry_run ?? req.body?.dry_run, false);
      const confirm = parseBoolean(req.query.confirm ?? req.body?.confirm, false);
      if (dryRun) {
        const before = context.playlistService.getPlaylist(req.params.playlist_id);
        res.json(dryRunResponse("roon_delete_virtual_playlist", {
          before,
          after: null
        }, { before }));
        return;
      }
      if (!confirm) {
        res.json(
          confirmationRequiredResponse(
            "roon_delete_virtual_playlist",
            "destructive_action",
            "This action deletes a virtual playlist and requires confirmation.",
            { playlist_id: req.params.playlist_id },
            { playlist_id: req.params.playlist_id },
            "Delete virtual playlist."
          )
        );
        return;
      }
      const before = context.playlistService.getPlaylist(req.params.playlist_id);
      const result = context.playlistService.deletePlaylist(req.params.playlist_id);
      res.json(mutationSuccess("roon_delete_virtual_playlist", result, { before, after: null }));
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
      const dryRun = parseBoolean(req.body?.dry_run, false);
      const confirm = parseBoolean(req.body?.confirm, false);
      const tracks = req.body?.tracks ?? req.body;
      const before = context.playlistService.getPlaylist(req.params.playlist_id);
      if (dryRun) {
        res.json(dryRunResponse("roon_replace_virtual_playlist_tracks", {
          before,
          after: {
            playlist_id: req.params.playlist_id,
            tracks_count: Array.isArray(tracks) ? tracks.length : 0,
            tracks
          }
        }, { before }));
        return;
      }
      if (!confirm) {
        res.json(
          confirmationRequiredResponse(
            "roon_replace_virtual_playlist_tracks",
            "destructive_action",
            "This action replaces all tracks in a virtual playlist and requires confirmation.",
            {
              playlist_id: req.params.playlist_id,
              replacement_track_count: Array.isArray(tracks) ? tracks.length : null
            },
            { playlist_id: req.params.playlist_id, tracks },
            "Replace all tracks in virtual playlist."
          )
        );
        return;
      }
      res.json(
        await context.playlistService.replaceTracksResolved(
          req.params.playlist_id,
          tracks,
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

  router.post(["/playlists/:playlist_id/resolve", "/virtual-playlists/:playlist_id/resolve"], async (req, res, next) => {
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

  router.get(["/playlists/:playlist_id/validate", "/virtual-playlists/:playlist_id/validate"], (req, res, next) => {
    try {
      res.json(context.playlistService.validatePlaylist(req.params.playlist_id));
    } catch (error) {
      next(error);
    }
  });

  router.post(["/playlists/:playlist_id/deduplicate", "/virtual-playlists/:playlist_id/deduplicate"], (req, res, next) => {
    try {
      res.json(context.playlistService.deduplicatePlaylist(req.params.playlist_id, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post(["/playlists/:playlist_id/sort", "/virtual-playlists/:playlist_id/sort"], (req, res, next) => {
    try {
      res.json(context.playlistService.sortPlaylist(req.params.playlist_id, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.get(["/playlists/:playlist_id/export", "/virtual-playlists/:playlist_id/export"], (req, res, next) => {
    try {
      const format = String(req.query.format || "json");
      const payload = context.playlistService.exportPlaylist(req.params.playlist_id, format);
      if (typeof payload === "string") {
        res.type(format === "csv" ? "text/csv" : "audio/x-mpegurl").send(payload);
        return;
      }
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.post(["/playlists/import", "/virtual-playlists/import"], (req, res, next) => {
    try {
      res.json(context.playlistService.importPlaylist(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post(["/playlists/:playlist_id/tracks/:track_id/match", "/virtual-playlists/:playlist_id/tracks/:track_id/match"], (req, res, next) => {
    try {
      res.json(context.playlistService.setTrackMatch(
        req.params.playlist_id,
        req.params.track_id,
        req.body?.result_id,
        {
          mediaService: context.mediaService,
          selectionReason: req.body?.selection_reason
        }
      ));
    } catch (error) {
      next(error);
    }
  });

  router.post(["/playlists/:playlist_id/tracks/from-search-result", "/virtual-playlists/:playlist_id/tracks/from-search-result"], (req, res, next) => {
    try {
      res.json(context.playlistService.addSearchResultToPlaylist(
        req.params.playlist_id,
        req.body || {},
        context.mediaService
      ));
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
      const dryRun = parseBoolean(req.query.dry_run ?? req.body?.dry_run, false);
      const confirm = parseBoolean(req.query.confirm ?? req.body?.confirm, false);
      const before = context.playlistService.getPlaylist(req.params.playlist_id);
      if (dryRun) {
        res.json(dryRunResponse("roon_remove_virtual_playlist_track", {
          before,
          after: {
            ...before,
            tracks: before.tracks.filter((track) => track.track_id !== req.params.track_id),
            tracks_count: Math.max(0, before.tracks_count - 1),
            track_count: Math.max(0, before.track_count - 1)
          }
        }, { before }));
        return;
      }
      if (!confirm) {
        res.json(
          confirmationRequiredResponse(
            "roon_remove_virtual_playlist_track",
            "destructive_action",
            "This action deletes a track from a virtual playlist and requires confirmation.",
            {
              playlist_id: req.params.playlist_id,
              track_id: req.params.track_id
            },
            {
              playlist_id: req.params.playlist_id,
              track_id: req.params.track_id
            },
            "Remove track from virtual playlist."
          )
        );
        return;
      }
      const result = context.playlistService.removeTrack(
        req.params.playlist_id,
        req.params.track_id
      );
      res.json(mutationSuccess("roon_remove_virtual_playlist_track", result, { before, after: result }));
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
          req.body || {},
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

  return router;
}
