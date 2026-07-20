import { Router } from "express";
import { ApplicationContext } from "../../app/context";
import { ConnectionService } from "../../services/connectionService";

export function createPortalConnectionsRouter(context: ApplicationContext): Router {
  const router = Router();
  const connections = new ConnectionService(context.config, context.oauthService, context.apiKeyService);

  router.get("/api/admin/connections", async (_req, res, next) => {
    try {
      res.json(await connections.overview());
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/admin/connections/oauth/clients", (req, res, next) => {
    try {
      const client = context.oauthService.registerClient(req.body || {});
      context.logger.info("OAuth client created from portal", {
        clientId: client.client_id,
        clientName: client.client_name
      });
      res.status(201).json(client);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/admin/connections/oauth/clients/:client_id/revoke", (req, res, next) => {
    try {
      const client = context.oauthService.revokeClientTokens(req.params.client_id);
      context.logger.warn("OAuth client tokens revoked from portal", { clientId: client.client_id });
      res.json(client);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/admin/connections/oauth/clients/:client_id", (req, res, next) => {
    try {
      const client = context.oauthService.deleteClient(req.params.client_id);
      context.logger.warn("OAuth client deleted from portal", {
        clientId: client.client_id,
        clientName: client.client_name
      });
      res.json(client);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/admin/connections/oauth/pin", (req, res, next) => {
    try {
      const result = context.oauthService.setApprovalPin(req.body?.pin);
      context.logger.warn("OAuth approval PIN rotated from portal");
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/admin/connections/mcp-credentials", (req, res, next) => {
    try {
      const result = connections.createMcpCredential(req.body || {});
      context.logger.info("MCP client credential created from portal", {
        clientType: result.client_type,
        keyId: (result.credential as { key_id?: string }).key_id
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
