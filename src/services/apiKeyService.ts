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
  tool_permissions: string[] | null;
};

type ApiKeyRow = Omit<ApiKeyRecord, "tool_permissions"> & {
  key_hash: string;
  tool_permissions_json: string | null;
};

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

function parseToolPermissions(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new ApiError("INVALID_API_KEY", "Tool permissions must be an array or null");
  }
  return Array.from(new Set(value.map((item) => {
    if (typeof item !== "string" || !/^roon_[a-z0-9_]+$/.test(item)) {
      throw new ApiError("INVALID_API_KEY", "Invalid tool permission", { tool: item });
    }
    return item;
  }))).sort();
}

function publicRecord(row: ApiKeyRow): ApiKeyRecord {
  let permissions: string[] | null = null;
  if (row.tool_permissions_json) {
    try {
      const parsed = JSON.parse(row.tool_permissions_json);
      permissions = Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : null;
    } catch {
      permissions = null;
    }
  }
  const { key_hash: _keyHash, tool_permissions_json: _permissionsJson, ...record } = row;
  return { ...record, tool_permissions: permissions };
}

export class ApiKeyService {
  private readonly database: SqliteDatabase;

  constructor(config: AppConfig, database?: SqliteDatabase) {
    this.database = database || createDatabase(config);
  }

  list(): ApiKeyRecord[] {
    return this.database.db
      .prepare(
        `SELECT key_id, name, key_hash, key_prefix, role, created_at, last_used_at, revoked_at, tool_permissions_json
         FROM api_keys
         ORDER BY revoked_at IS NOT NULL ASC, created_at DESC`
      )
      .all()
      .map((row: ApiKeyRow) => publicRecord(row));
  }

  create(input: { name?: unknown; role?: unknown; tool_permissions?: unknown }): ApiKeyRecord & { token: string } {
    const name = requiredName(input?.name);
    const role = parseRole(input?.role ?? "control");
    const keyId = crypto.randomUUID();
    const token = `rnb_${crypto.randomBytes(32).toString("base64url")}`;
    const createdAt = new Date().toISOString();
    const keyPrefix = `${token.slice(0, 12)}…`;

    this.database.db
      .prepare(
        `INSERT INTO api_keys (
          key_id, name, key_hash, key_prefix, role, created_at, last_used_at, revoked_at, tool_permissions_json
        ) VALUES (
          :key_id, :name, :key_hash, :key_prefix, :role, :created_at, NULL, NULL, :tool_permissions_json
        )`
      )
      .run({
        key_id: keyId,
        name,
        key_hash: hashToken(token),
        key_prefix: keyPrefix,
        role,
        tool_permissions_json: JSON.stringify(parseToolPermissions(input?.tool_permissions) || null),
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
      tool_permissions: parseToolPermissions(input?.tool_permissions),
      token
    };
  }

  authenticate(token: string, touch = true): ApiKeyRecord | null {
    if (!token.startsWith("rnb_")) return null;

    const row = this.database.db
      .prepare(
        `SELECT key_id, name, key_hash, key_prefix, role, created_at, last_used_at, revoked_at, tool_permissions_json
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

    return { ...publicRecord(row), last_used_at: lastUsedAt };
  }

  update(keyId: string, input: { name?: unknown; role?: unknown; tool_permissions?: unknown }): ApiKeyRecord {
    const current = this.list().find((item) => item.key_id === keyId);
    if (!current) throw new ApiError("API_KEY_NOT_FOUND", "API key not found", { key_id: keyId });
    const name = input.name === undefined ? current.name : requiredName(input.name);
    const role = input.role === undefined ? current.role : parseRole(input.role);
    const permissions = input.tool_permissions === undefined
      ? current.tool_permissions
      : parseToolPermissions(input.tool_permissions);
    this.database.db.prepare(
      `UPDATE api_keys
       SET name = :name, role = :role, tool_permissions_json = :tool_permissions_json
       WHERE key_id = :key_id`
    ).run({
      key_id: keyId,
      name,
      role,
      tool_permissions_json: JSON.stringify(permissions)
    });
    return this.list().find((item) => item.key_id === keyId)!;
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

  reactivate(keyId: string): ApiKeyRecord {
    const result = this.database.db
      .prepare("UPDATE api_keys SET revoked_at = NULL WHERE key_id = ? AND revoked_at IS NOT NULL")
      .run(keyId) as { changes?: number };
    if (!result?.changes) {
      throw new ApiError("API_KEY_NOT_FOUND", "Revoked API key not found", { key_id: keyId });
    }
    return this.list().find((item) => item.key_id === keyId)!;
  }
}

export function roleCanControl(role: ApiKeyRole): boolean {
  return role === "control" || role === "admin";
}
