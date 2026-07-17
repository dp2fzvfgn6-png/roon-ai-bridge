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
  primary_output_id TEXT,
  output_ids_json TEXT NOT NULL,
  volume_values_json TEXT,
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
