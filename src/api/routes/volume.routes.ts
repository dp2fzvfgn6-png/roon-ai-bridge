import { Router } from "express";
import { ApiContext } from "../server";
import { changeZoneVolume } from "../../roon/roonVolumeService";
import { parseVolumeMode, parseVolumeValue } from "../../utils/validation";

function parseBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

export function createVolumeRouter(context: ApiContext): Router {
  const router = Router();

  router.post("/zones/:zone_id/volume", async (req, res, next) => {
    try {
      const mode = parseVolumeMode(req.body?.mode);
      const value = parseVolumeValue(req.body?.value);

      context.logger.info("Volume command received", {
        zoneId: req.params.zone_id,
        mode,
        value
      });
      if (mode === "absolute") {
        context.outputVolumeSettingsService.validateZoneAbsoluteValue(
          context.roonClient,
          req.params.zone_id,
          value
        );
      }

      const result = await changeZoneVolume(
        context.roonClient,
        req.params.zone_id,
        mode,
        value,
        {
          dryRun: parseBoolean(req.body?.dry_run),
          confirm: parseBoolean(req.body?.confirm),
          volumeLimits: context.volumeLimitService.activeSafetyLimits()
        }
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
