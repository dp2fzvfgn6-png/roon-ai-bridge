import { SqliteDatabase } from "../db/database";
import { ApiKeyRecord } from "./apiKeyService";

export type ToolSetting = {
  tool_name: string;
  enabled: boolean;
  updated_at: string | null;
};

export class ToolAccessService {
  constructor(private readonly database: SqliteDatabase) {}

  list(toolNames: string[]): ToolSetting[] {
    const rows = this.database.db
      .prepare("SELECT tool_name, enabled, updated_at FROM tool_settings")
      .all() as Array<{ tool_name: string; enabled: number; updated_at: string }>;
    const stored = new Map(rows.map((row) => [row.tool_name, row]));
    return Array.from(new Set(toolNames)).sort().map((toolName) => ({
      tool_name: toolName,
      enabled: stored.get(toolName)?.enabled !== 0,
      updated_at: stored.get(toolName)?.updated_at || null
    }));
  }

  isGloballyEnabled(toolName: string): boolean {
    const row = this.database.db
      .prepare("SELECT enabled FROM tool_settings WHERE tool_name = ?")
      .get(toolName) as { enabled?: number } | undefined;
    return row?.enabled !== 0;
  }

  setEnabled(toolName: string, enabled: boolean): ToolSetting {
    const updatedAt = new Date().toISOString();
    this.database.db.prepare(
      `INSERT INTO tool_settings (tool_name, enabled, updated_at)
       VALUES (:tool_name, :enabled, :updated_at)
       ON CONFLICT(tool_name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
    ).run({ tool_name: toolName, enabled: enabled ? 1 : 0, updated_at: updatedAt });
    return { tool_name: toolName, enabled, updated_at: updatedAt };
  }

  canUse(toolName: string, apiKey?: ApiKeyRecord | null): boolean {
    if (!this.isGloballyEnabled(toolName)) return false;
    if (!apiKey || apiKey.tool_permissions === null) return true;
    return apiKey.tool_permissions.includes(toolName);
  }
}
