import { Router } from "express";
import { ApiContext } from "../server";
import { changeZoneVolume } from "../../roon/roonVolumeService";
import { parseVolumeMode, parseVolumeValue } from "../../utils/validation";

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

      const outputs = await changeZoneVolume(
        context.roonClient,
        req.params.zone_id,
        mode,
        value
      );

      res.json({
        ok: true,
        zone_id: req.params.zone_id,
        mode,
        value,
        outputs_changed: outputs.map((output) => ({
          output_id: output.output_id,
          display_name: output.display_name
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
