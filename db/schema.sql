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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id TEXT NOT NULL,
  roon_item_key TEXT,
  title TEXT,
  artist TEXT,
  album TEXT,
  position INTEGER NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playlist_id) REFERENCES virtual_playlists (playlist_id)
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
