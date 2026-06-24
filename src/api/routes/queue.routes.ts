import { Router } from "express";
import { ApiContext } from "../server";
import { ApiError } from "../../utils/errors";
import {
  getQueueSnapshot,
  playQueueItemFromHere,
  QueueAction
} from "../../roon/roonQueueService";
import { queueByQuery } from "../../roon/roonBrowseService";

function stringBody(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function intQuery(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseQueueAction(value: unknown): QueueAction {
  if (
    value === "play_from_here" ||
    value === "add_next" ||
    value === "add_to_queue"
  ) {
    return value;
  }

  throw new ApiError("INVALID_QUEUE_ACTION", "Unsupported queue action", {
    allowed: ["play_from_here", "add_next", "add_to_queue"]
  });
}

export function createQueueRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/queue/:zone_id", async (req, res, next) => {
    try {
      const maxItemCount = intQuery(req.query.max_item_count, 50, 1, 500);

      context.logger.info("Queue read request received", {
        zoneId: req.params.zone_id,
        maxItemCount
      });

      res.json(
        await getQueueSnapshot(
          context.roonClient,
          req.params.zone_id,
          maxItemCount
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/queue/:zone_id", async (req, res, next) => {
    try {
      const action = parseQueueAction(req.body?.action);

      context.logger.info("Queue mutation request received", {
        zoneId: req.params.zone_id,
        action
      });

      if (action === "play_from_here") {
        res.json(
          await playQueueItemFromHere(
            context.roonClient,
            req.params.zone_id,
            req.body?.queue_item_id
          )
        );
        return;
      }

      res.json(
        await queueByQuery(context.roonClient, {
          zoneId: req.params.zone_id,
          query: stringBody(req.body?.query) || "",
          mode: action,
          sessionKey: stringBody(req.body?.session_key)
        })
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}
