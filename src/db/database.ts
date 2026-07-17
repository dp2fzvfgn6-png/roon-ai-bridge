import fs from "fs";
import path from "path";
import { AppConfig } from "../config/env";

const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => any;
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roon_cores (
  core_id TEXT PRIMARY KEY,
  display_name TEXT,
  last_seen_at TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS zones_cache (
  zone_id TEXT PRIMARY KEY,
  display_name TEXT,
  state TEXT,
  outputs_json TEXT,
  now_playing_json TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS virtual_playlists (
  playlist_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  cover_image_key TEXT,
  last_played_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS virtual_playlist_tracks (
  track_id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL,
  query TEXT NOT NULL,
  roon_item_key TEXT,
  title TEXT,
  artist TEXT,
  album TEXT,
  position INTEGER NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playlist_id) REFERENCES virtual_playlists (playlist_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS temporary_playlist_lifecycle (
  playlist_id TEXT PRIMARY KEY,
  intent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playlist_id) REFERENCES virtual_playlists (playlist_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id TEXT,
  title TEXT,
  artist TEXT,
  album TEXT,
  started_at TEXT,
  ended_at TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS home_history (
  history_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('search', 'play')),
  media_type TEXT,
  result_id TEXT,
  playlist_id TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  image_key TEXT,
  query TEXT,
  zone_id TEXT,
  zone_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS command_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_type TEXT NOT NULL,
  zone_id TEXT,
  payload_json TEXT,
  result_code TEXT,
  result_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS search_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  results_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  key_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('read', 'control', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  revoked_at TEXT,
  tool_permissions_json TEXT
);

CREATE TABLE IF NOT EXISTS tool_settings (
  tool_name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portal_users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portal_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES portal_users (user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS zone_presets (
  preset_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  primary_output_id TEXT,
  output_ids_json TEXT,
  volume_values_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS volume_limits (
  limit_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_value TEXT NOT NULL,
  name TEXT NOT NULL,
  safe_max REAL NOT NULL,
  schedule_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS output_volume_settings (
  output_id TEXT PRIMARY KEY,
  display_name TEXT,
  minimum_value REAL,
  maximum_value REAL,
  preferred_value REAL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS action_logs (
  action_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL,
  tool_or_endpoint TEXT NOT NULL,
  classification_json TEXT NOT NULL,
  arguments_sanitized_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  requires_confirmation INTEGER NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL,
  error_code TEXT,
  correlation_id TEXT
);

CREATE TABLE IF NOT EXISTS system_events (
  event_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  component TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS extension_registry (
  extension_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  manager_type TEXT NOT NULL,
  service_name TEXT,
  status TEXT NOT NULL,
  version TEXT,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_virtual_playlist_tracks_playlist
  ON virtual_playlist_tracks (playlist_id, position);

CREATE INDEX IF NOT EXISTS idx_temporary_playlist_expiry
  ON temporary_playlist_lifecycle (expires_at);

CREATE INDEX IF NOT EXISTS idx_play_history_zone_started
  ON play_history (zone_id, started_at);

CREATE INDEX IF NOT EXISTS idx_home_history_created
  ON home_history (created_at);

CREATE INDEX IF NOT EXISTS idx_home_history_type_created
  ON home_history (event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_search_cache_query
  ON search_cache (query);

CREATE INDEX IF NOT EXISTS idx_api_keys_active
  ON api_keys (revoked_at, created_at);

CREATE INDEX IF NOT EXISTS idx_portal_sessions_user
  ON portal_sessions (user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_action_logs_timestamp
  ON action_logs (timestamp);

CREATE INDEX IF NOT EXISTS idx_action_logs_tool
  ON action_logs (tool_or_endpoint, timestamp);

CREATE INDEX IF NOT EXISTS idx_system_events_component
  ON system_events (component, level, timestamp);
`;

export const databaseImplemented = true;

type LegacyPlaylistTrack = {
  track_id?: unknown;
  query?: unknown;
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  position?: unknown;
  created_at?: unknown;
};

type LegacyPlaylist = {
  playlist_id?: unknown;
  name?: unknown;
  description?: unknown;
  tracks?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

type LegacyPlaylistStore = {
  playlists?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asIsoString(value: unknown, fallback: string): string {
  const text = asString(value);
  return text || fallback;
}

function asInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
}

export class SqliteDatabase {
  readonly db: any;

  private readonly dataDir: string;
  private readonly dbPath: string;
  private readonly legacyPlaylistPath: string;

  constructor(config: AppConfig) {
    this.dataDir = config.dataDir;
    this.dbPath = path.join(this.dataDir, "roonia.sqlite");
    this.legacyPlaylistPath = path.join(this.dataDir, "virtual-playlists.json");

    fs.mkdirSync(this.dataDir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA_SQL);
    this.migrateSchema();
    this.migrateLegacyPlaylistsIfNeeded();
  }

  close(): void {
    if (this.db && typeof this.db.close === "function") {
      this.db.close();
    }
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private migrateSchema(): void {
    const playlistColumns = this.db.prepare("PRAGMA table_info(virtual_playlists)").all() as Array<{ name: string }>;
    if (!playlistColumns.some((column) => column.name === "cover_image_key")) {
      this.db.exec("ALTER TABLE virtual_playlists ADD COLUMN cover_image_key TEXT");
    }
    if (!playlistColumns.some((column) => column.name === "last_played_at")) {
      this.db.exec("ALTER TABLE virtual_playlists ADD COLUMN last_played_at TEXT");
    }

    const apiKeyColumns = this.db.prepare("PRAGMA table_info(api_keys)").all() as Array<{ name: string }>;
    if (!apiKeyColumns.some((column) => column.name === "tool_permissions_json")) {
      this.db.exec("ALTER TABLE api_keys ADD COLUMN tool_permissions_json TEXT");
    }

    const zoneColumns = this.db.prepare("PRAGMA table_info(zone_presets)").all() as Array<{ name: string }>;
    const zoneColumnNames = new Set(zoneColumns.map((column) => column.name));
    const addZoneColumn = (name: string, sql: string) => {
      if (!zoneColumnNames.has(name)) this.db.exec(`ALTER TABLE zone_presets ADD COLUMN ${sql}`);
    };
    addZoneColumn("description", "description TEXT");
    addZoneColumn("enabled", "enabled INTEGER NOT NULL DEFAULT 1");
    addZoneColumn("config_json", "config_json TEXT");
    addZoneColumn("primary_output_id", "primary_output_id TEXT");
    addZoneColumn("output_ids_json", "output_ids_json TEXT");
    addZoneColumn("volume_values_json", "volume_values_json TEXT");
    const primaryOutputColumn = zoneColumns.find((column: any) => column.name === "primary_output_id") as any;
    if (primaryOutputColumn?.notnull) {
      this.db.exec(`
        CREATE TABLE zone_presets_migration (
          preset_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          config_json TEXT,
          primary_output_id TEXT,
          output_ids_json TEXT,
          volume_values_json TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO zone_presets_migration (
          preset_id, name, description, enabled, config_json, primary_output_id,
          output_ids_json, volume_values_json, created_at, updated_at
        )
        SELECT
          preset_id, name, description, enabled, config_json, primary_output_id,
          output_ids_json, volume_values_json, created_at, updated_at
        FROM zone_presets;
        DROP TABLE zone_presets;
        ALTER TABLE zone_presets_migration RENAME TO zone_presets;
      `);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS volume_limits (
        limit_id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_value TEXT NOT NULL,
        name TEXT NOT NULL,
        safe_max REAL NOT NULL,
        schedule_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS action_logs (
        action_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        tool_or_endpoint TEXT NOT NULL,
        classification_json TEXT NOT NULL,
        arguments_sanitized_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        dry_run INTEGER NOT NULL DEFAULT 0,
        requires_confirmation INTEGER NOT NULL DEFAULT 0,
        confirmed INTEGER NOT NULL DEFAULT 0,
        warnings_json TEXT NOT NULL,
        error_code TEXT,
        correlation_id TEXT
      );

      CREATE TABLE IF NOT EXISTS system_events (
        event_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        component TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS extension_registry (
        extension_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        manager_type TEXT NOT NULL,
        service_name TEXT,
        status TEXT NOT NULL,
        version TEXT,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_settings (
        tool_name TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_action_logs_timestamp
        ON action_logs (timestamp);
      CREATE INDEX IF NOT EXISTS idx_action_logs_tool
        ON action_logs (tool_or_endpoint, timestamp);
      CREATE INDEX IF NOT EXISTS idx_system_events_component
        ON system_events (component, level, timestamp);
    `);
  }

  private migrateLegacyPlaylistsIfNeeded(): void {
    if (!fs.existsSync(this.legacyPlaylistPath)) return;

    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM virtual_playlists")
      .get() as { count?: number } | undefined;
    if ((row?.count || 0) > 0) return;

    let parsed: LegacyPlaylistStore | null = null;
    try {
      parsed = JSON.parse(fs.readFileSync(this.legacyPlaylistPath, "utf8")) as LegacyPlaylistStore;
    } catch {
      return;
    }

    const playlists = Array.isArray(parsed?.playlists) ? (parsed?.playlists as LegacyPlaylist[]) : [];
    if (playlists.length === 0) return;

    const insertPlaylist = this.db.prepare(`
      INSERT INTO virtual_playlists (playlist_id, name, description, created_at, updated_at)
      VALUES (:playlist_id, :name, :description, :created_at, :updated_at)
    `);
    const insertTrack = this.db.prepare(`
      INSERT INTO virtual_playlist_tracks (
        track_id, playlist_id, query, roon_item_key, title, artist, album, position, metadata_json, created_at
      ) VALUES (
        :track_id, :playlist_id, :query, :roon_item_key, :title, :artist, :album, :position, :metadata_json, :created_at
      )
    `);

    this.transaction(() => {
      for (const rawPlaylist of playlists) {
        const playlistId = asString(rawPlaylist.playlist_id);
        const name = asString(rawPlaylist.name);
        if (!playlistId || !name) continue;

        const createdAt = asIsoString(rawPlaylist.created_at, new Date().toISOString());
        const updatedAt = asIsoString(rawPlaylist.updated_at, createdAt);

        insertPlaylist.run({
          playlist_id: playlistId,
          name,
          description: asString(rawPlaylist.description),
          created_at: createdAt,
          updated_at: updatedAt
        });

        const tracks = Array.isArray(rawPlaylist.tracks) ? (rawPlaylist.tracks as LegacyPlaylistTrack[]) : [];
        for (const [index, rawTrack] of tracks.entries()) {
          const query = asString(rawTrack.query);
          if (!query) continue;

          insertTrack.run({
            track_id: asString(rawTrack.track_id) || `${playlistId}-track-${index + 1}`,
            playlist_id: playlistId,
            query,
            roon_item_key: null,
            title: asString(rawTrack.title),
            artist: asString(rawTrack.artist),
            album: asString(rawTrack.album),
            position: Math.max(1, asInteger(rawTrack.position, index + 1)),
            metadata_json: null,
            created_at: asIsoString(rawTrack.created_at, createdAt)
          });
        }
      }
    });
  }
}

export function createDatabase(config: AppConfig): SqliteDatabase {
  return new SqliteDatabase(config);
}
