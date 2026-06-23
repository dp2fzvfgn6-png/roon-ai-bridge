import { Router } from "express";
import { ApiContext } from "../server";
import { ApiError } from "../../utils/errors";

export function createLibraryRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/library", (req, res, next) => {
    context.logger.warn("Library browse endpoint is not implemented yet");
    next(new ApiError("NOT_IMPLEMENTED", "Library browse is not implemented in v0.1"));
  });

  router.get("/search", (req, res, next) => {
    context.logger.warn("Search endpoint is not implemented yet", {
      q: req.query.q
    });
    next(new ApiError("NOT_IMPLEMENTED", "Search is not implemented in v0.1"));
  });

  return router;
}
