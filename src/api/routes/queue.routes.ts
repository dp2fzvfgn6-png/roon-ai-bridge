import { Router } from "express";
import { ApiContext } from "../server";
import { ApiError } from "../../utils/errors";

export function createQueueRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/queue/:zone_id", (req, res, next) => {
    context.logger.warn("Queue read endpoint is not implemented yet", {
      zoneId: req.params.zone_id
    });
    next(new ApiError("NOT_IMPLEMENTED", "Queue read is not implemented in v0.2"));
  });

  router.post("/queue/:zone_id", (req, res, next) => {
    context.logger.warn("Queue mutation endpoint is not implemented yet", {
      zoneId: req.params.zone_id
    });
    next(new ApiError("NOT_IMPLEMENTED", "Queue mutation is not implemented in v0.2"));
  });

  return router;
}
