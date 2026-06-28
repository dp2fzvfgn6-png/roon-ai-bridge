import { Router } from "express";
import { ApiContext } from "../server";
import { ApiError } from "../../utils/errors";
import {
  BrowseHierarchy,
  browseLibrary,
  searchRoon
} from "../../roon/roonBrowseService";

const ALLOWED_HIERARCHIES = new Set([
  "browse",
  "internet_radio",
  "albums",
  "artists",
  "genres",
  "composers",
  "playlists"
]);

function stringQuery(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function boolQuery(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  return fallback;
}

function intQuery(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function hierarchyQuery(value: unknown): BrowseHierarchy {
  const hierarchy = stringQuery(value) || "browse";
  if (!ALLOWED_HIERARCHIES.has(hierarchy)) {
    throw new ApiError("NOT_IMPLEMENTED", "Browse hierarchy is not supported in v0.3", {
      hierarchy,
      allowed: Array.from(ALLOWED_HIERARCHIES)
    });
  }
  return hierarchy as BrowseHierarchy;
}

export function createLibraryRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/library", async (req, res, next) => {
    try {
      const itemKey = stringQuery(req.query.item_key);
      const popLevelsValue = req.query.pop_levels;
      const popLevels =
        popLevelsValue === undefined
          ? undefined
          : intQuery(popLevelsValue, 1, 1, 20);

      const request = {
        hierarchy: hierarchyQuery(req.query.hierarchy),
        itemKey,
        zoneOrOutputId: stringQuery(req.query.zone_id),
        offset: intQuery(req.query.offset, 0, 0, 100000),
        count: intQuery(req.query.count, 100, 1, 500),
        popAll: boolQuery(req.query.pop_all, !itemKey && popLevels === undefined),
        popLevels,
        refreshList: boolQuery(req.query.refresh_list, false),
        sessionKey: stringQuery(req.query.session_key) || "roon-ai-bridge-http"
      };

      context.logger.info("Library browse request received", {
        hierarchy: request.hierarchy,
        hasItemKey: Boolean(request.itemKey),
        offset: request.offset,
        count: request.count
      });

      res.json(await browseLibrary(context.roonClient, request));
    } catch (error) {
      next(error);
    }
  });

  router.get("/search", async (req, res, next) => {
    try {
      const query = stringQuery(req.query.q);
      const request = {
        query: query || "",
        zoneOrOutputId: stringQuery(req.query.zone_id),
        offset: intQuery(req.query.offset, 0, 0, 100000),
        count: intQuery(req.query.count, 25, 1, 100),
        sessionKey: stringQuery(req.query.session_key) || "roon-ai-bridge-search"
      };

      context.logger.info("Search request received", {
        query: request.query,
        hasZoneId: Boolean(request.zoneOrOutputId),
        offset: request.offset,
        count: request.count
      });

      res.json(await searchRoon(context.roonClient, request));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
