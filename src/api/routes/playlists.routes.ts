import { Router } from "express";
import { ApiContext } from "../server";
import { ApiError } from "../../utils/errors";

export function createPlaylistsRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/playlists", (req, res, next) => {
    context.logger.warn("Virtual playlists endpoint is not implemented yet");
    next(
      new ApiError("NOT_IMPLEMENTED", "Virtual playlists are not implemented in v0.4")
    );
  });

  router.post("/playlists", (req, res, next) => {
    context.logger.warn("Virtual playlist creation endpoint is not implemented yet");
    next(
      new ApiError(
        "NOT_IMPLEMENTED",
        "Virtual playlist creation is not implemented in v0.4"
      )
    );
  });

  router.post("/playlists/:playlist_id/play", (req, res, next) => {
    context.logger.warn("Virtual playlist playback endpoint is not implemented yet", {
      playlistId: req.params.playlist_id
    });
    next(
      new ApiError(
        "NOT_IMPLEMENTED",
        "Virtual playlist playback is not implemented in v0.4"
      )
    );
  });

  return router;
}
