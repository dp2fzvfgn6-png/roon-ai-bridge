import { SqliteDatabase } from "../db/database";

export type MetadataProviderCacheEntry<T> = {
  provider: string;
  cache_key: string;
  entity_type: string;
  status: string;
  payload: T;
  fetched_at: string;
  expires_at: string;
};

export type MetadataProviderCacheSummary = {
  provider: string;
  total_entries: number;
  active_entries: number;
  expired_entries: number;
  statuses: Record<string, number>;
};

function nowIso(now: Date | number = new Date()): string {
  return new Date(now).toISOString();
}

export class MetadataProviderCacheService {
  constructor(private readonly database: SqliteDatabase) {}

  get<T>(provider: string, cacheKey: string, now = new Date()): MetadataProviderCacheEntry<T> | null {
    const row = this.database.db
      .prepare(
        `SELECT provider, cache_key, entity_type, status, payload_json, fetched_at, expires_at
         FROM metadata_provider_cache
         WHERE provider = ? AND cache_key = ?`
      )
      .get(provider, cacheKey) as {
        provider: string;
        cache_key: string;
        entity_type: string;
        status: string;
        payload_json: string;
        fetched_at: string;
        expires_at: string;
      } | undefined;
    if (!row || Date.parse(row.expires_at) <= now.getTime()) return null;
    try {
      return {
        provider: row.provider,
        cache_key: row.cache_key,
        entity_type: row.entity_type,
        status: row.status,
        payload: JSON.parse(row.payload_json) as T,
        fetched_at: row.fetched_at,
        expires_at: row.expires_at
      };
    } catch {
      this.delete(provider, cacheKey);
      return null;
    }
  }

  set<T>(input: {
    provider: string;
    cacheKey: string;
    entityType: string;
    status: string;
    payload: T;
    ttlMs: number;
    now?: Date;
  }): MetadataProviderCacheEntry<T> {
    const now = input.now || new Date();
    const entry: MetadataProviderCacheEntry<T> = {
      provider: input.provider,
      cache_key: input.cacheKey,
      entity_type: input.entityType,
      status: input.status,
      payload: input.payload,
      fetched_at: nowIso(now),
      expires_at: nowIso(now.getTime() + Math.max(1, input.ttlMs))
    };
    this.database.db
      .prepare(
        `INSERT INTO metadata_provider_cache (
           provider, cache_key, entity_type, status, payload_json, fetched_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, cache_key) DO UPDATE SET
           entity_type = excluded.entity_type,
           status = excluded.status,
           payload_json = excluded.payload_json,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at`
      )
      .run(
        entry.provider,
        entry.cache_key,
        entry.entity_type,
        entry.status,
        JSON.stringify(entry.payload),
        entry.fetched_at,
        entry.expires_at
      );
    return entry;
  }

  delete(provider: string, cacheKey: string): void {
    this.database.db
      .prepare("DELETE FROM metadata_provider_cache WHERE provider = ? AND cache_key = ?")
      .run(provider, cacheKey);
  }

  purgeExpired(now = new Date()): number {
    const result = this.database.db
      .prepare("DELETE FROM metadata_provider_cache WHERE expires_at <= ?")
      .run(nowIso(now));
    return Number(result.changes) || 0;
  }

  summary(provider: string, now = new Date()): MetadataProviderCacheSummary {
    const rows = this.database.db
      .prepare(
        `SELECT status,
                COUNT(*) AS total,
                SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END) AS active
         FROM metadata_provider_cache
         WHERE provider = ?
         GROUP BY status`
      )
      .all(nowIso(now), provider) as Array<{ status: string; total: number; active: number }>;
    const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const active = rows.reduce((sum, row) => sum + Number(row.active || 0), 0);
    return {
      provider,
      total_entries: total,
      active_entries: active,
      expired_entries: total - active,
      statuses: Object.fromEntries(rows.map((row) => [row.status, Number(row.total || 0)]))
    };
  }
}
