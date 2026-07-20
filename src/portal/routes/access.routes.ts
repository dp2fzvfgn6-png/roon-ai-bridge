import { Router } from "express";
import { ApplicationContext } from "../../app/context";
import { buildToolsManifest } from "../../services/toolManifestService";
import { ApiError } from "../../utils/errors";

export function createPortalAccessRouter(context: ApplicationContext): Router {
  const router = Router();

  router.get("/api/admin/api-keys", (_req, res) => res.json(context.apiKeyService.list()));
  router.get("/api/admin/users", (_req, res) => res.json(context.portalAuthService.listUsers()));

  router.post("/api/admin/users", (req, res, next) => {
    try {
      const created = context.portalAuthService.createUser(req.body || {});
      context.logger.info("Portal user created", { userId: created.user_id, username: created.username });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/admin/users/:user_id/password", (req, res, next) => {
    try {
      context.portalAuthService.resetPassword(req.params.user_id, req.body || {});
      context.logger.info("Portal user password reset", { userId: req.params.user_id });
      res.json({ ok: true, sessions_revoked: true });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/admin/users/:user_id", (req, res, next) => {
    try {
      if (res.locals.portalUser?.user_id === req.params.user_id) {
        throw new ApiError("AUTH_FORBIDDEN", "You cannot delete the account used by this session");
      }
      const deleted = context.portalAuthService.deleteUser(req.params.user_id);
      context.logger.warn("Portal user deleted", { userId: deleted.user_id, username: deleted.username });
      res.json(deleted);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/admin/api-keys/:key_id", (req, res, next) => {
    try {
      const updated = context.apiKeyService.update(req.params.key_id, req.body || {});
      context.logger.info("Managed API key permissions updated", {
        keyId: updated.key_id,
        role: updated.role,
        restrictedTools: updated.tool_permissions?.length ?? null
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/admin/api-keys", (req, res, next) => {
    try {
      const created = context.apiKeyService.create(req.body || {});
      context.logger.info("Managed API key created", { keyId: created.key_id, name: created.name, role: created.role });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/admin/api-keys/:key_id/revoke", (req, res, next) => {
    try {
      const revoked = context.apiKeyService.revoke(req.params.key_id);
      context.logger.info("Managed API key revoked", { keyId: revoked.key_id, name: revoked.name });
      res.json(revoked);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/admin/api-keys/:key_id", (req, res, next) => {
    try {
      const deleted = context.apiKeyService.delete(req.params.key_id);
      context.logger.warn("Managed API key deleted", { keyId: deleted.key_id, name: deleted.name });
      res.json(deleted);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/admin/api-keys/:key_id/reactivate", (req, res, next) => {
    try {
      const reactivated = context.apiKeyService.reactivate(req.params.key_id);
      context.logger.info("Managed API key reactivated", { keyId: reactivated.key_id, name: reactivated.name });
      res.json(reactivated);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/admin/tools", (_req, res) => res.json(buildToolsManifest(context)));

  router.patch("/api/admin/tools/:tool_name", (req, res, next) => {
    try {
      const manifest = buildToolsManifest(context) as any;
      const tool = manifest.tools.find((item: any) => item.name === req.params.tool_name);
      if (!tool) {
        throw new ApiError("TOOL_NOT_FOUND", "MCP tool not found", { tool_name: req.params.tool_name });
      }
      if (typeof req.body?.enabled !== "boolean") {
        throw new ApiError("INVALID_TOOL_SETTING", "enabled must be a boolean");
      }
      const setting = context.toolAccessService.setEnabled(tool.name, req.body.enabled);
      context.logger.info("MCP tool availability changed", setting);
      res.json({ ...tool, ...setting });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
