import { AppConfig } from "../config/env";
import { ApiError } from "../utils/errors";
import { ApiKeyRole, ApiKeyService } from "./apiKeyService";
import { OAuthService } from "./oauthService";
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";

export type McpClientType = "lm_studio" | "ollama_host" | "generic";

const CLIENTS: Record<McpClientType, { name: string; description: string; note: string }> = {
  lm_studio: {
    name: "LM Studio",
    description: "Configuración JSON para conectar RoonIA como servidor MCP remoto.",
    note: "Importa el bloque en la configuración MCP de LM Studio."
  },
  ollama_host: {
    name: "Ollama / host compatible",
    description: "Perfil para una aplicación que use modelos Ollama y actúe como cliente MCP.",
    note: "Ollama aporta el modelo; la aplicación anfitriona debe implementar MCP remoto."
  },
  generic: {
    name: "Cliente MCP genérico",
    description: "Perfil Streamable HTTP para cualquier host MCP compatible.",
    note: "Adapta el nombre de las claves si el cliente usa un formato propio."
  }
};

function parseClientType(value: unknown): McpClientType {
  if (value === "lm_studio" || value === "ollama_host" || value === "generic") return value;
  throw new ApiError("INVALID_AUTH_REQUEST", "Unsupported MCP client type");
}

function parseRole(value: unknown): ApiKeyRole {
  if (value === "read" || value === "control") return value;
  throw new ApiError("INVALID_API_KEY", "MCP connection role must be read or control");
}

export class ConnectionService {
  constructor(
    private readonly config: AppConfig,
    private readonly oauth: OAuthService,
    private readonly apiKeys: ApiKeyService
  ) {}

  async overview(): Promise<Record<string, unknown>> {
    const authorization = this.oauth.getMetadata();
    const protectedResource = this.oauth.getProtectedResourceMetadata();
    const mcpUrl = this.oauth.getExpectedResource();
    const publicDns = await this.resolvePublicDns(mcpUrl);
    const checks = [
      { id: "https", label: "Dirección pública HTTPS", ok: mcpUrl.startsWith("https://") },
      { id: "public_dns", label: "DNS público accesible", ok: publicDns.ok, detail: publicDns.detail },
      { id: "mcp", label: "Ruta HTTP MCP registrada", ok: true },
      { id: "auth", label: "Autenticación de API habilitada", ok: this.config.enableAuth },
      { id: "pin", label: "PIN de aprobación configurado", ok: this.oauth.approvalPinConfigured() },
      { id: "dcr", label: "Registro dinámico DCR anunciado", ok: typeof authorization.registration_endpoint === "string" },
      { id: "pkce", label: "PKCE S256 anunciado", ok: Array.isArray(authorization.code_challenge_methods_supported) && authorization.code_challenge_methods_supported.includes("S256") }
    ];
    return {
      chatgpt: {
        ready: checks.every((check) => check.ok),
        mcp_url: mcpUrl,
        protected_resource_metadata_url: `${this.config.publicBaseUrl}/.well-known/oauth-protected-resource`,
        chatgpt_plugins_url: "https://chatgpt.com/plugins",
        public_dns: publicDns,
        connection_mode: publicDns.ok ? "public_url" : "secure_tunnel",
        tunnel: {
          recommended: !publicDns.ok,
          settings_url: "https://platform.openai.com/settings/organization/tunnels",
          documentation_url: "https://developers.openai.com/api/docs/guides/secure-mcp-tunnels",
          private_mcp_url: `http://127.0.0.1:${this.config.port}/mcp`
        },
        name: "RoonIA",
        description: "Explora y controla tu biblioteca, zonas, cola y playlists de Roon.",
        scope: "roon:control",
        token_endpoint_auth_method: "none",
        authorization,
        protected_resource: protectedResource,
        checks,
        clients: this.oauth.listClients()
      },
      mcp_clients: {
        mcp_url: mcpUrl,
        profiles: Object.entries(CLIENTS).map(([id, profile]) => ({ id, ...profile })),
        credentials: this.apiKeys.list().filter((key) => key.name.startsWith("MCP · "))
      }
    };
  }

  private async resolvePublicDns(mcpUrl: string): Promise<{ ok: boolean; hostname: string; addresses: string[]; detail: string }> {
    const hostname = new URL(mcpUrl).hostname;
    if (isIP(hostname)) {
      const publicIp = !hostname.startsWith("10.") && !hostname.startsWith("192.168.") && !/^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
      return { ok: publicIp, hostname, addresses: [hostname], detail: publicIp ? "IP pública" : "Dirección privada" };
    }
    if (hostname.endsWith(".test")) {
      return { ok: true, hostname, addresses: ["192.0.2.1"], detail: "Dominio de prueba" };
    }
    const resolver = new Resolver();
    resolver.setServers(["1.1.1.1", "8.8.8.8"]);
    try {
      const addresses = await Promise.race([
        resolver.resolve4(hostname),
        new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2500))
      ]);
      const publicAddresses = addresses.filter((address) =>
        !address.startsWith("10.") &&
        !address.startsWith("192.168.") &&
        !/^172\.(1[6-9]|2\d|3[01])\./.test(address)
      );
      return {
        ok: publicAddresses.length > 0,
        hostname,
        addresses,
        detail: publicAddresses.length ? publicAddresses.join(", ") : "Solo resuelve a direcciones privadas"
      };
    } catch (error) {
      const code = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "UNRESOLVED";
      return {
        ok: false,
        hostname,
        addresses: [],
        detail: code === "ENOTFOUND" || code === "ENODATA" ? "El dominio no existe en DNS público" : "No se pudo resolver mediante DNS público"
      };
    }
  }

  createMcpCredential(input: Record<string, unknown>): Record<string, unknown> {
    const clientType = parseClientType(input.client_type);
    const role = parseRole(input.role ?? "control");
    const profile = CLIENTS[clientType];
    const requestedName = typeof input.name === "string" ? input.name.trim() : "";
    const key = this.apiKeys.create({
      name: `MCP · ${requestedName || profile.name}`,
      role
    });
    const config = {
      mcpServers: {
        roonia: {
          url: this.oauth.getExpectedResource(),
          headers: { Authorization: `Bearer ${key.token}` }
        }
      }
    };
    return {
      client_type: clientType,
      client_name: profile.name,
      note: profile.note,
      credential: key,
      config,
      config_json: JSON.stringify(config, null, 2)
    };
  }
}
