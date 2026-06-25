import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { ApiError } from "../../utils/errors";
import { ApiContext } from "../server";

function getBearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function tokenMatches(provided: string, expected: string): boolean {
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
          `Bearer resource_metadata="${context.config.publicBaseUrl}/.well-known/oauth-protected-resource"`
        );
      }
      next(new ApiError("AUTH_REQUIRED", "Missing bearer token"));
      return;
    }

    if (!tokenMatches(provided, expected) && !context.oauthService.tokenIsValid(provided)) {
      if (req.path === "/mcp") {
        _res.setHeader(
          "WWW-Authenticate",
          `Bearer resource_metadata="${context.config.publicBaseUrl}/.well-known/oauth-protected-resource"`
        );
      }
      next(new ApiError("AUTH_INVALID", "Invalid bearer token"));
      return;
    }

    next();
  };
}
