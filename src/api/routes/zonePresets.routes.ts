import { Router } from "express";
import { ApiContext } from "../server";

function parseBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

export function createZonePresetsRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/zone-presets", (_req, res) => {
    res.json(context.zonePresetService.list());
  });

  router.post("/zone-presets", (req, res, next) => {
    try {
      res.status(201).json(context.zonePresetService.create(context.roonClient, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.get("/zone-presets/:preset_id", (req, res, next) => {
    try {
      res.json(context.zonePresetService.get(req.params.preset_id));
    } catch (error) {
      next(error);
    }
  });

  router.put("/zone-presets/:preset_id", (req, res, next) => {
    try {
      res.json(context.zonePresetService.update(req.params.preset_id, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/zone-presets/:preset_id", (req, res, next) => {
    try {
      res.json(context.zonePresetService.update(req.params.preset_id, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/zone-presets/:preset_id", (req, res, next) => {
    try {
      context.zonePresetService.delete(req.params.preset_id);
      res.json({ ok: true, preset_id: req.params.preset_id });
    } catch (error) {
      next(error);
    }
  });

  router.post("/zone-presets/:preset_id/apply", async (req, res, next) => {
    try {
      res.json(await context.zonePresetService.apply(context.roonClient, req.params.preset_id, {
        dryRun: parseBoolean(req.body?.dry_run),
        confirm: parseBoolean(req.body?.confirm),
        volumeLimitService: context.volumeLimitService
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/zone-presets/:preset_id/dry-run", async (req, res, next) => {
    try {
      res.json(await context.zonePresetService.apply(context.roonClient, req.params.preset_id, {
        dryRun: true,
        volumeLimitService: context.volumeLimitService
      }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
