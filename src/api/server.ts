import express, { NextFunction, Request, Response } from "express";
import { AppConfig } from "../config/env";
import { RoonClient } from "../roon/roonClient";
import { Logger } from "../utils/logger";
import { ApiError, sendError } from "../utils/errors";
import { createHealthRouter } from "./routes/health.routes";
import { createRoonRouter } from "./routes/roon.routes";
import { createZonesRouter } from "./routes/zones.routes";
import { createPlaybackRouter } from "./routes/playback.routes";
import { createVolumeRouter } from "./routes/volume.routes";
import { createLibraryRouter } from "./routes/library.routes";
import { createQueueRouter } from "./routes/queue.routes";
import { createPlaylistsRouter } from "./routes/playlists.routes";

export type ApiContext = {
  config: AppConfig;
  logger: Logger;
  roonClient: RoonClient;
};

export function createServer(context: ApiContext): express.Express {
  const app = express();

  app.use(express.json());
  app.use(createHealthRouter());
  app.use("/roon", createRoonRouter(context));
  app.use("/roon", createZonesRouter(context));
  app.use("/roon", createPlaybackRouter(context));
  app.use("/roon", createVolumeRouter(context));
  app.use("/roon", createLibraryRouter(context));
  app.use("/roon", createQueueRouter(context));
  app.use("/", createPlaylistsRouter(context));

  app.get("/history", (req, res, next) => {
    context.logger.warn("History endpoint is not implemented yet");
    next(new ApiError("NOT_IMPLEMENTED", "History is not implemented in v0.2"));
  });

  app.get("/preferences", (req, res, next) => {
    context.logger.warn("Preferences endpoint is not implemented yet");
    next(new ApiError("NOT_IMPLEMENTED", "Preferences are not implemented in v0.2"));
  });

  app.use((req, res, next) => {
    next(new ApiError("NOT_IMPLEMENTED", "Endpoint is not implemented in v0.2", {
      method: req.method,
      path: req.path
    }));
  });

  app.use(
    (error: Error, req: Request, res: Response, next: NextFunction): void => {
      if (res.headersSent) {
        next(error);
        return;
      }

      if (error instanceof ApiError) {
        if (error.code !== "NOT_IMPLEMENTED") {
          context.logger.warn("API validation or Roon error", {
            code: error.code,
            message: error.message,
            details: error.details
          });
        }
        sendError(res, error);
        return;
      }

      context.logger.error("Unhandled API error", {
        message: error.message,
        stack: error.stack
      });

      sendError(
        res,
        new ApiError("INTERNAL_ERROR", "Internal server error", {}, 500)
      );
    }
  );

  return app;
}
