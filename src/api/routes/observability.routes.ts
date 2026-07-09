import { Router } from "express";
import { ApiContext } from "../server";
import { ApiError } from "../../utils/errors";
import { buildToolsManifest } from "../../services/toolManifestService";

export function createActionAuditMiddleware(context: ApiContext, source: "http" | "portal") {
  return (req: any, res: any, next: any): void => {
    const started = Date.now();
    res.on("finish", () => {
      if (!context.actionLogService) return;
      if (req.path.startsWith("/observability/actions") && req.method === "GET") return;
      const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      context.actionLogService.record({
        source,
        toolOrEndpoint: `${req.method} ${req.originalUrl || req.url}`,
        classification: {
          read_only: !mutation,
          mutation,
          destructive: ["DELETE"].includes(req.method),
          audible: req.originalUrl?.includes("/roon/") && mutation,
          volume_mutation: req.originalUrl?.includes("/volume") || req.originalUrl?.includes("/mute"),
          queue_mutation: req.originalUrl?.includes("/queue") || req.originalUrl?.includes("/play")
        },
        arguments: {
          params: req.params,
          query: req.query,
          body: req.body
        },
        result: {
          ok: res.statusCode < 400,
          status_code: res.statusCode,
          error_code: res.statusCode >= 400 ? `HTTP_${res.statusCode}` : null
        },
        durationMs: Date.now() - started,
        errorCode: res.statusCode >= 400 ? `HTTP_${res.statusCode}` : null
      });
    });
    next();
  };
}

function boolParam(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return value === "true" || value === "1" || value === true;
}

function roonState(context: ApiContext): Record<string, unknown> {
  return {
    core_connected: context.roonClient.isCoreConnected(),
    core_name: context.roonClient.getCoreName(),
    transport_ready: context.roonClient.isTransportReady(),
    browse_ready: context.config.enableBrowse && context.roonClient.isBrowseReady(),
    image_ready: context.roonClient.isImageReady(),
    zones_count: context.roonClient.getZones().length,
    outputs_count: context.roonClient.getOutputs().length
  };
}

export function createObservabilityRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/observability/actions", (req, res, next) => {
    try {
      res.json(context.actionLogService?.list({
        limit: Number(req.query.limit || 50),
        offset: Number(req.query.offset || 0),
        tool: typeof req.query.tool === "string" ? req.query.tool : undefined,
        source: typeof req.query.source === "string" ? req.query.source : undefined,
        errorOnly: boolParam(req.query.error_only),
        mutationOnly: boolParam(req.query.mutation_only)
      }) || { ok: true, actions: [], total: 0 });
    } catch (error) {
      next(error);
    }
  });

  router.get("/observability/actions/:action_id", (req, res, next) => {
    try {
      const action = context.actionLogService?.get(req.params.action_id);
      if (!action) throw new ApiError("NOT_IMPLEMENTED", "Action log entry not found", {}, 404);
      res.json(action);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/observability/actions", (req, res) => {
    res.json(context.actionLogService?.clear(req.body?.confirm === true) || { ok: false });
  });

  router.get("/observability/errors", (req, res) => {
    res.json(context.technicalLogService?.errors(Number(req.query.limit || 50)) || { ok: true, errors: [] });
  });

  router.get("/logs/recent", (req, res) => {
    res.json(context.technicalLogService?.list({
      level: req.query.level as any,
      component: typeof req.query.component === "string" ? req.query.component : undefined,
      since: typeof req.query.since === "string" ? req.query.since : undefined,
      limit: Number(req.query.limit || 100)
    }) || { ok: true, logs: [] });
  });

  router.get("/diagnostics/bundle", (req, res) => {
    res.json(context.diagnosticsService?.bundle({
      include_recent_actions: boolParam(req.query.include_recent_actions),
      include_recent_errors: boolParam(req.query.include_recent_errors),
      include_tool_schemas: boolParam(req.query.include_tool_schemas),
      sanitize: req.query.sanitize === undefined ? true : boolParam(req.query.sanitize)
    }) || { ok: false });
  });

  router.get("/tools/manifest", (_req, res) => {
    res.json(buildToolsManifest(context as any));
  });

  router.get("/extensions/status", (_req, res) => {
    res.json(context.extensionManagerService?.status() || { ok: false, manager_available: false });
  });

  router.get("/extensions", (_req, res) => {
    res.json(context.extensionManagerService?.listExtensions(roonState(context)) || { ok: true, extensions: [] });
  });

  router.get("/extensions/:extension_id", (req, res) => {
    res.json(context.extensionManagerService?.getExtensionDetails(req.params.extension_id, roonState(context)) || { ok: false });
  });

  router.get("/extensions/:extension_id/logs", (req, res) => {
    res.json(context.extensionManagerService?.getExtensionLogs(req.params.extension_id, {
      level: req.query.level as any,
      limit: Number(req.query.limit || 100)
    }) || { ok: true, logs: [] });
  });

  router.post("/extensions/:extension_id/restart", (req, res) => {
    res.json(context.extensionManagerService?.mutationUnavailable(
      "roon_restart_extension",
      req.params.extension_id,
      req.body?.confirm === true
    ) || { ok: false });
  });

  return router;
}
