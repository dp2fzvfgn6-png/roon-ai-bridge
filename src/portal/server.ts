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
import { createAdvancedRouter } from "../api/routes/advanced.routes";
import { createZonePresetsRouter } from "../api/routes/zonePresets.routes";
import { createVolumeLimitsRouter } from "../api/routes/volumeLimits.routes";
import { createWidgetsRouter } from "../api/routes/widgets.routes";
import { ApiError, sendError } from "../utils/errors";
import { APP_VERSION } from "../config/version";
import { createActionAuditMiddleware, createObservabilityRouter } from "../api/routes/observability.routes";

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

    const portalUser = context.portalAuthService.authenticate(provided);
    if (portalUser) {
      _res.locals.portalUser = portalUser;
      _res.locals.portalSessionToken = provided;
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
      authentication_configured: Boolean(context.config.portalAdminToken),
      setup_required: context.portalAuthService.setupRequired()
    });
  });

  app.get("/api/auth/status", (_req, res) => {
    res.json({
      setup_required: context.portalAuthService.setupRequired(),
      bootstrap_token_required: context.portalAuthService.setupRequired()
    });
  });

  app.post("/api/auth/setup", (req, res, next) => {
    try {
      const bootstrap = getBearerToken(req);
      const expected = context.config.portalAdminToken;
      if (!expected) {
        throw new ApiError(
          "AUTH_REQUIRED",
          "PORTAL_ADMIN_TOKEN or API_TOKEN must be configured for first setup"
        );
      }
      if (!bootstrap || !tokenMatches(bootstrap, expected)) {
        throw new ApiError("AUTH_INVALID", "Invalid bootstrap token");
      }
      res.status(201).json(context.portalAuthService.setup(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    try {
      if (context.portalAuthService.setupRequired()) {
        throw new ApiError(
          "AUTH_REQUIRED",
          "Create the first administrator before signing in"
        );
      }
      res.json(context.portalAuthService.login(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", createPortalAuth(context));
  app.use("/api", createActionAuditMiddleware(context, "portal"));
  app.use("/api", createObservabilityRouter(context));

  app.get("/api/session", (_req, res) => {
    res.json({
      ok: true,
      version: APP_VERSION,
      portal_port: context.config.portalPort,
      user: res.locals.portalUser || null
    });
  });

  app.post("/api/auth/logout", (_req, res) => {
    const token = res.locals.portalSessionToken;
    if (typeof token === "string") context.portalAuthService.logout(token);
    res.json({ ok: true });
  });

  app.post("/api/auth/change-password", (req, res, next) => {
    try {
      const user = res.locals.portalUser;
      if (!user?.user_id) {
        throw new ApiError(
          "AUTH_FORBIDDEN",
          "Sign in with username and password to change it"
        );
      }
      context.portalAuthService.changePassword(user.user_id, req.body || {});
      res.json({ ok: true, signed_out: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/dashboard", (_req, res) => {
    const zones = context.roonClient.getZones();
    const playlists = context.playlistService.listPlaylists({
      includeTracks: false,
      limit: 100,
      offset: 0
    });
    const apiKeys = context.apiKeyService.list();
    const actions = context.actionLogService?.list({ limit: 5 }) as any;
    const errors = context.technicalLogService?.errors(5) as any;
    const manifest = context.diagnosticsService?.bundle({
      include_recent_actions: false,
      include_recent_errors: false,
      include_tool_schemas: false
    }) as any;

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
        playlists: playlists.total,
        playlist_tracks: playlists.playlists.reduce(
          (total, playlist) => total + playlist.tracks_count,
          0
        ),
        active_api_keys: apiKeys.filter((key) => !key.revoked_at).length,
        mcp_tools: manifest?.mcp?.tools_count || 0,
        recent_errors: errors?.count || 0
      },
      extension_manager: context.extensionManagerService?.status() || null,
      recent_actions: actions?.actions || [],
      recent_errors: errors?.errors || [],
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
      streaming_source: context.config.roonStreamingSource,
      update_channel: context.config.updateChannel,
      allow_beta_updates: context.config.updateChannel === "beta"
    });
  });

  app.get("/api/admin/system", (_req, res) => {
    res.json(context.systemManagementService.getSystemInfo());
  });

  app.patch("/api/admin/system/ports", (req, res, next) => {
    try {
      res.json(context.systemManagementService.saveRuntimeConfig(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/system/check-update", async (_req, res, next) => {
    try {
      res.json(await context.systemManagementService.checkForUpdates());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/system/update", (req, res, next) => {
    try {
      res.status(202).json(context.systemManagementService.requestUpdate(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/system/restart", (_req, res, next) => {
    try {
      res.status(202).json(context.systemManagementService.requestRestart());
    } catch (error) {
      next(error);
    }
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

  app.get("/api/admin/zone-presets", (_req, res) => {
    res.json(context.zonePresetService.list());
  });

  app.post("/api/admin/zone-presets", (req, res, next) => {
    try {
      res.status(201).json(
        context.zonePresetService.create(context.roonClient, req.body || {})
      );
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/admin/zone-presets/:preset_id", (req, res, next) => {
    try {
      res.json(
        context.zonePresetService.update(req.params.preset_id, req.body || {})
      );
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/admin/zone-presets/:preset_id", (req, res, next) => {
    try {
      context.zonePresetService.delete(req.params.preset_id);
      res.json({ ok: true, preset_id: req.params.preset_id });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/zone-presets/:preset_id/apply", async (req, res, next) => {
    try {
      res.json(
        await context.zonePresetService.apply(
          context.roonClient,
          req.params.preset_id,
          {
            dryRun: req.body?.dry_run === true,
            confirm: req.body?.confirm === true,
            volumeLimitService: context.volumeLimitService
          }
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/output-volumes", (_req, res) => {
    res.json(context.outputVolumeSettingsService.list(context.roonClient));
  });

  app.put("/api/admin/output-volumes/:output_id", (req, res, next) => {
    try {
      res.json(
        context.outputVolumeSettingsService.save(
          context.roonClient,
          req.params.output_id,
          req.body || {}
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/admin/output-volumes/:output_id/apply",
    async (req, res, next) => {
      try {
        res.json(
          await context.outputVolumeSettingsService.applyPreferred(
            context.roonClient,
            req.params.output_id
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  app.use("/api/roon", createRoonRouter(context));
  app.use("/api/roon", createZonesRouter(context));
  app.use("/api/roon", createPlaybackRouter(context));
  app.use("/api/roon", createGroupingRouter(context));
  app.use("/api/roon", createVolumeRouter(context));
  app.use("/api/roon", createLibraryRouter(context));
  app.use("/api/roon", createMediaRouter(context));
  app.use("/api/roon", createQueueRouter(context));
  app.use("/api/roon", createAdvancedRouter(context));
  app.use("/api", createWidgetsRouter(context));
  app.use("/api", createPlaylistsRouter(context));
  app.use("/api", createZonePresetsRouter(context));
  app.use("/api", createVolumeLimitsRouter(context));

  app.use("/api/admin", createZonePresetsRouter(context));
  app.use("/api/admin", createVolumeLimitsRouter(context));

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
