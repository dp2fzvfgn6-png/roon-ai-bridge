import { Router } from "express";
import { ApplicationContext } from "../../app/context";

export function createPortalAudioAdminRouter(context: ApplicationContext): Router {
  const router = Router();

  router.get("/api/admin/zone-presets", (_req, res) => res.json(context.zonePresetService.list()));

  router.post("/api/admin/zone-presets", (req, res, next) => {
    try {
      res.status(201).json(context.zonePresetService.create(context.roonClient, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/admin/zone-presets/:preset_id", (req, res, next) => {
    try {
      res.json(context.zonePresetService.update(req.params.preset_id, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/admin/zone-presets/:preset_id", (req, res, next) => {
    try {
      context.zonePresetService.delete(req.params.preset_id);
      res.json({ ok: true, preset_id: req.params.preset_id });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/admin/zone-presets/:preset_id/apply", async (req, res, next) => {
    try {
      res.json(await context.zonePresetService.apply(context.roonClient, req.params.preset_id, {
        dryRun: req.body?.dry_run === true,
        confirm: req.body?.confirm === true,
        volumeLimitService: context.volumeLimitService
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/admin/output-volumes", (_req, res) => {
    res.json(context.outputVolumeSettingsService.list(context.roonClient));
  });

  router.put("/api/admin/output-volumes/:output_id", (req, res, next) => {
    try {
      res.json(context.outputVolumeSettingsService.save(context.roonClient, req.params.output_id, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/admin/output-volumes/:output_id/apply", async (req, res, next) => {
    try {
      res.json(await context.outputVolumeSettingsService.applyPreferred(context.roonClient, req.params.output_id));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
