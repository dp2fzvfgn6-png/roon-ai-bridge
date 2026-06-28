import express, { Router } from "express";
import { ApiError } from "../../utils/errors";
import { ApiContext } from "../server";

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function createOAuthRouter(context: ApiContext): Router {
  const router = Router();
  const parseForm = express.urlencoded({ extended: false });

  router.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json(context.oauthService.getMetadata());
  });

  router.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json(context.oauthService.getProtectedResourceMetadata());
  });

  router.post("/oauth/register", (req, res, next) => {
    try {
      const client = context.oauthService.registerClient(req.body || {});
      context.logger.info("OAuth client registered", {
        clientId: client.client_id,
        clientName: client.client_name
      });
      res.status(201).json({
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        client_id_issued_at: Math.floor(Date.now() / 1000)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/oauth/authorize", (req, res, next) => {
    const clientId = readString(req.query.client_id);
    const redirectUri = readString(req.query.redirect_uri);
    const state = readString(req.query.state);
    const responseType = readString(req.query.response_type);
    const codeChallenge = readString(req.query.code_challenge);
    const codeChallengeMethod = readString(req.query.code_challenge_method);
    const scope = readString(req.query.scope) || "roon:control";
    const resource = readString(req.query.resource) || context.oauthService.getExpectedResource();
    const client = context.oauthService.getClient(clientId);

    if (responseType !== "code") {
      next(new ApiError("INVALID_AUTH_REQUEST", "response_type must be code"));
      return;
    }

    if (!client || !client.redirect_uris.includes(redirectUri)) {
      next(new ApiError("INVALID_AUTH_REQUEST", "Invalid OAuth client or redirect_uri"));
      return;
    }

    res.type("html").send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Autorizar RoonIA</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f6f8fb; color: #182033; }
      main { max-width: 520px; margin: 48px auto; background: white; border: 1px solid #dce3ee; border-radius: 10px; padding: 24px; }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { line-height: 1.5; }
      label { display: block; margin: 18px 0 6px; font-weight: 650; }
      input { width: 100%; box-sizing: border-box; padding: 12px; border: 1px solid #bdc7d6; border-radius: 8px; font-size: 16px; }
      button { margin-top: 18px; border: 0; border-radius: 8px; padding: 12px 16px; background: #172033; color: white; font-weight: 700; cursor: pointer; }
      .muted { color: #5d687a; }
      .warning { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Autorizar RoonIA</h1>
      <p class="muted">ChatGPT quiere conectar con tu Roon AI Bridge.</p>
      <p class="warning">Esto permite controlar reproducción, volumen, cola y playlists virtuales en tu instalación privada de Roon.</p>
      <form method="post" action="/oauth/authorize">
        <input type="hidden" name="client_id" value="${htmlEscape(clientId)}">
        <input type="hidden" name="redirect_uri" value="${htmlEscape(redirectUri)}">
        <input type="hidden" name="state" value="${htmlEscape(state)}">
        <input type="hidden" name="scope" value="${htmlEscape(scope)}">
        <input type="hidden" name="code_challenge" value="${htmlEscape(codeChallenge)}">
        <input type="hidden" name="code_challenge_method" value="${htmlEscape(codeChallengeMethod)}">
        <input type="hidden" name="resource" value="${htmlEscape(resource)}">
        <label for="pin">PIN de aprobación</label>
        <input id="pin" name="pin" type="password" autocomplete="one-time-code" autofocus required>
        <button type="submit">Autorizar ${htmlEscape(client.client_name)}</button>
      </form>
    </main>
  </body>
</html>`);
  });

  router.post("/oauth/authorize", parseForm, (req, res, next) => {
    try {
      const pin = readString(req.body.pin);
      if (!context.oauthService.approvalPinMatches(pin)) {
        next(new ApiError("AUTH_INVALID", "Invalid OAuth approval PIN"));
        return;
      }

      const redirectUri = readString(req.body.redirect_uri);
      const state = readString(req.body.state);
      const code = context.oauthService.createAuthorizationCode({
        client_id: readString(req.body.client_id),
        redirect_uri: redirectUri,
        code_challenge: readString(req.body.code_challenge) || undefined,
        code_challenge_method: readString(req.body.code_challenge_method) || undefined,
        resource: readString(req.body.resource) || context.oauthService.getExpectedResource(),
        scope: readString(req.body.scope) || "roon:control"
      });

      const redirect = new URL(redirectUri);
      redirect.searchParams.set("code", code);
      if (state) redirect.searchParams.set("state", state);
      context.logger.info("OAuth authorization approved", {
        clientId: readString(req.body.client_id)
      });
      res.redirect(302, redirect.toString());
    } catch (error) {
      next(error);
    }
  });

  router.post("/oauth/token", parseForm, (req, res, next) => {
    try {
      const grantType = readString(req.body.grant_type);
      if (grantType !== "authorization_code") {
        next(new ApiError("INVALID_AUTH_REQUEST", "grant_type must be authorization_code"));
        return;
      }

      const token = context.oauthService.exchangeCode({
        code: readString(req.body.code),
        client_id: readString(req.body.client_id),
        redirect_uri: readString(req.body.redirect_uri),
        code_verifier: readString(req.body.code_verifier) || undefined,
        resource: readString(req.body.resource) || context.oauthService.getExpectedResource()
      });

      context.logger.info("OAuth token issued", {
        clientId: token.client_id
      });
      res.json({
        access_token: token.access_token,
        token_type: "Bearer",
        expires_in: Math.max(1, Math.floor((token.expires_at - Date.now()) / 1000)),
        scope: token.scope
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
