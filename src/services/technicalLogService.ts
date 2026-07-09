import crypto from "crypto";
import { SqliteDatabase } from "../db/database";
import { Logger } from "../utils/logger";
import { sanitizeText, sanitizeValue } from "./sanitization";

export type TechnicalLogQuery = {
  level?: "debug" | "info" | "warn" | "error";
  component?: string;
  limit?: number;
  since?: string;
};

const LEVEL_VALUE: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class TechnicalLogService {
  constructor(private readonly database: SqliteDatabase) {}

  record(component: string, level: keyof typeof LEVEL_VALUE, message: string, details?: unknown): void {
    this.database.db.prepare(`
      INSERT INTO system_events (event_id, timestamp, component, level, message, details_json)
      VALUES (:event_id, :timestamp, :component, :level, :message, :details_json)
    `).run({
      event_id: `evt_${crypto.randomBytes(9).toString("hex")}`,
      timestamp: new Date().toISOString(),
      component,
      level,
      message: sanitizeText(message),
      details_json: JSON.stringify(sanitizeValue(details || {}))
    });
    this.database.db.prepare(`
      DELETE FROM system_events
      WHERE event_id NOT IN (
        SELECT event_id FROM system_events ORDER BY timestamp DESC LIMIT 5000
      )
    `).run();
  }

  list(query: TechnicalLogQuery = {}): Record<string, unknown> {
    const limit = Math.min(Math.max(Number(query.limit || 100), 1), 500);
    const clauses: string[] = [];
    const params: Record<string, unknown> = { limit };
    if (query.component) {
      clauses.push("component = :component");
      params.component = query.component;
    }
    if (query.since) {
      clauses.push("timestamp >= :since");
      params.since = query.since;
    }
    if (query.level) {
      const threshold = LEVEL_VALUE[query.level] || LEVEL_VALUE.info;
      clauses.push(`CASE level
        WHEN 'debug' THEN 10 WHEN 'info' THEN 20 WHEN 'warn' THEN 30 WHEN 'error' THEN 40 ELSE 20
      END >= :level_value`);
      params.level_value = threshold;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database.db.prepare(`
      SELECT *, CASE level
        WHEN 'debug' THEN 10 WHEN 'info' THEN 20 WHEN 'warn' THEN 30 WHEN 'error' THEN 40 ELSE 20
      END AS level_value
      FROM system_events
      ${where}
      ORDER BY timestamp DESC
      LIMIT :limit
    `).all(params);
    return {
      ok: true,
      logs: rows.map((row: any) => ({
        event_id: row.event_id,
        timestamp: row.timestamp,
        component: row.component,
        level: row.level,
        message: row.message,
        details: JSON.parse(row.details_json || "{}")
      })),
      limit
    };
  }

  errors(limit = 50): Record<string, unknown> {
    const logs = this.list({ level: "error", limit }) as any;
    return {
      ok: true,
      errors: logs.logs,
      count: logs.logs.length
    };
  }
}

export function createObservedLogger(logger: Logger, technicalLogs: TechnicalLogService): Logger {
  const wrap = (level: keyof typeof LEVEL_VALUE) => (message: string, meta?: Record<string, unknown>) => {
    logger[level](message, meta);
    const component = typeof meta?.component === "string"
      ? meta.component
      : typeof meta?.service === "string"
        ? meta.service
        : "app";
    technicalLogs.record(component, level, message, meta);
  };
  return {
    debug: wrap("debug"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error")
  };
}
