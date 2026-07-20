import { Router } from "express";
import { ApplicationContext } from "../../app/context";
import { getBearerToken, tokenMatches } from "../../api/middleware/auth";
import { APP_VERSION } from "../../config/version";
import { ApiError } from "../../utils/errors";

export function createPortalPublicAuthRouter(context: ApplicationContext): Router {
  const router = Router();

  router.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "roon-ai-bridge-portal",
      version: APP_VERSION,
      build: process.env.GIT_COMMIT?.slice(0, 12) || null,
      authentication_configured: Boolean(context.config.portalAdminToken),
      setup_required: context.portalAuthService.setupRequired()
    });
  });

  router.get("/api/auth/status", (_req, res) => {
    res.json({
      setup_required: context.portalAuthService.setupRequired(),
      bootstrap_token_required: context.portalAuthService.setupRequired()
    });
  });

  router.post("/api/auth/setup", (req, res, next) => {
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

  router.post("/api/auth/login", (req, res, next) => {
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

  return router;
}

export function createPortalSessionRouter(context: ApplicationContext): Router {
  const router = Router();

  router.get("/api/session", (_req, res) => {
    const systemInfo = context.systemManagementService.getSystemInfo() as any;
    const versionStatus = systemInfo.version_status;
    const availableUpdate =
      versionStatus?.update_available === true && versionStatus.latest_version
        ? {
            version: versionStatus.latest_version,
            build: versionStatus.latest_build || null,
            channel: versionStatus.channel === "beta" ? "beta" : "stable"
          }
        : null;
    res.json({
      ok: true,
      version: APP_VERSION,
      build: process.env.GIT_COMMIT?.slice(0, 12) || null,
      update_channel: systemInfo.update_channel,
      installed_channel: systemInfo.installed_channel,
      automatic_update_checks: systemInfo.automatic_update_checks === true,
      debug_mode: systemInfo.debug_mode === true,
      available_update: availableUpdate,
      portal_port: context.config.portalPort,
      user: res.locals.portalUser || null
    });
  });

  router.post("/api/auth/logout", (_req, res) => {
    const token = res.locals.portalSessionToken;
    if (typeof token === "string") context.portalAuthService.logout(token);
    res.json({ ok: true });
  });

  router.post("/api/auth/change-password", (req, res, next) => {
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

  return router;
}
