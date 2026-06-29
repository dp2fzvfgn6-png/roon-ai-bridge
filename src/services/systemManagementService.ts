import fs from "fs";
import os from "os";
import path from "path";
import { AppConfig } from "../config/env";
import { APP_VERSION } from "../config/version";
import { ApiError } from "../utils/errors";
import { Logger } from "../utils/logger";

type VersionStatus = {
  current_version: string;
  latest_version: string | null;
  update_available: boolean | null;
  checked_at: string | null;
  error: string | null;
};

function validatePort(value: unknown, field: string): number {
  const port =
    typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ApiError("INVALID_SYSTEM_CONFIG", `${field} must be a port from 1 to 65535`);
  }
  return port;
}

function serviceAddresses(apiPort: number, portalPort: number) {
  const addresses = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
  return Array.from(new Set(addresses)).map((address) => ({
    address,
    api_url: `http://${address}:${apiPort}`,
    portal_url: `http://${address}:${portalPort}`
  }));
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/i, "")
      .split("-", 1)[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export class SystemManagementService {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly runtimeConfigPath: string;
  private readonly updateRequestPath: string;
  private readonly updateStatusPath: string;
  private versionStatus: VersionStatus = {
    current_version: APP_VERSION,
    latest_version: null,
    update_available: null,
    checked_at: null,
    error: null
  };

  constructor(config: AppConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.runtimeConfigPath = path.join(config.dataDir, "runtime-config.json");
    this.updateRequestPath = path.join(config.dataDir, "update-request.json");
    this.updateStatusPath = path.join(config.dataDir, "update-status.json");
  }

  getSystemInfo(): Record<string, unknown> {
    return {
      version: APP_VERSION,
      api_port: this.config.port,
      portal_port: this.config.portalPort,
      addresses: serviceAddresses(this.config.port, this.config.portalPort),
      version_status: this.versionStatus,
      update_status: this.readUpdateStatus()
    };
  }

  savePorts(input: { api_port?: unknown; portal_port?: unknown }): {
    api_port: number;
    portal_port: number;
    restart_required: boolean;
  } {
    const apiPort = validatePort(input.api_port, "api_port");
    const portalPort = validatePort(input.portal_port, "portal_port");
    if (apiPort === portalPort) {
      throw new ApiError(
        "INVALID_SYSTEM_CONFIG",
        "Bridge and portal ports must be different"
      );
    }
    fs.mkdirSync(this.config.dataDir, { recursive: true });
    fs.writeFileSync(
      this.runtimeConfigPath,
      JSON.stringify({ port: apiPort, portal_port: portalPort }, null, 2),
      { mode: 0o600 }
    );
    return {
      api_port: apiPort,
      portal_port: portalPort,
      restart_required:
        apiPort !== this.config.port || portalPort !== this.config.portalPort
    };
  }

  requestRestart(): { ok: true; action: "restart"; scheduled_in_ms: number } {
    const delay = 750;
    this.logger.warn("Service restart requested");
    setTimeout(() => process.exit(0), delay).unref();
    return { ok: true, action: "restart", scheduled_in_ms: delay };
  }

  async checkForUpdates(): Promise<VersionStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(
        "https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/package.json",
        {
          headers: { "user-agent": `roon-ai-bridge/${APP_VERSION}` },
          signal: controller.signal
        }
      );
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
      const body = (await response.json()) as { version?: unknown };
      const latest =
        typeof body.version === "string" && body.version.trim()
          ? body.version.trim()
          : null;
      if (!latest) throw new Error("Latest package version is missing");
      this.versionStatus = {
        current_version: APP_VERSION,
        latest_version: latest,
        update_available: compareVersions(latest, APP_VERSION) > 0,
        checked_at: new Date().toISOString(),
        error: null
      };
    } catch (error) {
      this.versionStatus = {
        ...this.versionStatus,
        checked_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      clearTimeout(timer);
    }
    return this.versionStatus;
  }

  requestUpdate(): { ok: true; action: "update"; requested_at: string } {
    const requestedAt = new Date().toISOString();
    fs.mkdirSync(this.config.dataDir, { recursive: true });
    fs.writeFileSync(
      this.updateRequestPath,
      JSON.stringify(
        {
          requested_at: requestedAt,
          current_version: APP_VERSION,
          target: "main"
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
    this.logger.warn("Application update requested", { requestedAt });
    return { ok: true, action: "update", requested_at: requestedAt };
  }

  private readUpdateStatus(): Record<string, unknown> | null {
    try {
      return JSON.parse(fs.readFileSync(this.updateStatusPath, "utf8"));
    } catch {
      return null;
    }
  }
}
