import { Router } from "express";
import { ApiContext } from "../server";
import {
  changeZoneSettings,
  changeOutputVolume,
  listOutputs,
  muteAll,
  muteOutput,
  outputPowerAction,
  pauseAll,
  restartQueuePlayback,
  seekZone
} from "../../roon/roonAdvancedTransportService";
import { getRoonImage } from "../../roon/roonImageService";

export function createAdvancedRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/outputs", (req, res, next) => {
    try {
      res.json(listOutputs(context.roonClient, {
        includeUnavailable: req.query.include_unavailable !== "false"
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/zones/:zone_id/seek", async (req, res, next) => {
    try {
      res.json(
        await seekZone(
          context.roonClient,
          req.params.zone_id,
          req.body?.mode,
          Number(req.body?.seconds)
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/zones/:zone_id/settings", async (req, res, next) => {
    try {
      res.json(
        await changeZoneSettings(
          context.roonClient,
          req.params.zone_id,
          req.body || {}
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/zones/:zone_id/queue/restart", async (req, res, next) => {
    try {
      res.json(await restartQueuePlayback(context.roonClient, req.params.zone_id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/outputs/:output_id/mute", async (req, res, next) => {
    try {
      res.json(
        await muteOutput(
          context.roonClient,
          req.params.output_id,
          req.body?.action
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/outputs/:output_id/volume", async (req, res, next) => {
    try {
      res.json(
        await changeOutputVolume(
          context.roonClient,
          req.params.output_id,
          req.body?.mode,
          Number(req.body?.value)
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/outputs/:output_id/power", async (req, res, next) => {
    try {
      res.json(
        await outputPowerAction(
          context.roonClient,
          req.params.output_id,
          req.body?.action,
          typeof req.body?.control_key === "string"
            ? req.body.control_key
            : undefined
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/mute-all", async (req, res, next) => {
    try {
      res.json(await muteAll(context.roonClient, req.body?.action));
    } catch (error) {
      next(error);
    }
  });

  router.post("/pause-all", async (_req, res, next) => {
    try {
      res.json(await pauseAll(context.roonClient));
    } catch (error) {
      next(error);
    }
  });

  router.get("/images/:image_key", async (req, res, next) => {
    try {
      const result = await getRoonImage(context.roonClient, req.params.image_key, {
        scale: req.query.scale as any,
        width: Number(req.query.width || 500),
        height: Number(req.query.height || 500),
        format: req.query.format as any
      });
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(result.bytes);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
