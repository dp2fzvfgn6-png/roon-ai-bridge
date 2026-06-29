import path from "path";
import express, { NextFunction, Request, Response } from "express";
import { ApiContext } from "../api/server";
import { getBearerToken, tokenMatches } from "../api/middleware/auth";
import { createRoonRouter } from "../api/routes/roon.routes";
import { createZonesRouter } from "../api/routes/zones.routes";
import { createPlaybackRouter } from "../api/routes/playback.routes";
import { createGroupingRouter } from "../api/routes/grouping.routes";
import { createVolumeRouter } from "../api/routes/volume.routes";
import { createQueueRouter } from "../api/routes/queue.routes";
import { createPlaylistsRouter } from "../api/routes/playlists.routes";
import { createLibraryRouter } from "../api/routes/library.routes";
import { createMediaRouter } from "../api/routes/media.routes";
import { ApiError, sendError } from "../utils/errors";
import { APP_VERSION } from "../config/version";

function createPortalAuth(context: ApiContext) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const provided = getBearerToken(req);
    if (!provided) {
      next(new ApiError("AUTH_REQUIRED", "Enter an administrator API key"));
      return;
    }

    const staticToken = context.config.portalAdminToken;
    if (staticToken && tokenMatches(provided, staticToken)) {
      next();
      return;
    }

    const managed = context.apiKeyService.authenticate(provided);
    if (!managed) {
      next(new ApiError("AUTH_INVALID", "Invalid or revoked API key"));
      return;
    }

    if (managed.role !== "admin") {
      next(new ApiError("AUTH_FORBIDDEN", "Administrator API key required"));
      return;
    }

    next();
  };
}

export function createPortalServer(context: ApiContext): express.Express {
  const app = express();
  const assetsPath = path.join(process.cwd(), "portal");

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "roon-ai-bridge-portal",
      version: APP_VERSION,
      authentication_configured: Boolean(context.config.portalAdminToken)
    });
  });

  app.use("/api", createPortalAuth(context));

  app.get("/api/session", (_req, res) => {
    res.json({
      ok: true,
      version: APP_VERSION,
      portal_port: context.config.portalPort
    });
  });

  app.get("/api/dashboard", (_req, res) => {
    const zones = context.roonClient.getZones();
    const playlists = context.playlistService.listPlaylists();
    const apiKeys = context.apiKeyService.list();

    res.json({
      version: APP_VERSION,
      status: {
        core_connected: context.roonClient.isCoreConnected(),
        core_name: context.roonClient.getCoreName(),
        transport_ready: context.roonClient.isTransportReady(),
        browse_ready:
          context.config.enableBrowse && context.roonClient.isBrowseReady()
      },
      counts: {
        zones: zones.length,
        playing_zones: zones.filter((zone) => zone.state === "playing").length,
        playlists: playlists.length,
        playlist_tracks: playlists.reduce(
          (total, playlist) => total + playlist.tracks_count,
          0
        ),
        active_api_keys: apiKeys.filter((key) => !key.revoked_at).length
      },
      now_playing: zones
        .filter((zone) => zone.state === "playing")
        .map((zone) => ({
          zone_id: zone.zone_id,
          display_name: zone.display_name,
          title: zone.now_playing?.three_line?.line1 || null,
          artist: zone.now_playing?.three_line?.line2 || null
        }))
    });
  });

  app.get("/api/admin/settings", (_req, res) => {
    res.json({
      version: APP_VERSION,
      api_port: context.config.port,
      portal_port: context.config.portalPort,
      node_environment: context.config.nodeEnv,
      browse_enabled: context.config.enableBrowse,
      mcp_enabled: context.config.enableMcp,
      api_auth_enabled: context.config.enableAuth,
      api_token_configured: Boolean(context.config.apiToken),
      portal_admin_token_configured: Boolean(context.config.portalAdminToken),
      public_base_url: context.config.publicBaseUrl,
      streaming_source: context.config.roonStreamingSource
    });
  });

  app.get("/api/admin/api-keys", (_req, res) => {
    res.json(context.apiKeyService.list());
  });

  app.post("/api/admin/api-keys", (req, res, next) => {
    try {
      const created = context.apiKeyService.create(req.body || {});
      context.logger.info("Managed API key created", {
        keyId: created.key_id,
        name: created.name,
        role: created.role
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/admin/api-keys/:key_id", (req, res, next) => {
    try {
      const revoked = context.apiKeyService.revoke(req.params.key_id);
      context.logger.info("Managed API key revoked", {
        keyId: revoked.key_id,
        name: revoked.name
      });
      res.json(revoked);
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/roon", createRoonRouter(context));
  app.use("/api/roon", createZonesRouter(context));
  app.use("/api/roon", createPlaybackRouter(context));
  app.use("/api/roon", createGroupingRouter(context));
  app.use("/api/roon", createVolumeRouter(context));
  app.use("/api/roon", createLibraryRouter(context));
  app.use("/api/roon", createMediaRouter(context));
  app.use("/api/roon", createQueueRouter(context));
  app.use("/api", createPlaylistsRouter(context));

  app.use("/api", (req, _res, next) => {
    next(
      new ApiError("NOT_IMPLEMENTED", "Portal endpoint not found", {
        method: req.method,
        path: req.path
      })
    );
  });

  app.use(express.static(assetsPath, {
    etag: true,
    maxAge: context.config.nodeEnv === "production" ? "5m" : 0
  }));

  app.get("*", (_req, res, next) => {
    res.sendFile(path.join(assetsPath, "index.html"), (error) => {
      if (error) next(error);
    });
  });

  app.use(
    (error: Error, _req: Request, res: Response, next: NextFunction): void => {
      if (res.headersSent) {
        next(error);
        return;
      }

      if (error instanceof ApiError) {
        sendError(res, error);
        return;
      }

      context.logger.error("Portal request failed", {
        message: error.message,
        stack: error.stack
      });
      sendError(res, new ApiError("INTERNAL_ERROR", "Portal request failed"));
    }
  );

  return app;
}
