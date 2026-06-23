import { Router } from "express";
import { ApiContext } from "../server";
import { controlPlayback } from "../../roon/roonPlaybackService";
import { parsePlaybackCommand } from "../../utils/validation";
import { ApiError } from "../../utils/errors";

export function createPlaybackRouter(context: ApiContext): Router {
  const router = Router();

  router.post("/zones/:zone_id/control", async (req, res, next) => {
    try {
      const command = parsePlaybackCommand(req.body?.command);
      context.logger.info("Playback command received", {
        zoneId: req.params.zone_id,
        command
      });

      await controlPlayback(context.roonClient, req.params.zone_id, command);
      res.json({ ok: true, zone_id: req.params.zone_id, command });
    } catch (error) {
      next(error);
    }
  });

  router.post("/play", (req, res, next) => {
    context.logger.warn("Play by query endpoint is not implemented yet");
    next(new ApiError("NOT_IMPLEMENTED", "Play by query is not implemented in v0.1"));
  });

  return router;
}
