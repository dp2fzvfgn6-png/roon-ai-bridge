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
  expires_at: number;
};

type OAuthToken = {
  access_token: string;
  client_id: string;
  created_at: string;
  expires_at: number;
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

  constructor(private readonly config: AppConfig) {
    this.storePath = path.join(config.dataDir, "oauth-store.json");
  }

  getMetadata(): Record<string, unknown> {
    return {
      issuer: this.config.oauthIssuer,
      authorization_endpoint: `${this.config.publicBaseUrl}/oauth/authorize`,
      token_endpoint: `${this.config.publicBaseUrl}/oauth/token`,
      registration_endpoint: `${this.config.publicBaseUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["roon:control"]
    };
  }

  getProtectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: `${this.config.publicBaseUrl}/mcp`,
      authorization_servers: [this.config.oauthIssuer],
      bearer_methods_supported: ["header"],
      scopes_supported: ["roon:control"]
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

  createAuthorizationCode(params: {
    client_id: string;
    redirect_uri: string;
    code_challenge?: string;
    code_challenge_method?: string;
  }): string {
    const store = this.readStore();
    const client = store.clients.find((item) => item.client_id === params.client_id);

    if (!client) {
      throw new ApiError("AUTH_INVALID", "Unknown OAuth client", {}, 400);
    }

    if (!client.redirect_uris.includes(params.redirect_uri)) {
      throw new ApiError("AUTH_INVALID", "Invalid redirect_uri for OAuth client", {}, 400);
    }

    if (params.code_challenge_method && !["S256", "plain"].includes(params.code_challenge_method)) {
      throw new ApiError("AUTH_INVALID", "Unsupported code_challenge_method", {}, 400);
    }

    const code = randomToken(32);
    store.codes = store.codes.filter((item) => !isExpired(item.expires_at));
    store.codes.push({
      code,
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      code_challenge: params.code_challenge || null,
      code_challenge_method: params.code_challenge_method || null,
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
      expires_at: Date.now() + 180 * 24 * 60 * 60 * 1000
    };

    store.tokens.push(token);
    store.tokens = store.tokens.filter((item) => !isExpired(item.expires_at));
    this.writeStore(store);
    return token;
  }

  tokenIsValid(accessToken: string): boolean {
    const store = this.readStore();
    return store.tokens.some((token) => token.access_token === accessToken && !isExpired(token.expires_at));
  }

  approvalPinMatches(value: string): boolean {
    const pin = this.config.oauthApprovalPin;
    if (!pin) return false;
    const providedBuffer = Buffer.from(value);
    const expectedBuffer = Buffer.from(pin);
    if (providedBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  }

  private readStore(): OAuthStore {
    if (!fs.existsSync(this.storePath)) return emptyStore();

    try {
      const parsed = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as Partial<OAuthStore>;
      return {
        clients: Array.isArray(parsed.clients) ? parsed.clients : [],
        codes: Array.isArray(parsed.codes) ? parsed.codes : [],
        tokens: Array.isArray(parsed.tokens) ? parsed.tokens : []
      };
    } catch {
      return emptyStore();
    }
  }

  private writeStore(store: OAuthStore): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2));
  }
}
