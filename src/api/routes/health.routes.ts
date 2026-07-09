import { Router } from "express";
import { ApiContext } from "../server";
import { APP_VERSION } from "../../config/version";

export function createHealthRouter(context?: ApiContext): Router {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({
      ok: true,
      status: "healthy",
      service: "roon-ai-bridge"
    });
  });

  router.get("/ready", (_req, res) => {
    if (!context?.diagnosticsService) {
      res.status(503).json({
        ok: false,
        ready: false,
        checks: {
          database: false,
          roon_core: false,
          mcp_tools: false,
          migrations: false
        }
      });
      return;
    }
    const payload = context.diagnosticsService.readyChecks();
    res.status(payload.ready ? 200 : 503).json(payload);
  });

  router.get("/version", (_req, res) => {
    res.json(context?.diagnosticsService?.version() || {
      app_version: APP_VERSION,
      commit: process.env.GIT_COMMIT || "unknown",
      tag: process.env.GIT_TAG || null,
      build_time: process.env.BUILD_TIME || null,
      node_version: process.version
    });
  });

  return router;
}
