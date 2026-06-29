import crypto from "crypto";
import { AppConfig } from "../config/env";
import { createDatabase, SqliteDatabase } from "../db/database";
import { ApiError } from "../utils/errors";

export type ApiKeyRole = "read" | "control" | "admin";

export type ApiKeyRecord = {
  key_id: string;
  name: string;
  key_prefix: string;
  role: ApiKeyRole;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type ApiKeyRow = ApiKeyRecord & { key_hash: string };

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function parseRole(value: unknown): ApiKeyRole {
  if (value === "read" || value === "control" || value === "admin") return value;
  throw new ApiError("INVALID_API_KEY", "API key role must be read, control or admin");
}

function requiredName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError("INVALID_API_KEY", "API key name is required");
  }
  return value.trim().slice(0, 80);
}

export class ApiKeyService {
  private readonly database: SqliteDatabase;

  constructor(config: AppConfig, database?: SqliteDatabase) {
    this.database = database || createDatabase(config);
  }

  list(): ApiKeyRecord[] {
    return this.database.db
      .prepare(
        `SELECT key_id, name, key_prefix, role, created_at, last_used_at, revoked_at
         FROM api_keys
         ORDER BY revoked_at IS NOT NULL ASC, created_at DESC`
      )
      .all() as ApiKeyRecord[];
  }

  create(input: { name?: unknown; role?: unknown }): ApiKeyRecord & { token: string } {
    const name = requiredName(input?.name);
    const role = parseRole(input?.role ?? "control");
    const keyId = crypto.randomUUID();
    const token = `rnb_${crypto.randomBytes(32).toString("base64url")}`;
    const createdAt = new Date().toISOString();
    const keyPrefix = `${token.slice(0, 12)}…`;

    this.database.db
      .prepare(
        `INSERT INTO api_keys (
          key_id, name, key_hash, key_prefix, role, created_at, last_used_at, revoked_at
        ) VALUES (
          :key_id, :name, :key_hash, :key_prefix, :role, :created_at, NULL, NULL
        )`
      )
      .run({
        key_id: keyId,
        name,
        key_hash: hashToken(token),
        key_prefix: keyPrefix,
        role,
        created_at: createdAt
      });

    return {
      key_id: keyId,
      name,
      key_prefix: keyPrefix,
      role,
      created_at: createdAt,
      last_used_at: null,
      revoked_at: null,
      token
    };
  }

  authenticate(token: string, touch = true): ApiKeyRecord | null {
    if (!token.startsWith("rnb_")) return null;

    const row = this.database.db
      .prepare(
        `SELECT key_id, name, key_hash, key_prefix, role, created_at, last_used_at, revoked_at
         FROM api_keys
         WHERE key_hash = ? AND revoked_at IS NULL`
      )
      .get(hashToken(token)) as ApiKeyRow | undefined;

    if (!row) return null;

    const lastUsedAt = touch ? new Date().toISOString() : row.last_used_at;
    if (touch) {
      this.database.db
        .prepare("UPDATE api_keys SET last_used_at = ? WHERE key_id = ?")
        .run(lastUsedAt, row.key_id);
    }

    const { key_hash: _keyHash, ...record } = row;
    return { ...record, last_used_at: lastUsedAt };
  }

  revoke(keyId: string): ApiKeyRecord {
    const revokedAt = new Date().toISOString();
    const result = this.database.db
      .prepare(
        "UPDATE api_keys SET revoked_at = ? WHERE key_id = ? AND revoked_at IS NULL"
      )
      .run(revokedAt, keyId) as { changes?: number };

    if (!result?.changes) {
      throw new ApiError("API_KEY_NOT_FOUND", "Active API key not found", {
        key_id: keyId
      });
    }

    return this.list().find((item) => item.key_id === keyId)!;
  }
}

export function roleCanControl(role: ApiKeyRole): boolean {
  return role === "control" || role === "admin";
}
