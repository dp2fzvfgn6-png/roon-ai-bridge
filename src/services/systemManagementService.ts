import fs from "fs";
import os from "os";
import path from "path";
import { AppConfig } from "../config/env";
import { APP_VERSION } from "../config/version";
import { ApiError } from "../utils/errors";
import { Logger } from "../utils/logger";

type VersionStatus = {
  current_version: string;
  current_build: string | null;
  channel: "stable" | "beta";
  latest_version: string | null;
  latest_build: string | null;
  update_available: boolean | null;
  checked_at: string | null;
  error: string | null;
};

function currentBuild(): string | null {
  const value = process.env.GIT_COMMIT?.trim();
  return value && value !== "unknown" ? value.slice(0, 12) : null;
}

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

function validatePublicUrl(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ApiError("INVALID_SYSTEM_CONFIG", `${field} must be an HTTP or HTTPS URL`);
  }
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new ApiError("INVALID_SYSTEM_CONFIG", `${field} must be an HTTP or HTTPS URL without credentials`);
  }
}

export class SystemManagementService {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly runtimeConfigPath: string;
  private readonly updateRequestPath: string;
  private readonly updateStatusPath: string;
  private versionStatus: VersionStatus;

  constructor(config: AppConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.runtimeConfigPath = path.join(config.dataDir, "runtime-config.json");
    this.updateRequestPath = path.join(config.dataDir, "update-request.json");
    this.updateStatusPath = path.join(config.dataDir, "update-status.json");
    this.versionStatus = {
      current_version: APP_VERSION,
      current_build: currentBuild(),
      channel: this.currentChannel(),
      latest_version: null,
      latest_build: null,
      update_available: null,
      checked_at: null,
      error: null
    };
  }

  getSystemInfo(): Record<string, unknown> {
    return {
      version: APP_VERSION,
      build: currentBuild(),
      api_port: this.config.port,
      portal_port: this.config.portalPort,
      update_channel: this.currentChannel(),
      allow_beta_updates: this.currentChannel() === "beta",
      addresses: serviceAddresses(this.config.port, this.config.portalPort),
      version_status: this.versionStatus,
      update_status: this.readUpdateStatus()
    };
  }

  saveRuntimeConfig(input: { api_port?: unknown; portal_port?: unknown; allow_beta_updates?: unknown; public_base_url?: unknown; portal_base_url?: unknown }): {
    api_port: number;
    portal_port: number;
    update_channel: "stable" | "beta";
    allow_beta_updates: boolean;
    public_base_url: string;
    portal_base_url: string;
    restart_required: boolean;
  } {
    const apiPort = validatePort(input.api_port, "api_port");
    const portalPort = validatePort(input.portal_port, "portal_port");
    const updateChannel = input.allow_beta_updates === true ? "beta" : "stable";
    const publicBaseUrl = validatePublicUrl(input.public_base_url ?? this.config.publicBaseUrl ?? `http://localhost:${apiPort}`, "public_base_url");
    const portalBaseUrl = validatePublicUrl(input.portal_base_url ?? this.config.portalPublicUrl ?? `http://localhost:${portalPort}`, "portal_base_url");
    if (apiPort === portalPort) {
      throw new ApiError(
        "INVALID_SYSTEM_CONFIG",
        "Bridge and portal ports must be different"
      );
    }
    fs.mkdirSync(this.config.dataDir, { recursive: true });
    fs.writeFileSync(
      this.runtimeConfigPath,
      JSON.stringify({
        port: apiPort,
        portal_port: portalPort,
        update_channel: updateChannel,
        public_base_url: publicBaseUrl,
        portal_base_url: portalBaseUrl
      }, null, 2),
      { mode: 0o600 }
    );
    return {
      api_port: apiPort,
      portal_port: portalPort,
      update_channel: updateChannel,
      allow_beta_updates: updateChannel === "beta",
      public_base_url: publicBaseUrl,
      portal_base_url: portalBaseUrl,
      restart_required:
        apiPort !== this.config.port ||
        portalPort !== this.config.portalPort ||
        updateChannel !== this.currentChannel() ||
        Boolean(this.config.publicBaseUrl && publicBaseUrl !== this.config.publicBaseUrl) ||
        Boolean(this.config.portalPublicUrl && portalBaseUrl !== this.config.portalPublicUrl)
    };
  }

  savePorts(input: { api_port?: unknown; portal_port?: unknown }): {
    api_port: number;
    portal_port: number;
    restart_required: boolean;
  } {
    const saved = this.saveRuntimeConfig({
      ...input,
      allow_beta_updates: this.currentChannel() === "beta"
    });
    return {
      api_port: saved.api_port,
      portal_port: saved.portal_port,
      restart_required: saved.restart_required
    };
  }

  requestRestart(): { ok: true; action: "restart"; scheduled_in_ms: number } {
    const delay = 750;
    this.logger.warn("Service restart requested");
    setTimeout(() => process.exit(0), delay).unref();
    return { ok: true, action: "restart", scheduled_in_ms: delay };
  }

  async checkForUpdates(input: { allow_beta_updates?: unknown } = {}): Promise<VersionStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const channel = input.allow_beta_updates === true ? "beta" : "stable";
    const ref = this.updateGitRef(channel);
    try {
      const headers = { "user-agent": `roon-ai-bridge/${APP_VERSION}`, accept: "application/vnd.github+json" };
      const [packageResponse, commitResponse] = await Promise.all([
        fetch(`https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/${ref}/package.json`, { headers, signal: controller.signal }),
        fetch(`https://api.github.com/repos/dp2fzvfgn6-png/roon-ai-bridge/commits/${ref}`, { headers, signal: controller.signal })
      ]);
      if (!packageResponse.ok || !commitResponse.ok) {
        throw new Error(`GitHub returned HTTP ${packageResponse.ok ? commitResponse.status : packageResponse.status}`);
      }
      const body = (await packageResponse.json()) as { version?: unknown };
      const commit = (await commitResponse.json()) as { sha?: unknown };
      const latest =
        typeof body.version === "string" && body.version.trim()
          ? body.version.trim()
          : null;
      if (!latest) throw new Error("Latest package version is missing");
      const latestBuild = typeof commit.sha === "string" ? commit.sha.slice(0, 12) : null;
      if (!latestBuild) throw new Error("Latest build identifier is missing");
      const installedBuild = currentBuild();
      this.versionStatus = {
        current_version: APP_VERSION,
        current_build: installedBuild,
        channel,
        latest_version: latest,
        latest_build: latestBuild,
        update_available: installedBuild
          ? latestBuild !== installedBuild
          : compareVersions(latest, APP_VERSION) > 0 ? true : null,
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

  requestUpdate(input: { allow_beta_updates?: unknown } = {}): { ok: true; action: "update"; target: string; channel: "stable" | "beta"; requested_at: string } {
    const requestedAt = new Date().toISOString();
    const channel = input.allow_beta_updates === undefined
      ? this.currentChannel()
      : input.allow_beta_updates === true ? "beta" : "stable";
    const target = this.updateGitRef(channel);
    fs.mkdirSync(this.config.dataDir, { recursive: true });
    fs.writeFileSync(
      this.updateRequestPath,
      JSON.stringify(
        {
          requested_at: requestedAt,
          current_version: APP_VERSION,
          current_build: currentBuild(),
          channel,
          target
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
    this.logger.warn("Application update requested", {
      requestedAt,
      channel,
      target
    });
    return { ok: true, action: "update", target, channel, requested_at: requestedAt };
  }

  private updateGitRef(channel: "stable" | "beta" = this.currentChannel()): string {
    return channel === "beta" ? "beta" : "main";
  }

  private currentChannel(): "stable" | "beta" {
    return this.config.updateChannel === "beta" ? "beta" : "stable";
  }

  private readUpdateStatus(): Record<string, unknown> | null {
    try {
      return JSON.parse(fs.readFileSync(this.updateStatusPath, "utf8"));
    } catch {
      return null;
    }
  }
}
