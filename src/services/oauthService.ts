import crypto from "crypto";
import fs from "fs";
import path from "path";
import { AppConfig } from "../config/env";
import { ApiError } from "../utils/errors";

type OAuthClient = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  created_at: string;
};

type OAuthCode = {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string | null;
  code_challenge_method: string | null;
  resource: string;
  scope: string;
  expires_at: number;
};

type OAuthToken = {
  access_token: string;
  client_id: string;
  created_at: string;
  resource: string;
  scope: string;
  expires_at: number;
  last_used_at?: string | null;
};

type OAuthStore = {
  clients: OAuthClient[];
  codes: OAuthCode[];
  tokens: OAuthToken[];
};

type RegisterClientInput = {
  client_name?: string;
  redirect_uris?: string[];
};

type OAuthPinSettings = {
  salt: string;
  hash: string;
  updated_at: string;
};

export type OAuthClientSummary = OAuthClient & {
  active_tokens: number;
  last_authorized_at: string | null;
  last_used_at: string | null;
};

const emptyStore = (): OAuthStore => ({
  clients: [],
  codes: [],
  tokens: []
});

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256Base64Url(value: string): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function isExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt;
}

export class OAuthService {
  private readonly storePath: string;
  private readonly settingsPath: string;

  constructor(private readonly config: AppConfig) {
    this.storePath = path.join(config.dataDir, "oauth-store.json");
    this.settingsPath = path.join(config.dataDir, "oauth-settings.json");
  }

  getMetadata(): Record<string, unknown> {
    return {
      issuer: this.config.oauthIssuer,
      authorization_endpoint: `${this.config.publicBaseUrl}/oauth/authorize`,
      token_endpoint: `${this.config.publicBaseUrl}/oauth/token`,
      registration_endpoint: `${this.config.publicBaseUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["roon:control"]
    };
  }

  getProtectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: `${this.config.publicBaseUrl}/mcp`,
      resource_name: "RoonIA MCP",
      authorization_servers: [this.config.oauthIssuer],
      bearer_methods_supported: ["header"],
      scopes_supported: ["roon:control"],
      resource_documentation: `${this.config.publicBaseUrl}/privacy`
    };
  }

  registerClient(input: RegisterClientInput): OAuthClient {
    const redirectUris = Array.isArray(input.redirect_uris)
      ? input.redirect_uris.filter((uri) => typeof uri === "string" && uri.startsWith("https://"))
      : [];

    if (redirectUris.length === 0) {
      throw new ApiError("INVALID_AUTH_REQUEST", "redirect_uris must include at least one HTTPS URL", {}, 400);
    }

    const store = this.readStore();
    const client: OAuthClient = {
      client_id: `roonia_${randomToken(18)}`,
      client_name: input.client_name || "ChatGPT",
      redirect_uris: redirectUris,
      created_at: new Date().toISOString()
    };

    store.clients.push(client);
    this.writeStore(store);
    return client;
  }

  getClient(clientId: string): OAuthClient | null {
    return this.readStore().clients.find((client) => client.client_id === clientId) || null;
  }

  listClients(): OAuthClientSummary[] {
    const store = this.readStore();
    const now = Date.now();
    return store.clients.map((client) => {
      const tokens = store.tokens.filter(
        (token) => token.client_id === client.client_id && token.expires_at > now
      );
      const newest = (values: Array<string | null | undefined>): string | null =>
        values.filter((value): value is string => Boolean(value)).sort().at(-1) || null;
      return {
        ...client,
        active_tokens: tokens.length,
        last_authorized_at: newest(tokens.map((token) => token.created_at)),
        last_used_at: newest(tokens.map((token) => token.last_used_at))
      };
    }).sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  revokeClientTokens(clientId: string): OAuthClientSummary {
    const store = this.readStore();
    if (!store.clients.some((client) => client.client_id === clientId)) {
      throw new ApiError("AUTH_INVALID", "OAuth client not found", { client_id: clientId }, 404);
    }
    store.codes = store.codes.filter((code) => code.client_id !== clientId);
    store.tokens = store.tokens.filter((token) => token.client_id !== clientId);
    this.writeStore(store);
    return this.listClients().find((client) => client.client_id === clientId)!;
  }

  deleteClient(clientId: string): OAuthClient {
    const store = this.readStore();
    const client = store.clients.find((item) => item.client_id === clientId);
    if (!client) {
      throw new ApiError("AUTH_INVALID", "OAuth client not found", { client_id: clientId }, 404);
    }
    store.clients = store.clients.filter((item) => item.client_id !== clientId);
    store.codes = store.codes.filter((code) => code.client_id !== clientId);
    store.tokens = store.tokens.filter((token) => token.client_id !== clientId);
    this.writeStore(store);
    return client;
  }

  createAuthorizationCode(params: {
    client_id: string;
    redirect_uri: string;
    code_challenge?: string;
    code_challenge_method?: string;
    resource: string;
    scope: string;
  }): string {
    const store = this.readStore();
    const client = store.clients.find((item) => item.client_id === params.client_id);

    if (!client) {
      throw new ApiError("AUTH_INVALID", "Unknown OAuth client", {}, 400);
    }

    if (!client.redirect_uris.includes(params.redirect_uri)) {
      throw new ApiError("AUTH_INVALID", "Invalid redirect_uri for OAuth client", {}, 400);
    }

    if (!params.code_challenge || params.code_challenge_method !== "S256") {
      throw new ApiError("AUTH_INVALID", "PKCE with S256 is required", {}, 400);
    }

    if (params.resource !== this.getExpectedResource()) {
      throw new ApiError("AUTH_INVALID", "Invalid OAuth resource", {
        expected: this.getExpectedResource()
      }, 400);
    }

    if (!this.scopeIsSupported(params.scope)) {
      throw new ApiError("AUTH_INVALID", "Unsupported OAuth scope", {
        supported: ["roon:control"]
      }, 400);
    }

    const code = randomToken(32);
    store.codes = store.codes.filter((item) => !isExpired(item.expires_at));
    store.codes.push({
      code,
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      code_challenge: params.code_challenge || null,
      code_challenge_method: params.code_challenge_method || null,
      resource: params.resource,
      scope: params.scope,
      expires_at: Date.now() + 5 * 60 * 1000
    });
    this.writeStore(store);
    return code;
  }

  exchangeCode(params: {
    code: string;
    client_id: string;
    redirect_uri: string;
    code_verifier?: string;
    resource: string;
  }): OAuthToken {
    const store = this.readStore();
    const codeIndex = store.codes.findIndex((item) => item.code === params.code);
    const code = codeIndex >= 0 ? store.codes[codeIndex] : null;

    if (!code || isExpired(code.expires_at)) {
      throw new ApiError("AUTH_INVALID", "Invalid or expired authorization code", {}, 400);
    }

    if (code.client_id !== params.client_id || code.redirect_uri !== params.redirect_uri) {
      throw new ApiError("AUTH_INVALID", "OAuth code does not match client or redirect_uri", {}, 400);
    }

    if (params.resource !== code.resource || params.resource !== this.getExpectedResource()) {
      throw new ApiError("AUTH_INVALID", "OAuth resource does not match authorization code", {}, 400);
    }

    if (code.code_challenge) {
      const verifier = params.code_verifier || "";
      const expected =
        code.code_challenge_method === "S256" ? sha256Base64Url(verifier) : verifier;

      if (expected !== code.code_challenge) {
        throw new ApiError("AUTH_INVALID", "Invalid PKCE code verifier", {}, 400);
      }
    }

    store.codes.splice(codeIndex, 1);

    const token: OAuthToken = {
      access_token: randomToken(32),
      client_id: params.client_id,
      created_at: new Date().toISOString(),
      resource: code.resource,
      scope: code.scope,
      expires_at: Date.now() + 180 * 24 * 60 * 60 * 1000,
      last_used_at: null
    };

    store.tokens.push(token);
    store.tokens = store.tokens.filter((item) => !isExpired(item.expires_at));
    this.writeStore(store);
    return token;
  }

  tokenIsValid(
    accessToken: string,
    resource = this.getExpectedResource(),
    requiredScope = "roon:control"
  ): boolean {
    const store = this.readStore();
    const token = store.tokens.find(
      (item) =>
        item.access_token === accessToken &&
        !isExpired(item.expires_at) &&
        item.resource === resource &&
        item.scope.split(/\s+/).includes(requiredScope)
    );
    if (!token) return false;
    const now = new Date();
    const previous = token.last_used_at ? Date.parse(token.last_used_at) : 0;
    if (!previous || now.getTime() - previous > 60_000) {
      token.last_used_at = now.toISOString();
      this.writeStore(store);
    }
    return true;
  }

  getExpectedResource(): string {
    return `${this.config.publicBaseUrl}/mcp`;
  }

  approvalPinMatches(value: string): boolean {
    const settings = this.readPinSettings();
    if (settings) {
      const actual = crypto.scryptSync(value, settings.salt, 32);
      const expected = Buffer.from(settings.hash, "hex");
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    }
    const pin = this.config.oauthApprovalPin;
    if (!pin) return false;
    const providedBuffer = Buffer.from(value);
    const expectedBuffer = Buffer.from(pin);
    if (providedBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  }

  approvalPinConfigured(): boolean {
    return Boolean(this.readPinSettings() || this.config.oauthApprovalPin);
  }

  setApprovalPin(value: unknown): { configured: true; updated_at: string } {
    if (typeof value !== "string" || value.length < 6 || value.length > 64) {
      throw new ApiError(
        "INVALID_AUTH_REQUEST",
        "OAuth approval PIN must contain between 6 and 64 characters"
      );
    }
    const salt = crypto.randomBytes(16).toString("hex");
    const updatedAt = new Date().toISOString();
    const settings: OAuthPinSettings = {
      salt,
      hash: crypto.scryptSync(value, salt, 32).toString("hex"),
      updated_at: updatedAt
    };
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
    return { configured: true, updated_at: updatedAt };
  }

  private readStore(): OAuthStore {
    if (!fs.existsSync(this.storePath)) return emptyStore();

    try {
      const parsed = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as Partial<OAuthStore>;
      return {
        clients: Array.isArray(parsed.clients) ? parsed.clients : [],
        codes: Array.isArray(parsed.codes)
          ? parsed.codes.map((code) => ({
              ...code,
              resource: code.resource || this.getExpectedResource(),
              scope: code.scope || "roon:control"
            }))
          : [],
        tokens: Array.isArray(parsed.tokens)
          ? parsed.tokens.map((token) => ({
              ...token,
              resource: token.resource || this.getExpectedResource(),
              scope: token.scope || "roon:control",
              last_used_at: token.last_used_at || null
            }))
          : []
      };
    } catch {
      return emptyStore();
    }
  }

  private readPinSettings(): OAuthPinSettings | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath, "utf8")) as Partial<OAuthPinSettings>;
      if (typeof parsed.salt !== "string" || typeof parsed.hash !== "string" || typeof parsed.updated_at !== "string") {
        return null;
      }
      return parsed as OAuthPinSettings;
    } catch {
      return null;
    }
  }

  private writeStore(store: OAuthStore): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2));
  }

  private scopeIsSupported(scope: string): boolean {
    const scopes = scope.split(/\s+/).filter(Boolean);
    return scopes.length > 0 && scopes.every((item) => item === "roon:control");
  }
}
