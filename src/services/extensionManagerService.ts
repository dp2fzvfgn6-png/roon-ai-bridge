import fs from "fs";
import path from "path";
import { AppConfig } from "../config/env";
import { APP_VERSION } from "../config/version";
import { TechnicalLogService } from "./technicalLogService";

export type ExtensionLogQuery = {
  limit?: number;
  level?: "debug" | "info" | "warn" | "error";
};

const ROONIA_EXTENSION_ID = "roonia";

export class ExtensionManagerService {
  constructor(
    private readonly config: AppConfig,
    private readonly technicalLogs?: TechnicalLogService
  ) {}

  status(): Record<string, unknown> {
    const deployment = this.deploymentType();
    return {
      ok: true,
      manager_available: true,
      manager_type: deployment,
      capabilities: {
        list: true,
        logs: Boolean(this.technicalLogs),
        restart: false,
        install: false,
        update: false,
        delete: false,
        enable: false,
        disable: false
      },
      allowed_services: [ROONIA_EXTENSION_ID],
      warnings: [
        "No safe Roon Extension Manager API was detected. RoonIA exposes read-only diagnostics and blocks extension mutations."
      ]
    };
  }

  listExtensions(roonState?: Record<string, unknown>): Record<string, unknown> {
    return {
      ok: true,
      extensions: [this.rooniaExtension(roonState)]
    };
  }

  getExtensionDetails(extensionId: string, roonState?: Record<string, unknown>): Record<string, unknown> {
    if (extensionId !== ROONIA_EXTENSION_ID && extensionId !== this.config.roonExtensionId) {
      return {
        ok: false,
        error: {
          code: "EXTENSION_NOT_FOUND",
          message: "Only the local RoonIA extension can be inspected without a real Extension Manager backend."
        }
      };
    }
    return {
      ok: true,
      extension: this.rooniaExtension(roonState),
      limitations: [
        "Roon Core does not expose a safe extension process-management API to this bridge.",
        "Install, update, enable and disable are intentionally unavailable in this release."
      ]
    };
  }

  getExtensionLogs(extensionId: string, query: ExtensionLogQuery = {}): Record<string, unknown> {
    if (extensionId !== ROONIA_EXTENSION_ID && extensionId !== this.config.roonExtensionId) {
      return {
        ok: false,
        error: { code: "EXTENSION_NOT_FOUND", message: "Extension is not in the read-only allowlist." }
      };
    }
    if (!this.technicalLogs) {
      return { ok: true, logs: [], warnings: ["Technical log service is not available in this context."] };
    }
    return this.technicalLogs.list({
      component: "roon-ai-bridge",
      level: query.level,
      limit: query.limit || 100
    });
  }

  mutationUnavailable(tool: string, extensionId: string, confirm?: boolean): Record<string, unknown> {
    if (!confirm) {
      return {
        ok: false,
        requires_confirmation: true,
        confirmation_reason: "extension_management_action",
        human_summary: "Extension management changes are blocked unless explicitly confirmed.",
        confirm_payload: {
          tool,
          arguments: { extension_id: extensionId, confirm: true }
        }
      };
    }
    if (extensionId !== ROONIA_EXTENSION_ID && extensionId !== this.config.roonExtensionId) {
      return {
        ok: false,
        error: { code: "EXTENSION_NOT_ALLOWED", message: "Extension is not in the management allowlist." }
      };
    }
    return {
      ok: false,
      error: {
        code: "EXTENSION_MUTATION_UNAVAILABLE",
        message: "No safe Extension Manager backend is available for this mutation."
      },
      manager_type: this.deploymentType(),
      warnings: ["Read-only diagnostics are available; service restart remains available only through the existing admin system endpoint."]
    };
  }

  private rooniaExtension(roonState?: Record<string, unknown>): Record<string, unknown> {
    return {
      extension_id: ROONIA_EXTENSION_ID,
      roon_extension_id: this.config.roonExtensionId,
      name: "RoonIA",
      status: "running",
      version: APP_VERSION,
      deployment: this.deploymentType(),
      connected_to_core: Boolean(roonState?.core_connected),
      last_seen: new Date().toISOString(),
      logs_available: Boolean(this.technicalLogs)
    };
  }

  private deploymentType(): "docker" | "systemd" | "lxc" | "node" | "unknown" {
    if (fs.existsSync("/.dockerenv")) return "docker";
    try {
      const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
      if (/docker|containerd/i.test(cgroup)) return "docker";
      if (/lxc/i.test(cgroup)) return "lxc";
    } catch {}
    if (process.env.INVOCATION_ID || process.env.JOURNAL_STREAM) return "systemd";
    if (path.basename(process.argv[0] || "").toLowerCase().includes("node")) return "node";
    return "unknown";
  }
}
