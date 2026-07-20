import { Router } from "express";
import { ApplicationContext } from "../../app/context";
import { APP_VERSION } from "../../config/version";

export function createPortalSystemRouter(context: ApplicationContext): Router {
  const router = Router();

  router.get("/api/admin/settings", (_req, res) => {
    const systemInfo = context.systemManagementService.getSystemInfo() as any;
    res.json({
      version: APP_VERSION,
      build: process.env.GIT_COMMIT?.slice(0, 12) || null,
      api_port: context.config.port,
      portal_port: context.config.portalPort,
      node_environment: context.config.nodeEnv,
      browse_enabled: context.config.enableBrowse,
      mcp_enabled: context.config.enableMcp,
      api_auth_enabled: context.config.enableAuth,
      api_token_configured: Boolean(context.config.apiToken),
      portal_admin_token_configured: Boolean(context.config.portalAdminToken),
      public_base_url: context.config.publicBaseUrl,
      portal_base_url: context.config.portalPublicUrl,
      streaming_source: context.config.roonStreamingSource,
      update_channel: systemInfo.update_channel,
      installed_channel: systemInfo.installed_channel,
      allow_beta_updates: systemInfo.allow_beta_updates === true,
      automatic_update_checks: systemInfo.automatic_update_checks === true,
      debug_mode: systemInfo.debug_mode === true
    });
  });

  router.get("/api/admin/system", (_req, res) => {
    res.json(context.systemManagementService.getSystemInfo());
  });

  router.patch("/api/admin/system/ports", (req, res, next) => {
    try {
      res.json(context.systemManagementService.saveRuntimeConfig(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/admin/system/update-preferences", (req, res, next) => {
    try {
      res.json(context.systemManagementService.saveUpdatePreferences(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/admin/system/debug-preferences", (req, res, next) => {
    try {
      res.json(context.systemManagementService.saveDebugPreferences(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/admin/system/playlist-preferences", (req, res, next) => {
    try {
      res.json(context.systemManagementService.savePlaylistPreferences(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/admin/system/update-channel", (req, res, next) => {
    try {
      const result = context.systemManagementService.changeUpdateChannel(req.body || {});
      res.status(result.update_request ? 202 : 200).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/admin/system/check-update", async (req, res, next) => {
    try {
      res.json(await context.systemManagementService.checkForUpdates(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/admin/system/update", (req, res, next) => {
    try {
      res.status(202).json(context.systemManagementService.requestUpdate(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/admin/system/restart", (_req, res, next) => {
    try {
      res.status(202).json(context.systemManagementService.requestRestart());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
