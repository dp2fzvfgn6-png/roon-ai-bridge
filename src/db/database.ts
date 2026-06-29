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

CREATE INDEX IF NOT EXISTS idx_virtual_playlist_tracks_playlist
  ON virtual_playlist_tracks (playlist_id, position);

CREATE INDEX IF NOT EXISTS idx_play_history_zone_started
  ON play_history (zone_id, started_at);

CREATE INDEX IF NOT EXISTS idx_search_cache_query
  ON search_cache (query);
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
