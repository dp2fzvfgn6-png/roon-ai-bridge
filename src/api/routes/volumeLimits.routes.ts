import { Router } from "express";
import { ApiContext } from "../server";

export function createVolumeLimitsRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/volume-limits", (_req, res) => {
    res.json(context.volumeLimitService.list());
  });

  router.post("/volume-limits", (req, res, next) => {
    try {
      res.status(201).json(context.volumeLimitService.create(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.get("/volume-limits/:limit_id", (req, res, next) => {
    try {
      res.json(context.volumeLimitService.get(req.params.limit_id));
    } catch (error) {
      next(error);
    }
  });

  router.put("/volume-limits/:limit_id", (req, res, next) => {
    try {
      res.json(context.volumeLimitService.update(req.params.limit_id, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/volume-limits/:limit_id", (req, res, next) => {
    try {
      res.json(context.volumeLimitService.update(req.params.limit_id, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/volume-limits/:limit_id", (req, res, next) => {
    try {
      context.volumeLimitService.delete(req.params.limit_id);
      res.json({ ok: true, limit_id: req.params.limit_id });
    } catch (error) {
      next(error);
    }
  });

  router.post("/volume-limits/evaluate", (req, res, next) => {
    try {
      res.json(context.volumeLimitService.evaluate(context.roonClient, {
        target_ref: req.body?.target_ref,
        requested_volume: req.body?.requested_volume,
        at: req.body?.at
      }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
