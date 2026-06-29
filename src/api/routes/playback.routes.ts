import { Router } from "express";
import { ApiContext } from "../server";
import { controlPlayback } from "../../roon/roonPlaybackService";
import { playByQuery } from "../../roon/roonBrowseService";
import { transferZonePlayback } from "../../roon/roonTransferService";
import { parsePlaybackCommand } from "../../utils/validation";

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

  router.post("/play", async (req, res, next) => {
    try {
      const zoneId = typeof req.body?.zone_id === "string" ? req.body.zone_id : "";
      const query = typeof req.body?.query === "string" ? req.body.query : "";
      const sessionKey =
        typeof req.body?.session_key === "string" ? req.body.session_key : undefined;

      context.logger.info("Play by query request received", {
        zoneId,
        query
      });

      res.json(
        await playByQuery(context.roonClient, {
          zoneId,
          query,
          sessionKey
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/zones/transfer", async (req, res, next) => {
    try {
      const sourceZoneId =
        typeof req.body?.source_zone_id === "string" ? req.body.source_zone_id : "";
      const targetZoneId =
        typeof req.body?.target_zone_id === "string" ? req.body.target_zone_id : "";

      context.logger.info("Zone playback transfer received", {
        sourceZoneId,
        targetZoneId
      });

      res.json(
        await transferZonePlayback(context.roonClient, sourceZoneId, targetZoneId)
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}
