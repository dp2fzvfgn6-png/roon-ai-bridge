import { Router } from "express";
import { ApiContext } from "../server";
import { listZones } from "../../roon/roonZoneService";

export function createZonesRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/zones", (req, res, next) => {
    try {
      res.json(listZones(context.roonClient));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
