import path from "path";

export type AppConfig = {
  port: number;
  nodeEnv: string;
  logLevel: string;
  roonExtensionName: string;
  roonExtensionId: string;
  dataDir: string;
  enableBrowse: boolean;
  enableMcp: boolean;
  enableAuth: boolean;
};

function boolFromEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  return {
    port: intFromEnv(process.env.PORT, 3000),
    nodeEnv: process.env.NODE_ENV || "production",
    logLevel: process.env.LOG_LEVEL || "info",
    roonExtensionName: process.env.ROON_EXTENSION_NAME || "Roon AI Bridge",
    roonExtensionId:
      process.env.ROON_EXTENSION_ID || "com.linestudio.roon-ai-bridge",
    dataDir: process.env.DATA_DIR || path.join(process.cwd(), "data"),
    enableBrowse: boolFromEnv(process.env.ENABLE_BROWSE),
    enableMcp: boolFromEnv(process.env.ENABLE_MCP),
    enableAuth: boolFromEnv(process.env.ENABLE_AUTH)
  };
}
