import path from "path";
import fs from "fs";

export type AppConfig = {
  port: number;
  portalPort: number;
  enablePortal: boolean;
  nodeEnv: string;
  logLevel: string;
  roonExtensionName: string;
  roonExtensionId: string;
  dataDir: string;
  enableBrowse: boolean;
  enableMcp: boolean;
  enableAuth: boolean;
  apiToken: string | null;
  portalAdminToken: string | null;
  publicBaseUrl: string;
  oauthIssuer: string;
  oauthApprovalPin: string | null;
  roonStreamingSource: "tidal" | "qobuz" | null;
};

function boolFromEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validPort(value: unknown): number | null {
  const port =
    typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export function loadRuntimePortOverrides(dataDir: string): {
  port?: number;
  portalPort?: number;
} {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dataDir, "runtime-config.json"), "utf8")
    ) as Record<string, unknown>;
    const port = validPort(parsed.port);
    const portalPort = validPort(parsed.portal_port);
    return {
      ...(port ? { port } : {}),
      ...(portalPort ? { portalPort } : {})
    };
  } catch {
    return {};
  }
}

export function loadConfig(): AppConfig {
  const enableAuth = boolFromEnv(process.env.ENABLE_AUTH);
  const apiToken =
    typeof process.env.API_TOKEN === "string" && process.env.API_TOKEN.trim() !== ""
      ? process.env.API_TOKEN.trim()
      : null;

  if (enableAuth && !apiToken) {
    throw new Error("ENABLE_AUTH=true requires API_TOKEN to be set");
  }

  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "https://roonia.ipchome.com").replace(/\/+$/, "");
  const oauthIssuer = (process.env.OAUTH_ISSUER || publicBaseUrl).replace(/\/+$/, "");
  const oauthApprovalPin =
    typeof process.env.OAUTH_APPROVAL_PIN === "string" && process.env.OAUTH_APPROVAL_PIN.trim() !== ""
      ? process.env.OAUTH_APPROVAL_PIN.trim()
      : apiToken;
  const streamingSourceValue = (process.env.ROON_STREAMING_SOURCE || "tidal")
    .trim()
    .toLowerCase();
  const roonStreamingSource =
    streamingSourceValue === "tidal" || streamingSourceValue === "qobuz"
      ? streamingSourceValue
      : null;
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  const runtimePorts = loadRuntimePortOverrides(dataDir);

  return {
    port: runtimePorts.port ?? intFromEnv(process.env.PORT, 3000),
    portalPort:
      runtimePorts.portalPort ?? intFromEnv(process.env.PORTAL_PORT, 3001),
    enablePortal: boolFromEnv(process.env.ENABLE_PORTAL, true),
    nodeEnv: process.env.NODE_ENV || "production",
    logLevel: process.env.LOG_LEVEL || "info",
    roonExtensionName: process.env.ROON_EXTENSION_NAME || "Roon AI Bridge",
    roonExtensionId:
      process.env.ROON_EXTENSION_ID || "com.local.roon-ai-bridge",
    dataDir,
    enableBrowse: boolFromEnv(process.env.ENABLE_BROWSE),
    enableMcp: boolFromEnv(process.env.ENABLE_MCP),
    enableAuth,
    apiToken,
    portalAdminToken:
      typeof process.env.PORTAL_ADMIN_TOKEN === "string" &&
      process.env.PORTAL_ADMIN_TOKEN.trim() !== ""
        ? process.env.PORTAL_ADMIN_TOKEN.trim()
        : apiToken,
    publicBaseUrl,
    oauthIssuer,
    oauthApprovalPin,
    roonStreamingSource
  };
}
