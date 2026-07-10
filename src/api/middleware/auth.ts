import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { ApiError } from "../../utils/errors";
import { ApiContext } from "../server";
import { roleCanControl } from "../../services/apiKeyService";

export function getBearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function tokenMatches(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

export function createAuthMiddleware(context: ApiContext) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!context.config.enableAuth) {
      next();
      return;
    }

    if (req.path === "/health") {
      next();
      return;
    }

    if (req.path === "/privacy" || req.path.startsWith("/oauth/") || req.path.startsWith("/.well-known/")) {
      next();
      return;
    }

    const expected = context.config.apiToken;
    if (!expected) {
      next(new ApiError("AUTH_REQUIRED", "API authentication is enabled but API_TOKEN is not configured"));
      return;
    }

    const provided = getBearerToken(req);
    if (!provided) {
      if (req.path === "/mcp") {
        _res.setHeader(
          "WWW-Authenticate",
          `Bearer resource_metadata="${context.config.publicBaseUrl}/.well-known/oauth-protected-resource", scope="roon:control"`
        );
      }
      next(new ApiError("AUTH_REQUIRED", "Missing bearer token"));
      return;
    }

    const staticTokenMatches = tokenMatches(provided, expected);
    const managedKey = staticTokenMatches
      ? null
      : context.apiKeyService.authenticate(provided);
    const oauthMatches =
      !staticTokenMatches &&
      !managedKey &&
      context.oauthService.tokenIsValid(
        provided,
        context.oauthService.getExpectedResource(),
        "roon:control"
      );

    if (!staticTokenMatches && !managedKey && !oauthMatches) {
      if (req.path === "/mcp") {
        _res.setHeader(
          "WWW-Authenticate",
          `Bearer resource_metadata="${context.config.publicBaseUrl}/.well-known/oauth-protected-resource", scope="roon:control"`
        );
      }
      next(new ApiError("AUTH_INVALID", "Invalid bearer token"));
      return;
    }

    const needsControl =
      req.path === "/mcp" ||
      !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase());
    if (managedKey && needsControl && !roleCanControl(managedKey.role)) {
      next(new ApiError("AUTH_FORBIDDEN", "This API key is read-only"));
      return;
    }

    if (managedKey) _res.locals.apiKey = managedKey;

    next();
  };
}
