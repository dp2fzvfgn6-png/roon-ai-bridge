import { Router } from "express";
import { groupZones, ungroupZone } from "../../roon/roonGroupingService";
import { ApiError } from "../../utils/errors";
import { ApiContext } from "../server";

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ApiError(
      "INVALID_ZONE_GROUP",
      "additional_zone_ids must be an array of zone IDs"
    );
  }
  return value;
}

export function createGroupingRouter(context: ApiContext): Router {
  const router = Router();

  router.post("/zones/group", async (req, res, next) => {
    try {
      const primaryZoneId =
        typeof req.body?.primary_zone_id === "string"
          ? req.body.primary_zone_id
          : "";
      const additionalZoneIds = stringArray(req.body?.additional_zone_ids);
      context.logger.info("Zone grouping request received", {
        primaryZoneId,
        additionalZoneIds
      });
      res.json(
        await groupZones(context.roonClient, primaryZoneId, additionalZoneIds)
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/zones/:zone_id/ungroup", async (req, res, next) => {
    try {
      context.logger.info("Zone ungroup request received", {
        zoneId: req.params.zone_id
      });
      res.json(await ungroupZone(context.roonClient, req.params.zone_id));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
