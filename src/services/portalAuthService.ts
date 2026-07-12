import crypto from "crypto";
import { AppConfig } from "../config/env";
import { createDatabase, SqliteDatabase } from "../db/database";
import { ApiError } from "../utils/errors";

type PortalUserRow = {
  user_id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
  updated_at: string;
};

export type PortalUser = {
  user_id: string;
  username: string;
  created_at: string;
};

export type PortalSession = {
  token: string;
  expires_at: string;
  user: PortalUser;
};

const SESSION_DAYS = 14;

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeUsername(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError("INVALID_AUTH_REQUEST", "Username is required");
  }
  const username = value.trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
    throw new ApiError(
      "INVALID_AUTH_REQUEST",
      "Username must be 3-40 characters using letters, numbers, dot, dash or underscore"
    );
  }
  return username;
}

function validatePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 10 || value.length > 256) {
    throw new ApiError(
      "INVALID_AUTH_REQUEST",
      "Password must contain between 10 and 256 characters"
    );
  }
  return value;
}

function passwordHash(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function publicUser(row: PortalUserRow): PortalUser {
  return {
    user_id: row.user_id,
    username: row.username,
    created_at: row.created_at
  };
}

export class PortalAuthService {
  private readonly database: SqliteDatabase;

  constructor(config: AppConfig, database?: SqliteDatabase) {
    this.database = database || createDatabase(config);
  }

  setupRequired(): boolean {
    const row = this.database.db
      .prepare("SELECT COUNT(*) AS count FROM portal_users")
      .get() as { count?: number };
    return (row.count || 0) === 0;
  }

  setup(input: { username?: unknown; password?: unknown }): PortalSession {
    if (!this.setupRequired()) {
      throw new ApiError(
        "AUTH_FORBIDDEN",
        "The portal administrator has already been configured"
      );
    }
    return this.createUserAndSession(input);
  }

  listUsers(): PortalUser[] {
    return this.database.db
      .prepare(
        `SELECT user_id, username, password_hash, password_salt, created_at, updated_at
         FROM portal_users ORDER BY username COLLATE NOCASE`
      )
      .all()
      .map((row: PortalUserRow) => publicUser(row));
  }

  createUser(input: { username?: unknown; password?: unknown }): PortalUser {
    const row = this.buildUser(input);
    try {
      this.insertUser(row);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint failed")) {
        throw new ApiError("AUTH_USER_EXISTS", "A user with that name already exists");
      }
      throw error;
    }
    return publicUser(row);
  }

  resetPassword(userId: string, input: { password?: unknown }): void {
    const password = validatePassword(input.password);
    const salt = crypto.randomBytes(24).toString("base64url");
    const result = this.database.db
      .prepare(
        `UPDATE portal_users SET password_hash = ?, password_salt = ?, updated_at = ?
         WHERE user_id = ?`
      )
      .run(passwordHash(password, salt), salt, new Date().toISOString(), userId) as { changes?: number };
    if (!result?.changes) throw new ApiError("AUTH_USER_NOT_FOUND", "Portal user not found");
    this.database.db.prepare("DELETE FROM portal_sessions WHERE user_id = ?").run(userId);
  }

  deleteUser(userId: string): PortalUser {
    const users = this.listUsers();
    const user = users.find((item) => item.user_id === userId);
    if (!user) throw new ApiError("AUTH_USER_NOT_FOUND", "Portal user not found");
    if (users.length === 1) {
      throw new ApiError("AUTH_FORBIDDEN", "The last portal user cannot be deleted");
    }
    this.database.db.prepare("DELETE FROM portal_users WHERE user_id = ?").run(userId);
    return user;
  }

  login(input: { username?: unknown; password?: unknown }): PortalSession {
    const username = normalizeUsername(input?.username);
    const password = validatePassword(input?.password);
    const row = this.database.db
      .prepare(
        `SELECT user_id, username, password_hash, password_salt, created_at, updated_at
         FROM portal_users WHERE username = ? COLLATE NOCASE`
      )
      .get(username) as PortalUserRow | undefined;

    if (!row) {
      throw new ApiError("AUTH_INVALID", "Invalid username or password");
    }

    const actual = Buffer.from(passwordHash(password, row.password_salt), "hex");
    const expected = Buffer.from(row.password_hash, "hex");
    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    ) {
      throw new ApiError("AUTH_INVALID", "Invalid username or password");
    }

    return this.createSession(row);
  }

  authenticate(token: string): PortalUser | null {
    if (!token.startsWith("rns_")) return null;
    const now = new Date().toISOString();
    const row = this.database.db
      .prepare(
        `SELECT u.user_id, u.username, u.password_hash, u.password_salt,
                u.created_at, u.updated_at, s.session_id
         FROM portal_sessions s
         JOIN portal_users u ON u.user_id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`
      )
      .get(sha256(token), now) as (PortalUserRow & { session_id: string }) | undefined;
    if (!row) return null;

    this.database.db
      .prepare("UPDATE portal_sessions SET last_used_at = ? WHERE session_id = ?")
      .run(now, row.session_id);
    return publicUser(row);
  }

  logout(token: string): void {
    this.database.db
      .prepare("DELETE FROM portal_sessions WHERE token_hash = ?")
      .run(sha256(token));
  }

  changePassword(
    userId: string,
    input: { current_password?: unknown; new_password?: unknown }
  ): void {
    const current = validatePassword(input.current_password);
    const next = validatePassword(input.new_password);
    const row = this.database.db
      .prepare(
        `SELECT user_id, username, password_hash, password_salt, created_at, updated_at
         FROM portal_users WHERE user_id = ?`
      )
      .get(userId) as PortalUserRow | undefined;
    if (!row) throw new ApiError("AUTH_INVALID", "Portal user not found");

    const currentHash = Buffer.from(passwordHash(current, row.password_salt), "hex");
    const expected = Buffer.from(row.password_hash, "hex");
    if (
      currentHash.length !== expected.length ||
      !crypto.timingSafeEqual(currentHash, expected)
    ) {
      throw new ApiError("AUTH_INVALID", "Current password is incorrect");
    }

    const salt = crypto.randomBytes(24).toString("base64url");
    this.database.transaction(() => {
      this.database.db
        .prepare(
          `UPDATE portal_users
           SET password_hash = ?, password_salt = ?, updated_at = ?
           WHERE user_id = ?`
        )
        .run(passwordHash(next, salt), salt, new Date().toISOString(), userId);
      this.database.db
        .prepare("DELETE FROM portal_sessions WHERE user_id = ?")
        .run(userId);
    });
  }

  private createUserAndSession(input: {
    username?: unknown;
    password?: unknown;
  }): PortalSession {
    const row = this.buildUser(input);
    this.insertUser(row);
    return this.createSession(row);
  }

  private buildUser(input: {
    username?: unknown;
    password?: unknown;
  }): PortalUserRow {
    const username = normalizeUsername(input?.username);
    const password = validatePassword(input?.password);
    const salt = crypto.randomBytes(24).toString("base64url");
    const now = new Date().toISOString();
    const row: PortalUserRow = {
      user_id: crypto.randomUUID(),
      username,
      password_hash: passwordHash(password, salt),
      password_salt: salt,
      created_at: now,
      updated_at: now
    };

    return row;
  }

  private insertUser(row: PortalUserRow): void {
    this.database.db
      .prepare(
        `INSERT INTO portal_users (
          user_id, username, password_hash, password_salt, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.user_id,
        row.username,
        row.password_hash,
        row.password_salt,
        row.created_at,
        row.updated_at
      );
  }

  private createSession(row: PortalUserRow): PortalSession {
    const token = `rns_${crypto.randomBytes(32).toString("base64url")}`;
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    this.database.db
      .prepare(
        `INSERT INTO portal_sessions (
          session_id, user_id, token_hash, created_at, expires_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        row.user_id,
        sha256(token),
        createdAt.toISOString(),
        expiresAt,
        createdAt.toISOString()
      );
    return {
      token,
      expires_at: expiresAt,
      user: publicUser(row)
    };
  }
}
