import { Router } from "express";
import {
  MediaActionMode,
  MediaType,
  SourcePreference
} from "../../roon/roonMediaService";
import { ApiError } from "../../utils/errors";
import { ApiContext } from "../server";

const MEDIA_TYPES = new Set<MediaType>(["track", "album", "artist", "playlist"]);
const SOURCE_PREFERENCES = new Set<SourcePreference>([
  "highest_quality",
  "streaming_first",
  "library_first"
]);
const ACTION_MODES = new Set<MediaActionMode>(["replace_queue", "play_next", "append"]);

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseTypes(value: unknown): MediaType[] | undefined {
  if (value === undefined) return undefined;
  const values = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const invalid = values.filter((item) => !MEDIA_TYPES.has(item as MediaType));
  if (invalid.length > 0) {
    throw new ApiError("INVALID_SEARCH_QUERY", "Unsupported media type", {
      invalid,
      allowed: Array.from(MEDIA_TYPES)
    });
  }
  return values as MediaType[];
}

function parseSourcePreference(value: unknown): SourcePreference {
  const preference = optionalString(value) || "highest_quality";
  if (!SOURCE_PREFERENCES.has(preference as SourcePreference)) {
    throw new ApiError("INVALID_SEARCH_QUERY", "Unsupported source preference", {
      allowed: Array.from(SOURCE_PREFERENCES)
    });
  }
  return preference as SourcePreference;
}

function parseMode(value: unknown): MediaActionMode {
  const mode = optionalString(value) || "replace_queue";
  if (!ACTION_MODES.has(mode as MediaActionMode)) {
    throw new ApiError("UNSUPPORTED_COMMAND", "Unsupported media action mode", {
      allowed: Array.from(ACTION_MODES)
    });
  }
  return mode as MediaActionMode;
}

function parseCount(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, max)) : fallback;
}

export function createMediaRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/media/search", async (req, res, next) => {
    try {
      const query = optionalString(req.query.q) || "";
      const types = parseTypes(req.query.types);
      const sourcePreference = parseSourcePreference(req.query.source_preference);
      const count = parseCount(req.query.count, 10, 25);

      context.logger.info("Typed media search received", {
        query,
        types,
        sourcePreference,
        count
      });

      res.json(
        await context.mediaService.search({
          query,
          types,
          zoneId: optionalString(req.query.zone_id),
          count,
          sourcePreference
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/:result_id", (req, res, next) => {
    try {
      res.json(context.mediaService.get(req.params.result_id));
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/:result_id/releases", async (req, res, next) => {
    try {
      res.json(
        await context.mediaService.listArtistReleases(
          req.params.result_id,
          optionalString(req.query.zone_id),
          parseCount(req.query.count, 50, 100)
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/:result_id/play", async (req, res, next) => {
    try {
      const zoneId = optionalString(req.body?.zone_id) || "";
      const mode = parseMode(req.body?.mode);
      context.logger.info("Media action received", {
        resultId: req.params.result_id,
        zoneId,
        mode
      });
      const artistMode = req.body?.artist_mode === "radio" ? "radio" : "catalog";
      res.json(
        await context.mediaService.play(
          req.params.result_id,
          zoneId,
          mode,
          artistMode
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/:result_id/radio", async (req, res, next) => {
    try {
      const zoneId = optionalString(req.body?.zone_id) || "";
      context.logger.info("Artist radio request received", {
        resultId: req.params.result_id,
        zoneId
      });
      res.json(await context.mediaService.startRadio(req.params.result_id, zoneId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
