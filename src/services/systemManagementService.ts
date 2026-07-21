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
  image_available: boolean | null;
  checked_at: string | null;
  error: string | null;
};

type BetaExitPolicy = {
  mode: "wait_for_stable";
  requested_at: string;
  installed_version: string;
  installed_build: string | null;
};

type UpdateChannel = "stable" | "beta";

class PublishedImageUnavailableError extends Error {
  constructor(readonly channel: UpdateChannel) {
    super(`No published ${channel} image is available`);
  }
}

const AUTOMATIC_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TEMPORARY_PLAYLIST_EXPIRY_DAYS = 7;
const PUBLISH_WORKFLOW_FILE = "publish-image.yml";

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

function validateTemporaryPlaylistExpiryDays(value: unknown): number {
  const days = typeof value === "number"
    ? value
    : Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new ApiError(
      "INVALID_SYSTEM_CONFIG",
      "temporary_playlist_expiry_days must be an integer from 1 to 365"
    );
  }
  return days;
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
  private readonly versionStatusPath: string;
  private versionStatus: VersionStatus;
  private automaticUpdateChecks: boolean;
  private debugMode: boolean;
  private temporaryPlaylistExpiryDays: number;
  private selectedUpdateChannel: "stable" | "beta";
  private betaExitPolicy: BetaExitPolicy | null;
  private automaticCheckTimer: NodeJS.Timeout | null = null;

  constructor(config: AppConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.runtimeConfigPath = path.join(config.dataDir, "runtime-config.json");
    this.updateRequestPath = path.join(config.dataDir, "update-request.json");
    this.updateStatusPath = path.join(config.dataDir, "update-status.json");
    this.versionStatusPath = path.join(config.dataDir, "version-status.json");
    const runtimeConfig = this.readRuntimeConfig();
    this.selectedUpdateChannel = runtimeConfig.update_channel === "beta"
      ? "beta"
      : runtimeConfig.update_channel === "stable"
        ? "stable"
        : config.updateChannel === "beta" ? "beta" : "stable";
    this.betaExitPolicy = this.parseBetaExitPolicy(runtimeConfig.beta_exit_policy);
    this.automaticUpdateChecks = config.automaticUpdateChecks !== false;
    this.debugMode = typeof runtimeConfig.debug_mode === "boolean"
      ? runtimeConfig.debug_mode
      : config.debugMode === true;
    const configuredExpiryDays = runtimeConfig.temporary_playlist_expiry_days;
    this.temporaryPlaylistExpiryDays = Number.isInteger(configuredExpiryDays) &&
      Number(configuredExpiryDays) >= 1 && Number(configuredExpiryDays) <= 365
      ? Number(configuredExpiryDays)
      : DEFAULT_TEMPORARY_PLAYLIST_EXPIRY_DAYS;
    this.versionStatus = this.readVersionStatus() || {
      current_version: APP_VERSION,
      current_build: currentBuild(),
      channel: this.currentChannel(),
      latest_version: null,
      latest_build: null,
      update_available: null,
      image_available: null,
      checked_at: null,
      error: null
    };
  }

  getSystemInfo(): Record<string, unknown> {
    const updateStatus = this.readUpdateStatus();
    return {
      version: APP_VERSION,
      build: currentBuild(),
      api_port: this.config.port,
      portal_port: this.config.portalPort,
      update_channel: this.currentChannel(),
      installed_channel: this.installedChannel(updateStatus),
      allow_beta_updates: this.currentChannel() === "beta" && !this.betaExitPolicy,
      beta_exit_policy: this.betaExitPolicy,
      automatic_update_checks: this.automaticUpdateChecks,
      debug_mode: this.debugMode,
      temporary_playlist_expiry_days: this.temporaryPlaylistExpiryDays,
      addresses: serviceAddresses(this.config.port, this.config.portalPort),
      version_status: this.versionStatus,
      update_status: updateStatus
    };
  }

  saveRuntimeConfig(input: { api_port?: unknown; portal_port?: unknown; allow_beta_updates?: unknown; automatic_update_checks?: unknown; debug_mode?: unknown; public_base_url?: unknown; portal_base_url?: unknown }): {
    api_port: number;
    portal_port: number;
    update_channel: "stable" | "beta";
    allow_beta_updates: boolean;
    automatic_update_checks: boolean;
    debug_mode: boolean;
    public_base_url: string;
    portal_base_url: string;
    restart_required: boolean;
  } {
    const apiPort = validatePort(input.api_port, "api_port");
    const portalPort = validatePort(input.portal_port, "portal_port");
    const updateChannel = input.allow_beta_updates === undefined
      ? this.currentChannel()
      : input.allow_beta_updates === true ? "beta" : "stable";
    const automaticUpdateChecks = input.automatic_update_checks === undefined
      ? this.automaticUpdateChecks
      : input.automatic_update_checks === true;
    const debugMode = input.debug_mode === undefined
      ? this.debugMode
      : input.debug_mode === true;
    const publicBaseUrl = validatePublicUrl(input.public_base_url ?? this.config.publicBaseUrl ?? `http://localhost:${apiPort}`, "public_base_url");
    const portalBaseUrl = validatePublicUrl(input.portal_base_url ?? this.config.portalPublicUrl ?? `http://localhost:${portalPort}`, "portal_base_url");
    if (apiPort === portalPort) {
      throw new ApiError(
        "INVALID_SYSTEM_CONFIG",
        "Bridge and portal ports must be different"
      );
    }
    const current = this.readRuntimeConfig();
    this.writeRuntimeConfig({
      ...current,
      port: apiPort,
      portal_port: portalPort,
      update_channel: updateChannel,
      automatic_update_checks: automaticUpdateChecks,
      debug_mode: debugMode,
      public_base_url: publicBaseUrl,
      portal_base_url: portalBaseUrl,
      beta_exit_policy: input.allow_beta_updates === undefined
        ? this.betaExitPolicy
        : null
    });
    const previousChannel = this.currentChannel();
    if (input.allow_beta_updates !== undefined) {
      this.selectedUpdateChannel = updateChannel;
      this.betaExitPolicy = null;
    }
    if (input.automatic_update_checks !== undefined) {
      this.setAutomaticUpdateChecks(automaticUpdateChecks);
    }
    if (input.debug_mode !== undefined) {
      this.debugMode = debugMode;
    }
    return {
      api_port: apiPort,
      portal_port: portalPort,
      update_channel: updateChannel,
      allow_beta_updates: updateChannel === "beta",
      automatic_update_checks: automaticUpdateChecks,
      debug_mode: debugMode,
      public_base_url: publicBaseUrl,
      portal_base_url: portalBaseUrl,
      restart_required:
        apiPort !== this.config.port ||
        portalPort !== this.config.portalPort ||
        updateChannel !== previousChannel ||
        Boolean(this.config.publicBaseUrl && publicBaseUrl !== this.config.publicBaseUrl) ||
        Boolean(this.config.portalPublicUrl && portalBaseUrl !== this.config.portalPublicUrl)
    };
  }

  saveUpdatePreferences(input: { automatic_update_checks?: unknown }): {
    automatic_update_checks: boolean;
  } {
    if (typeof input.automatic_update_checks !== "boolean") {
      throw new ApiError(
        "INVALID_SYSTEM_CONFIG",
        "automatic_update_checks must be a boolean"
      );
    }
    const automaticUpdateChecks = input.automatic_update_checks;
    const current = this.readRuntimeConfig();
    this.writeRuntimeConfig({
      ...current,
      port: current.port ?? this.config.port,
      portal_port: current.portal_port ?? this.config.portalPort,
      update_channel: current.update_channel ?? this.currentChannel(),
      automatic_update_checks: automaticUpdateChecks,
      public_base_url: current.public_base_url ?? this.config.publicBaseUrl,
      portal_base_url: current.portal_base_url ?? this.config.portalPublicUrl
    });
    this.setAutomaticUpdateChecks(automaticUpdateChecks);
    this.logger.info("Automatic update checks changed", {
      enabled: automaticUpdateChecks
    });
    return { automatic_update_checks: automaticUpdateChecks };
  }

  saveDebugPreferences(input: { debug_mode?: unknown }): { debug_mode: boolean } {
    if (typeof input.debug_mode !== "boolean") {
      throw new ApiError(
        "INVALID_SYSTEM_CONFIG",
        "debug_mode must be a boolean"
      );
    }
    this.debugMode = input.debug_mode;
    const current = this.readRuntimeConfig();
    this.writeRuntimeConfig({
      ...current,
      port: current.port ?? this.config.port,
      portal_port: current.portal_port ?? this.config.portalPort,
      update_channel: current.update_channel ?? this.currentChannel(),
      automatic_update_checks: current.automatic_update_checks ?? this.automaticUpdateChecks,
      debug_mode: this.debugMode,
      public_base_url: current.public_base_url ?? this.config.publicBaseUrl,
      portal_base_url: current.portal_base_url ?? this.config.portalPublicUrl
    });
    this.logger.info("Debug mode changed", { enabled: this.debugMode });
    return { debug_mode: this.debugMode };
  }

  getTemporaryPlaylistExpiryDays(): number {
    return this.temporaryPlaylistExpiryDays;
  }

  savePlaylistPreferences(input: { temporary_playlist_expiry_days?: unknown }): {
    temporary_playlist_expiry_days: number;
  } {
    const days = validateTemporaryPlaylistExpiryDays(input.temporary_playlist_expiry_days);
    const current = this.readRuntimeConfig();
    this.temporaryPlaylistExpiryDays = days;
    this.writeRuntimeConfig({
      ...current,
      port: current.port ?? this.config.port,
      portal_port: current.portal_port ?? this.config.portalPort,
      update_channel: current.update_channel ?? this.currentChannel(),
      automatic_update_checks: current.automatic_update_checks ?? this.automaticUpdateChecks,
      debug_mode: current.debug_mode ?? this.debugMode,
      temporary_playlist_expiry_days: days,
      public_base_url: current.public_base_url ?? this.config.publicBaseUrl,
      portal_base_url: current.portal_base_url ?? this.config.portalPublicUrl
    });
    this.logger.info("Temporary playlist expiry changed", { days });
    return { temporary_playlist_expiry_days: days };
  }

  changeUpdateChannel(input: { allow_beta_updates?: unknown; strategy?: unknown }): Record<string, unknown> {
    if (typeof input.allow_beta_updates !== "boolean") {
      throw new ApiError(
        "INVALID_SYSTEM_CONFIG",
        "allow_beta_updates must be a boolean"
      );
    }
    if (input.allow_beta_updates) {
      this.selectedUpdateChannel = "beta";
      this.betaExitPolicy = null;
      this.resetVersionStatus("beta");
      this.persistChannelState();
      this.stopAutomaticChecks();
      this.startAutomaticChecks();
      this.logger.info("Beta update channel enabled");
      return {
        ok: true,
        update_channel: "beta",
        installed_channel: this.installedChannel(),
        allow_beta_updates: true,
        beta_exit_policy: null
      };
    }
    if (this.currentChannel() !== "beta") {
      throw new ApiError(
        "INVALID_SYSTEM_CONFIG",
        "The beta channel is not currently enabled"
      );
    }
    if (this.installedChannel() !== "beta") {
      this.selectedUpdateChannel = "stable";
      this.betaExitPolicy = null;
      this.resetVersionStatus("stable");
      this.persistChannelState();
      this.stopAutomaticChecks();
      this.startAutomaticChecks();
      this.logger.info("Beta update channel disabled from a stable installation");
      return {
        ok: true,
        update_channel: "stable",
        installed_channel: "stable",
        allow_beta_updates: false,
        beta_exit_policy: null
      };
    }
    if (!['install_stable', 'wait_for_stable'].includes(String(input.strategy))) {
      throw new ApiError(
        "INVALID_SYSTEM_CONFIG",
        "strategy must be install_stable or wait_for_stable"
      );
    }
    if (input.strategy === "install_stable") {
      const updateRequest = this.requestUpdate({ allow_beta_updates: false });
      this.selectedUpdateChannel = "stable";
      this.betaExitPolicy = null;
      this.resetVersionStatus("stable");
      this.persistChannelState();
      this.logger.warn("Immediate switch from beta to stable requested", {
        requestedAt: updateRequest.requested_at
      });
      return {
        ok: true,
        update_channel: "stable",
        installed_channel: this.installedChannel(),
        allow_beta_updates: false,
        beta_exit_policy: null,
        update_request: updateRequest
      };
    }
    this.betaExitPolicy = {
      mode: "wait_for_stable",
      requested_at: new Date().toISOString(),
      installed_version: APP_VERSION,
      installed_build: currentBuild()
    };
    this.resetVersionStatus("stable");
    this.persistChannelState();
    this.stopAutomaticChecks();
    this.startAutomaticChecks();
    this.logger.info("Beta exit deferred until stable catches up", {
      installedVersion: APP_VERSION,
      installedBuild: currentBuild()
    });
    return {
      ok: true,
      update_channel: "beta",
      installed_channel: this.installedChannel(),
      allow_beta_updates: false,
      beta_exit_policy: this.betaExitPolicy
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

  startAutomaticChecks(): void {
    if (!this.shouldRunScheduledChecks() || this.automaticCheckTimer) return;
    const checkedAt = this.versionStatus.checked_at
      ? Date.parse(this.versionStatus.checked_at)
      : Number.NaN;
    const currentChannel = this.checkChannel();
    const delay =
      this.versionStatus.channel !== currentChannel || !Number.isFinite(checkedAt)
        ? 0
        : Math.min(
            AUTOMATIC_UPDATE_INTERVAL_MS,
            Math.max(0, AUTOMATIC_UPDATE_INTERVAL_MS - (Date.now() - checkedAt))
          );
    this.scheduleAutomaticCheck(delay);
  }

  stopAutomaticChecks(): void {
    if (!this.automaticCheckTimer) return;
    clearTimeout(this.automaticCheckTimer);
    this.automaticCheckTimer = null;
  }

  requestRestart(): { ok: true; action: "restart"; scheduled_in_ms: number } {
    const delay = 750;
    this.logger.warn("Service restart requested");
    setTimeout(() => process.kill(process.pid, "SIGTERM"), delay).unref();
    return { ok: true, action: "restart", scheduled_in_ms: delay };
  }

  async checkForUpdates(input: { allow_beta_updates?: unknown } = {}): Promise<VersionStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const channel = this.betaExitPolicy
      ? "stable"
      : input.allow_beta_updates === undefined
        ? this.checkChannel()
        : input.allow_beta_updates === true ? "beta" : "stable";
    const ref = this.updateGitRef(channel);
    try {
      const headers = { "user-agent": `roon-ai-bridge/${APP_VERSION}`, accept: "application/vnd.github+json" };
      const runsResponse = await fetch(
        `https://api.github.com/repos/dp2fzvfgn6-png/roon-ai-bridge/actions/workflows/${PUBLISH_WORKFLOW_FILE}/runs?branch=${ref}&status=completed&per_page=20`,
        { headers, signal: controller.signal }
      );
      if (!runsResponse.ok) {
        throw new Error(`GitHub returned HTTP ${runsResponse.status}`);
      }
      const runs = (await runsResponse.json()) as {
        workflow_runs?: Array<{ head_sha?: unknown; conclusion?: unknown }>;
      };
      const publishedRun = Array.isArray(runs.workflow_runs)
        ? runs.workflow_runs.find((run) => run.conclusion === "success" && typeof run.head_sha === "string")
        : null;
      const publishedCommit = typeof publishedRun?.head_sha === "string"
        ? publishedRun.head_sha
        : null;
      if (!publishedCommit) throw new PublishedImageUnavailableError(channel);

      const packageResponse = await fetch(
        `https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/${publishedCommit}/package.json`,
        { headers, signal: controller.signal }
      );
      if (!packageResponse.ok) throw new Error(`GitHub returned HTTP ${packageResponse.status}`);
      const body = (await packageResponse.json()) as { version?: unknown };
      const latest =
        typeof body.version === "string" && body.version.trim()
          ? body.version.trim()
          : null;
      if (!latest) throw new Error("Latest package version is missing");
      const latestBuild = publishedCommit.slice(0, 12);
      if (!latestBuild) throw new Error("Latest build identifier is missing");
      const installedBuild = currentBuild();
      const waitingForStable = Boolean(this.betaExitPolicy && channel === "stable");
      const stableHasCaughtUp = waitingForStable && compareVersions(latest, this.betaExitPolicy!.installed_version) >= 0;
      const updateAvailable = waitingForStable
        ? stableHasCaughtUp
        : installedBuild
          ? latestBuild !== installedBuild
          : compareVersions(latest, APP_VERSION) > 0 ? true : null;
      this.versionStatus = {
        current_version: APP_VERSION,
        current_build: installedBuild,
        channel,
        latest_version: latest,
        latest_build: latestBuild,
        update_available: updateAvailable,
        image_available: true,
        checked_at: new Date().toISOString(),
        error: null
      };
      this.logger.info("Update check completed", {
        channel,
        latestVersion: latest,
        latestBuild,
        updateAvailable: this.versionStatus.update_available
      });
      if (stableHasCaughtUp) {
        const updateRequest = this.writeUpdateRequest("stable");
        this.selectedUpdateChannel = "stable";
        this.betaExitPolicy = null;
        this.persistChannelState();
        this.logger.warn("Stable channel caught up; automatic switch requested", {
          stableVersion: latest,
          requestedAt: updateRequest.requested_at
        });
      }
    } catch (error) {
      const noPublishedImage = error instanceof PublishedImageUnavailableError;
      const sameChannel = this.versionStatus.channel === channel;
      this.versionStatus = {
        current_version: APP_VERSION,
        current_build: currentBuild(),
        channel,
        latest_version: noPublishedImage ? null : sameChannel ? this.versionStatus.latest_version : null,
        latest_build: noPublishedImage ? null : sameChannel ? this.versionStatus.latest_build : null,
        update_available: noPublishedImage ? false : sameChannel ? this.versionStatus.update_available : null,
        image_available: noPublishedImage ? false : sameChannel ? this.versionStatus.image_available : null,
        checked_at: new Date().toISOString(),
        error: noPublishedImage ? null : error instanceof Error ? error.message : String(error)
      };
      if (noPublishedImage) {
        this.logger.info("No published image is available for the selected update channel", { channel });
      } else {
        this.logger.warn("Update check failed", {
          channel,
          error: this.versionStatus.error
        });
      }
    } finally {
      clearTimeout(timer);
    }
    this.persistVersionStatus();
    return this.versionStatus;
  }

  requestUpdate(input: { allow_beta_updates?: unknown } = {}): { ok: true; action: "update"; target: string; channel: "stable" | "beta"; requested_at: string } {
    if (this.betaExitPolicy) {
      throw new ApiError(
        "INVALID_SYSTEM_CONFIG",
        "The stable channel has not caught up with the retained beta yet"
      );
    }
    const channel = input.allow_beta_updates === undefined
      ? this.currentChannel()
      : input.allow_beta_updates === true ? "beta" : "stable";
    return this.writeUpdateRequest(channel);
  }

  private writeUpdateRequest(channel: "stable" | "beta"): { ok: true; action: "update"; target: string; channel: "stable" | "beta"; requested_at: string } {
    const requestedAt = new Date().toISOString();
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
          target,
          image_tag: channel
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

  private setAutomaticUpdateChecks(enabled: boolean): void {
    this.automaticUpdateChecks = enabled;
    if (this.shouldRunScheduledChecks()) this.startAutomaticChecks();
    else this.stopAutomaticChecks();
  }

  private scheduleAutomaticCheck(delay: number): void {
    if (!this.shouldRunScheduledChecks()) return;
    if (this.automaticCheckTimer) clearTimeout(this.automaticCheckTimer);
    this.automaticCheckTimer = setTimeout(() => {
      this.automaticCheckTimer = null;
      void this.runAutomaticCheck();
    }, delay);
    this.automaticCheckTimer.unref();
  }

  private async runAutomaticCheck(): Promise<void> {
    if (!this.shouldRunScheduledChecks()) return;
    this.logger.info("Running automatic update check", {
      channel: this.checkChannel(),
      betaExitPending: Boolean(this.betaExitPolicy)
    });
    await this.checkForUpdates();
    if (this.shouldRunScheduledChecks()) {
      this.scheduleAutomaticCheck(AUTOMATIC_UPDATE_INTERVAL_MS);
    }
  }

  private shouldRunScheduledChecks(): boolean {
    return this.automaticUpdateChecks || Boolean(this.betaExitPolicy);
  }

  private checkChannel(): "stable" | "beta" {
    return this.betaExitPolicy ? "stable" : this.currentChannel();
  }

  private readRuntimeConfig(): Record<string, unknown> {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.runtimeConfigPath, "utf8")
      ) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private writeRuntimeConfig(config: Record<string, unknown>): void {
    fs.mkdirSync(this.config.dataDir, { recursive: true });
    fs.writeFileSync(
      this.runtimeConfigPath,
      JSON.stringify(config, null, 2),
      { mode: 0o600 }
    );
  }

  private parseBetaExitPolicy(value: unknown): BetaExitPolicy | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const policy = value as Record<string, unknown>;
    if (
      policy.mode !== "wait_for_stable" ||
      typeof policy.requested_at !== "string" ||
      typeof policy.installed_version !== "string"
    ) return null;
    return {
      mode: "wait_for_stable",
      requested_at: policy.requested_at,
      installed_version: policy.installed_version,
      installed_build: typeof policy.installed_build === "string"
        ? policy.installed_build
        : null
    };
  }

  private persistChannelState(): void {
    const current = this.readRuntimeConfig();
    this.writeRuntimeConfig({
      ...current,
      port: current.port ?? this.config.port,
      portal_port: current.portal_port ?? this.config.portalPort,
      update_channel: this.currentChannel(),
      automatic_update_checks: this.automaticUpdateChecks,
      debug_mode: this.debugMode,
      public_base_url: current.public_base_url ?? this.config.publicBaseUrl,
      portal_base_url: current.portal_base_url ?? this.config.portalPublicUrl,
      beta_exit_policy: this.betaExitPolicy
    });
  }

  private readVersionStatus(): VersionStatus | null {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.versionStatusPath, "utf8")
      ) as Record<string, unknown>;
      const installedBuild = currentBuild();
      if (
        parsed.current_version !== APP_VERSION ||
        parsed.current_build !== installedBuild ||
        !["stable", "beta"].includes(String(parsed.channel))
      ) {
        return null;
      }
      return {
        current_version: APP_VERSION,
        current_build: installedBuild,
        channel: parsed.channel as "stable" | "beta",
        latest_version:
          typeof parsed.latest_version === "string" ? parsed.latest_version : null,
        latest_build:
          typeof parsed.latest_build === "string" ? parsed.latest_build : null,
        update_available:
          typeof parsed.update_available === "boolean"
            ? parsed.update_available
            : null,
        image_available:
          typeof parsed.image_available === "boolean"
            ? parsed.image_available
            : null,
        checked_at:
          typeof parsed.checked_at === "string" ? parsed.checked_at : null,
        error: typeof parsed.error === "string" ? parsed.error : null
      };
    } catch {
      return null;
    }
  }

  private persistVersionStatus(): void {
    try {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
      fs.writeFileSync(
        this.versionStatusPath,
        JSON.stringify(this.versionStatus, null, 2),
        { mode: 0o600 }
      );
    } catch (error) {
      this.logger.warn("Could not persist update check status", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private resetVersionStatus(channel: "stable" | "beta"): void {
    this.versionStatus = {
      current_version: APP_VERSION,
      current_build: currentBuild(),
      channel,
      latest_version: null,
      latest_build: null,
      update_available: null,
      image_available: null,
      checked_at: null,
      error: null
    };
    this.persistVersionStatus();
  }

  private updateGitRef(channel: "stable" | "beta" = this.currentChannel()): string {
    return channel === "beta" ? "beta" : "main";
  }

  private currentChannel(): "stable" | "beta" {
    return this.selectedUpdateChannel;
  }

  private installedChannel(updateStatus: Record<string, unknown> | null = this.readUpdateStatus()): UpdateChannel {
    const installedBuild = currentBuild();
    if (
      updateStatus?.state === "completed" &&
      typeof updateStatus.build === "string" &&
      installedBuild !== null &&
      updateStatus.build.slice(0, 12) === installedBuild
    ) {
      if (updateStatus.target === "beta") return "beta";
      if (updateStatus.target === "main") return "stable";
    }
    if (this.betaExitPolicy) return "beta";
    if (process.env.INSTALLED_CHANNEL === "beta") return "beta";
    if (process.env.INSTALLED_CHANNEL === "stable") return "stable";
    return "stable";
  }

  private readUpdateStatus(): Record<string, unknown> | null {
    try {
      return JSON.parse(fs.readFileSync(this.updateStatusPath, "utf8"));
    } catch {
      return null;
    }
  }
}
