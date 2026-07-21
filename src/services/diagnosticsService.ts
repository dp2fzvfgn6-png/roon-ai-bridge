import { AppConfig } from "../config/env";
import { APP_VERSION } from "../config/version";
import { RoonClient } from "../roon/roonClient";
import { DATABASE_MIGRATION_IDS, SqliteDatabase } from "../db/database";
import { ActionLogService } from "./actionLogService";
import { TechnicalLogService } from "./technicalLogService";
import { ExtensionManagerService } from "./extensionManagerService";
import { buildToolsManifest } from "./toolManifestService";
import { BridgeV2Context } from "../bridge-v2/context";
import { sanitizeValue } from "./sanitization";

export type DiagnosticsOptions = {
  include_recent_actions?: boolean;
  include_recent_errors?: boolean;
  include_tool_schemas?: boolean;
  sanitize?: boolean;
};

export class DiagnosticsService {
  constructor(
    private readonly config: AppConfig,
    private readonly database: SqliteDatabase,
    private readonly roonClient: RoonClient,
    private readonly actionLogs: ActionLogService,
    private readonly technicalLogs: TechnicalLogService,
    private readonly extensionManager: ExtensionManagerService,
    private readonly mcpContext: BridgeV2Context
  ) {}

  bundle(options: DiagnosticsOptions = {}): Record<string, unknown> {
    const includeActions = options.include_recent_actions !== false;
    const includeErrors = options.include_recent_errors !== false;
    const includeSchemas = options.include_tool_schemas !== false;
    const manifest = buildToolsManifest(this.mcpContext);
    const roon = {
      core_connected: this.roonClient.isCoreConnected(),
      core_name: this.roonClient.getCoreName(),
      transport_ready: this.roonClient.isTransportReady(),
      browse_ready: this.config.enableBrowse && this.roonClient.isBrowseReady(),
      image_ready: this.roonClient.isImageReady(),
      zones_count: this.roonClient.getZones().length,
      outputs_count: this.roonClient.getOutputs().length
    };
    const bundle = {
      generated_at: new Date().toISOString(),
      app: {
        name: "RoonIA",
        version: APP_VERSION,
        commit: process.env.GIT_COMMIT || "unknown",
        tag: process.env.GIT_TAG || null,
        runtime: "node",
        environment: this.config.nodeEnv
      },
      roon,
      mcp: {
        tools_count: manifest.tools_count,
        tools: includeSchemas ? manifest.tools : (manifest.tools as any[]).map((tool) => ({
          name: tool.name,
          description: tool.description,
          schema_hash: tool.schema_hash
        }))
      },
      http: {
        health: "ok",
        ready: this.readyChecks().ready
      },
      database: this.databaseInfo(),
      features: {
        virtual_playlists: true,
        zone_presets: true,
        volume_limits: true,
        widgets: true,
        extension_manager: true,
        observability: true
      },
      extension_manager: this.extensionManager.status(),
      recent_errors: includeErrors ? (this.technicalLogs.errors(25) as any).errors : [],
      recent_actions: includeActions ? (this.actionLogs.list({ limit: 25 }) as any).actions : [],
      warnings: this.warnings(roon, manifest)
    };
    return options.sanitize === false ? bundle : sanitizeValue(bundle) as Record<string, unknown>;
  }

  readyChecks(): Record<string, unknown> {
    const database = this.database.db.prepare("SELECT 1 AS ok").get()?.ok === 1;
    const manifest = buildToolsManifest(this.mcpContext);
    const appliedMigrations = this.database.appliedMigrations();
    const checks = {
      database,
      roon_core: this.roonClient.isCoreConnected() || this.roonClient.getCoreName() !== null,
      mcp_tools: Number(manifest.tools_count) > 0,
      migrations: DATABASE_MIGRATION_IDS.every((id) => appliedMigrations.includes(id))
    };
    return {
      ok: Object.values(checks).every(Boolean),
      ready: Object.values(checks).every(Boolean),
      checks
    };
  }

  version(): Record<string, unknown> {
    return {
      app_version: APP_VERSION,
      commit: process.env.GIT_COMMIT || "unknown",
      tag: process.env.GIT_TAG || null,
      build_time: process.env.BUILD_TIME || null,
      node_version: process.version
    };
  }

  private databaseInfo(): Record<string, unknown> {
    const rows = this.database.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    return {
      connected: true,
      migrations_applied: this.database.appliedMigrations(),
      tables: rows.map((row: any) => row.name)
    };
  }

  private warnings(roon: Record<string, unknown>, manifest: Record<string, unknown>): string[] {
    const warnings: string[] = [];
    if (!roon.core_connected) warnings.push("Roon Core is not connected.");
    if ((manifest.tools_count as number) < 1) warnings.push("MCP tools manifest is empty.");
    warnings.push("Extension Manager mutations are unavailable until a safe backend is detected.");
    return warnings;
  }
}
