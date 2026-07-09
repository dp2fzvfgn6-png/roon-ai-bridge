import crypto from "crypto";
import { SqliteDatabase } from "../db/database";
import { sanitizeValue } from "./sanitization";

export type ActionLogInput = {
  source: "mcp" | "http" | "portal" | "system";
  toolOrEndpoint: string;
  classification?: Record<string, unknown>;
  arguments?: unknown;
  result?: unknown;
  durationMs: number;
  dryRun?: boolean;
  requiresConfirmation?: boolean;
  confirmed?: boolean;
  warnings?: string[];
  errorCode?: string | null;
  correlationId?: string | null;
};

export type ActionLogQuery = {
  limit?: number;
  offset?: number;
  tool?: string;
  source?: string;
  errorOnly?: boolean;
  mutationOnly?: boolean;
};

export class ActionLogService {
  private readonly maxEntries = 5000;
  private readonly retentionDays = 30;

  constructor(private readonly database: SqliteDatabase) {}

  record(input: ActionLogInput): Record<string, unknown> {
    const actionId = `act_${crypto.randomBytes(9).toString("hex")}`;
    const timestamp = new Date().toISOString();
    const classification = input.classification || { read_only: true, mutation: false, destructive: false };
    const result = sanitizeValue(input.result || { ok: true });
    const args = sanitizeValue(input.arguments || {});
    const warnings = (input.warnings || []).map((warning) => String(sanitizeValue(warning)));
    const errorCode = input.errorCode || this.errorCodeFromResult(result);

    this.database.db.prepare(`
      INSERT INTO action_logs (
        action_id, timestamp, source, tool_or_endpoint, classification_json,
        arguments_sanitized_json, result_json, duration_ms, dry_run,
        requires_confirmation, confirmed, warnings_json, error_code, correlation_id
      ) VALUES (
        :action_id, :timestamp, :source, :tool_or_endpoint, :classification_json,
        :arguments_sanitized_json, :result_json, :duration_ms, :dry_run,
        :requires_confirmation, :confirmed, :warnings_json, :error_code, :correlation_id
      )
    `).run({
      action_id: actionId,
      timestamp,
      source: input.source,
      tool_or_endpoint: input.toolOrEndpoint,
      classification_json: JSON.stringify(classification),
      arguments_sanitized_json: JSON.stringify(args),
      result_json: JSON.stringify(result),
      duration_ms: Math.max(0, Math.round(input.durationMs)),
      dry_run: input.dryRun ? 1 : 0,
      requires_confirmation: input.requiresConfirmation ? 1 : 0,
      confirmed: input.confirmed ? 1 : 0,
      warnings_json: JSON.stringify(warnings),
      error_code: errorCode,
      correlation_id: input.correlationId || null
    });
    this.prune();
    return this.get(actionId) || { action_id: actionId, timestamp };
  }

  list(query: ActionLogQuery = {}): Record<string, unknown> {
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 250);
    const offset = Math.max(Number(query.offset || 0), 0);
    const clauses: string[] = [];
    const filterParams: Record<string, unknown> = {};
    const params: Record<string, unknown> = { limit, offset };
    if (query.tool) {
      clauses.push("tool_or_endpoint = :tool");
      params.tool = query.tool;
      filterParams.tool = query.tool;
    }
    if (query.source) {
      clauses.push("source = :source");
      params.source = query.source;
      filterParams.source = query.source;
    }
    if (query.errorOnly) clauses.push("error_code IS NOT NULL");
    if (query.mutationOnly) clauses.push("json_extract(classification_json, '$.mutation') = 1");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database.db.prepare(`
      SELECT * FROM action_logs ${where}
      ORDER BY timestamp DESC
      LIMIT :limit OFFSET :offset
    `).all(params);
    const total = this.database.db.prepare(`SELECT COUNT(*) AS count FROM action_logs ${where}`).get(filterParams)?.count || 0;
    return {
      ok: true,
      actions: rows.map((row: any) => this.rowToLog(row)),
      total,
      limit,
      offset,
      retention: { max_entries: this.maxEntries, retention_days: this.retentionDays }
    };
  }

  get(actionId: string): Record<string, unknown> | null {
    const row = this.database.db.prepare("SELECT * FROM action_logs WHERE action_id = ?").get(actionId);
    return row ? this.rowToLog(row) : null;
  }

  clear(confirm?: boolean): Record<string, unknown> {
    if (!confirm) {
      return {
        ok: false,
        requires_confirmation: true,
        confirmation_reason: "clear_action_logs",
        human_summary: "Clearing the action log removes local audit history.",
        confirm_payload: {
          tool: "roon_clear_action_logs",
          arguments: { confirm: true }
        }
      };
    }
    const before = this.database.db.prepare("SELECT COUNT(*) AS count FROM action_logs").get()?.count || 0;
    this.database.db.prepare("DELETE FROM action_logs").run();
    return { ok: true, cleared: before };
  }

  private prune(): void {
    this.database.db.prepare(`
      DELETE FROM action_logs
      WHERE timestamp < datetime('now', :retention)
    `).run({ retention: `-${this.retentionDays} days` });
    this.database.db.prepare(`
      DELETE FROM action_logs
      WHERE action_id NOT IN (
        SELECT action_id FROM action_logs ORDER BY timestamp DESC LIMIT :max
      )
    `).run({ max: this.maxEntries });
  }

  private errorCodeFromResult(result: unknown): string | null {
    const value = result as any;
    if (value?.ok === false) return value.error?.code || value.error_code || "ERROR";
    return null;
  }

  private rowToLog(row: any): Record<string, unknown> {
    return {
      action_id: row.action_id,
      timestamp: row.timestamp,
      source: row.source,
      tool_or_endpoint: row.tool_or_endpoint,
      classification: JSON.parse(row.classification_json || "{}"),
      arguments_sanitized: JSON.parse(row.arguments_sanitized_json || "{}"),
      result: JSON.parse(row.result_json || "{}"),
      duration_ms: row.duration_ms,
      dry_run: Boolean(row.dry_run),
      requires_confirmation: Boolean(row.requires_confirmation),
      confirmed: Boolean(row.confirmed),
      warnings: JSON.parse(row.warnings_json || "[]"),
      error_code: row.error_code,
      correlation_id: row.correlation_id
    };
  }
}
