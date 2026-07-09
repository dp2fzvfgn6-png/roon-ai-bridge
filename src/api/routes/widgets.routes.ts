import { Router } from "express";
import { ApiContext } from "../server";
import { MediaType } from "../../roon/roonMediaService";
import { WidgetService } from "../../services/widgetService";

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTypes(value: unknown): MediaType[] | undefined {
  if (!value) return undefined;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as MediaType[];
}

function widgetService(context: ApiContext): WidgetService {
  return new WidgetService({
    roonClient: context.roonClient,
    playlistService: context.playlistService,
    mediaService: context.mediaService,
    volumeLimitService: context.volumeLimitService,
    publicBaseUrl: context.config.publicBaseUrl
  });
}

export function createWidgetsRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/widgets/now-playing", (req, res, next) => {
    try {
      res.json(widgetService(context).getNowPlaying({
        selected_zone_id: typeof req.query.zone_id === "string" ? req.query.zone_id : undefined
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/widgets/now-playing/action", async (req, res, next) => {
    try {
      res.json(await widgetService(context).nowPlayingAction(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.get("/widgets/playlists", (req, res, next) => {
    try {
      res.json(widgetService(context).getPlaylists({
        limit: parseNumber(req.query.limit, 25),
        offset: parseNumber(req.query.offset, 0)
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/widgets/playlists/:playlist_id", (req, res, next) => {
    try {
      res.json(widgetService(context).getPlaylistDetail({
        playlist_id: req.params.playlist_id,
        limit: parseNumber(req.query.limit, 25),
        offset: parseNumber(req.query.offset, 0)
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/widgets/playlists/action", async (req, res, next) => {
    try {
      res.json(await widgetService(context).playlistAction(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.get("/widgets/search", async (req, res, next) => {
    try {
      res.json(await widgetService(context).getMediaSearch({
        query: typeof req.query.q === "string" ? req.query.q : "",
        types: parseTypes(req.query.types),
        zone_id: typeof req.query.zone_id === "string" ? req.query.zone_id : undefined,
        count: parseNumber(req.query.count, 10)
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/widgets/search", async (req, res, next) => {
    try {
      res.json(await widgetService(context).getMediaSearch(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post("/widgets/search/action", async (req, res, next) => {
    try {
      res.json(await widgetService(context).mediaSearchAction(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/albums/:result_id", (req, res, next) => {
    try {
      res.json(widgetService(context).getMediaEntity({ result_id: req.params.result_id }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/artists/:result_id", (req, res, next) => {
    try {
      res.json(widgetService(context).getMediaEntity({ result_id: req.params.result_id }));
    } catch (error) {
      next(error);
    }
  });

  router.get(["/roon/images/:image_key", "/media/images/:image_key"], async (req, res, next) => {
    try {
      const image = await widgetService(context).getImage(req.params.image_key, {
        width: parseNumber(req.query.width, 320),
        height: parseNumber(req.query.height, 320)
      });
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.type(image.contentType).send(image.bytes);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
