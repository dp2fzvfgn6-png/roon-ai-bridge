import { AppConfig } from "../config/env";
import { createDatabase, SqliteDatabase } from "../db/database";
import { playByQuery, queueByQuery } from "../roon/roonBrowseService";
import { RoonClient } from "../roon/roonClient";
import { ApiError } from "../utils/errors";

export const playlistServiceImplemented = true;

export type VirtualPlaylistTrackMetadata = Record<string, unknown>;

export type VirtualPlaylistTrack = {
  track_id: string;
  query: string;
  roon_item_key: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  image_key: string | null;
  cover: { image_key: string } | null;
  position: number;
  metadata: VirtualPlaylistTrackMetadata | null;
  created_at: string;
};

export type VirtualPlaylist = {
  playlist_id: string;
  name: string;
  description: string | null;
  tracks: VirtualPlaylistTrack[];
  tracks_count: number;
  created_at: string;
  updated_at: string;
};

export type PlaylistPlayMode = "add_to_queue" | "add_next" | "play_now";

type PlaylistRow = {
  playlist_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type TrackRow = {
  track_id: string;
  playlist_id: string;
  query: string;
  roon_item_key: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  position: number;
  metadata_json: string | null;
  created_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function optionalFiniteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseMetadata(value: string | null): VirtualPlaylistTrackMetadata | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return objectValue(parsed);
  } catch {
    return null;
  }
}

function serializeMetadata(value: unknown): string | null {
  const metadata = objectValue(value);
  return metadata ? JSON.stringify(metadata) : null;
}

function imageKeyFromMetadata(metadata: VirtualPlaylistTrackMetadata | null): string | null {
  if (!metadata) return null;

  const direct = optionalString(metadata.image_key);
  if (direct) return direct;

  const cover = objectValue(metadata.cover);
  return optionalString(cover?.image_key);
}

function buildCover(imageKey: string | null): { image_key: string } | null {
  return imageKey ? { image_key: imageKey } : null;
}

type NormalizedTrackInput = {
  track_id: string;
  query: string;
  roon_item_key: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  position: number | null;
  metadata_json: string | null;
  created_at: string;
};

function normalizeTrackInput(
  input: unknown,
  fallbackTrackId?: string,
  fallbackPosition?: number,
  fallbackCreatedAt?: string
): NormalizedTrackInput {
  const payload = objectValue(input);
  if (!payload) {
    throw new ApiError("INVALID_PLAYLIST_TRACK", "Track must be an object");
  }

  const query = nonEmptyString(payload.query);
  if (!query) {
    throw new ApiError("INVALID_PLAYLIST_TRACK", "Track query is required");
  }

  const metadata =
    objectValue(payload.metadata) ||
    objectValue(payload.metadata_json) ||
    null;

  if (!metadata) {
    const derivedMetadata: Record<string, unknown> = {};
    for (const key of [
      "image_key",
      "cover",
      "duration_seconds",
      "track_number",
      "disc_number",
      "release_year",
      "album_artist",
      "composer",
      "genre",
      "source",
      "quality"
    ]) {
      if (payload[key] !== undefined) derivedMetadata[key] = payload[key];
    }
    return {
      track_id: nonEmptyString(payload.track_id) || fallbackTrackId || `track-${randomSuffix()}`,
      query,
      roon_item_key: optionalString(payload.roon_item_key),
      title: optionalString(payload.title),
      artist: optionalString(payload.artist),
      album: optionalString(payload.album),
      position: optionalFiniteInteger(payload.position) ?? fallbackPosition ?? null,
      metadata_json:
        Object.keys(derivedMetadata).length > 0 ? JSON.stringify(derivedMetadata) : null,
      created_at: optionalString(payload.created_at) || fallbackCreatedAt || nowIso()
    };
  }

  return {
    track_id: nonEmptyString(payload.track_id) || fallbackTrackId || `track-${randomSuffix()}`,
    query,
    roon_item_key: optionalString(payload.roon_item_key),
    title: optionalString(payload.title),
    artist: optionalString(payload.artist),
    album: optionalString(payload.album),
    position: optionalFiniteInteger(payload.position) ?? fallbackPosition ?? null,
    metadata_json: serializeMetadata(metadata),
    created_at: optionalString(payload.created_at) || fallbackCreatedAt || nowIso()
  };
}

export class PlaylistService {
  private readonly database: SqliteDatabase;

  constructor(config: AppConfig, database?: SqliteDatabase) {
    this.database = database || createDatabase(config);
  }

  listPlaylists(): VirtualPlaylist[] {
    const playlistRows = this.database.db
      .prepare(
        `SELECT playlist_id, name, description, created_at, updated_at
         FROM virtual_playlists
         ORDER BY updated_at DESC, name ASC`
      )
      .all() as PlaylistRow[];

    return playlistRows.map((row) => this.getPlaylistFromRow(row));
  }

  getPlaylist(playlistId: string): VirtualPlaylist {
    return this.getPlaylistById(playlistId);
  }

  createPlaylist(input: {
    playlist_id?: unknown;
    name?: unknown;
    description?: unknown;
    tracks?: unknown;
  }): VirtualPlaylist {
    const name = nonEmptyString(input.name);
    if (!name) {
      throw new ApiError("INVALID_PLAYLIST", "Playlist name is required");
    }

    const baseId =
      nonEmptyString(input.playlist_id) || slugify(name) || `playlist-${randomSuffix()}`;
    let playlistId = baseId;
    while (this.playlistExists(playlistId)) {
      playlistId = `${baseId}-${randomSuffix()}`;
    }

    const createdAt = nowIso();

    this.database.transaction(() => {
      this.database.db
        .prepare(
          `INSERT INTO virtual_playlists (playlist_id, name, description, created_at, updated_at)
           VALUES (:playlist_id, :name, :description, :created_at, :updated_at)`
        )
        .run({
          playlist_id: playlistId,
          name,
          description: optionalString(input.description),
          created_at: createdAt,
          updated_at: createdAt
        });

      if (Array.isArray(input.tracks)) {
        this.insertTracks(playlistId, input.tracks, createdAt);
      }
    });

    return this.getPlaylistById(playlistId);
  }

  updatePlaylist(
    playlistId: string,
    input: { name?: unknown; description?: unknown }
  ): VirtualPlaylist {
    const current = this.getPlaylistById(playlistId);
    const nextName =
      input.name === undefined ? current.name : nonEmptyString(input.name);

    if (!nextName) {
      throw new ApiError("INVALID_PLAYLIST", "Playlist name is required");
    }

    const nextDescription =
      input.description === undefined
        ? current.description
        : optionalString(input.description);

    this.database.db
      .prepare(
        `UPDATE virtual_playlists
         SET name = :name, description = :description, updated_at = :updated_at
         WHERE playlist_id = :playlist_id`
      )
      .run({
        playlist_id: playlistId,
        name: nextName,
        description: nextDescription,
        updated_at: nowIso()
      });

    return this.getPlaylistById(playlistId);
  }

  addTrack(playlistId: string, input: unknown): VirtualPlaylist {
    this.getPlaylistById(playlistId);
    const position = this.nextTrackPosition(playlistId);
    const normalized = normalizeTrackInput(input, undefined, position);
    this.insertTrack(playlistId, normalized);
    this.touchPlaylist(playlistId);
    return this.getPlaylistById(playlistId);
  }

  updateTrack(playlistId: string, trackId: string, input: unknown): VirtualPlaylist {
    const row = this.getTrackRowOrThrow(playlistId, trackId);
    const normalized = normalizeTrackInput(input, row.track_id, row.position, row.created_at);
    this.database.db
      .prepare(
        `UPDATE virtual_playlist_tracks
         SET query = :query,
             roon_item_key = :roon_item_key,
             title = :title,
             artist = :artist,
             album = :album,
             position = :position,
             metadata_json = :metadata_json
         WHERE playlist_id = :playlist_id AND track_id = :track_id`
      )
      .run({
        playlist_id: playlistId,
        track_id: trackId,
        query: normalized.query,
        roon_item_key: normalized.roon_item_key,
        title: normalized.title,
        artist: normalized.artist,
        album: normalized.album,
        position: normalized.position ?? row.position,
        metadata_json: normalized.metadata_json
      });

    this.normalizeTrackPositions(playlistId);
    this.touchPlaylist(playlistId);
    return this.getPlaylistById(playlistId);
  }

  replaceTracks(playlistId: string, tracks: unknown): VirtualPlaylist {
    this.getPlaylistById(playlistId);
    if (!Array.isArray(tracks)) {
      throw new ApiError("INVALID_PLAYLIST_TRACK", "tracks must be an array");
    }

    const createdAt = nowIso();
    this.database.transaction(() => {
      this.database.db
        .prepare("DELETE FROM virtual_playlist_tracks WHERE playlist_id = ?")
        .run(playlistId);
      this.insertTracks(playlistId, tracks, createdAt);
      this.touchPlaylist(playlistId, createdAt);
    });

    return this.getPlaylistById(playlistId);
  }

  reorderTracks(playlistId: string, trackIds: unknown): VirtualPlaylist {
    this.getPlaylistById(playlistId);
    if (!Array.isArray(trackIds) || trackIds.length === 0) {
      throw new ApiError("INVALID_PLAYLIST_TRACK", "track_ids must be a non-empty array");
    }

    const existing = this.listTrackRows(playlistId);
    const ids = trackIds
      .map((value) => nonEmptyString(value))
      .filter((value): value is string => Boolean(value));

    if (ids.length !== existing.length) {
      throw new ApiError("INVALID_PLAYLIST_TRACK", "track_ids must include every playlist track exactly once", {
        playlist_id: playlistId,
        expected: existing.length,
        received: ids.length
      });
    }

    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new ApiError("INVALID_PLAYLIST_TRACK", "track_ids must not contain duplicates");
    }

    const existingIds = new Set(existing.map((track) => track.track_id));
    for (const id of ids) {
      if (!existingIds.has(id)) {
        throw new ApiError("PLAYLIST_TRACK_NOT_FOUND", "Virtual playlist track not found", {
          playlist_id: playlistId,
          track_id: id
        });
      }
    }

    this.database.transaction(() => {
      const update = this.database.db.prepare(
        `UPDATE virtual_playlist_tracks
         SET position = :position
         WHERE playlist_id = :playlist_id AND track_id = :track_id`
      );

      ids.forEach((id, index) => {
        update.run({
          playlist_id: playlistId,
          track_id: id,
          position: index + 1
        });
      });
      this.touchPlaylist(playlistId);
    });

    return this.getPlaylistById(playlistId);
  }

  removeTrack(playlistId: string, trackId: string): VirtualPlaylist {
    this.getTrackRowOrThrow(playlistId, trackId);
    this.database.db
      .prepare(
        "DELETE FROM virtual_playlist_tracks WHERE playlist_id = ? AND track_id = ?"
      )
      .run(playlistId, trackId);
    this.normalizeTrackPositions(playlistId);
    this.touchPlaylist(playlistId);
    return this.getPlaylistById(playlistId);
  }

  deletePlaylist(playlistId: string): { ok: true; playlist_id: string } {
    const result = this.database.db
      .prepare("DELETE FROM virtual_playlists WHERE playlist_id = ?")
      .run(playlistId) as { changes?: number };

    if (!result?.changes) {
      throw new ApiError("PLAYLIST_NOT_FOUND", "Virtual playlist not found", {
        playlist_id: playlistId
      });
    }

    return { ok: true, playlist_id: playlistId };
  }

  async playPlaylist(
    roonClient: RoonClient,
    playlistId: string,
    input: { zone_id?: unknown; mode?: unknown; limit?: unknown; session_key?: unknown }
  ): Promise<Record<string, unknown>> {
    const playlist = this.getPlaylistById(playlistId);
    const zoneId = nonEmptyString(input.zone_id);
    if (!zoneId) {
      throw new ApiError("ZONE_NOT_FOUND", "zone_id is required");
    }

    const mode = this.parsePlayMode(input.mode);
    const limit =
      typeof input.limit === "number" && Number.isFinite(input.limit)
        ? Math.max(1, Math.min(Math.floor(input.limit), playlist.tracks.length))
        : playlist.tracks.length;
    const tracks = playlist.tracks.slice(0, limit);
    const results: Record<string, unknown>[] = [];
    const failures: Record<string, unknown>[] = [];
    const sessionPrefix =
      nonEmptyString(input.session_key) ||
      `roon-ai-bridge-playlist-${playlist.playlist_id}-${Date.now().toString(36)}`;

    if (mode === "play_now" && tracks.length > 0) {
      await this.applyTrack(
        roonClient,
        zoneId,
        tracks[0],
        "play_now",
        `${sessionPrefix}-0`,
        results,
        failures
      );

      for (const [index, track] of tracks.slice(1).entries()) {
        await this.applyTrack(
          roonClient,
          zoneId,
          track,
          "add_to_queue",
          `${sessionPrefix}-${index + 1}`,
          results,
          failures
        );
      }
    } else {
      const orderedTracks = mode === "add_next" ? tracks.slice().reverse() : tracks;
      for (const [index, track] of orderedTracks.entries()) {
        await this.applyTrack(
          roonClient,
          zoneId,
          track,
          mode,
          `${sessionPrefix}-${index}`,
          results,
          failures
        );
      }
    }

    return {
      ok: failures.length === 0,
      playlist_id: playlist.playlist_id,
      zone_id: zoneId,
      mode,
      requested: tracks.length,
      succeeded: results.length,
      failed: failures.length,
      results,
      failures
    };
  }

  private parsePlayMode(value: unknown): PlaylistPlayMode {
    if (value === undefined || value === null || value === "") return "add_to_queue";
    if (value === "add_to_queue" || value === "add_next" || value === "play_now") {
      return value;
    }

    throw new ApiError("INVALID_PLAYLIST_PLAY_MODE", "Unsupported playlist play mode", {
      allowed: ["add_to_queue", "add_next", "play_now"]
    });
  }

  private playlistExists(playlistId: string): boolean {
    const row = this.database.db
      .prepare("SELECT 1 FROM virtual_playlists WHERE playlist_id = ?")
      .get(playlistId) as Record<string, unknown> | undefined;
    return Boolean(row);
  }

  private getPlaylistById(playlistId: string): VirtualPlaylist {
    const row = this.database.db
      .prepare(
        `SELECT playlist_id, name, description, created_at, updated_at
         FROM virtual_playlists
         WHERE playlist_id = ?`
      )
      .get(playlistId) as PlaylistRow | undefined;

    if (!row) {
      throw new ApiError("PLAYLIST_NOT_FOUND", "Virtual playlist not found", {
        playlist_id: playlistId
      });
    }

    return this.getPlaylistFromRow(row);
  }

  private getPlaylistFromRow(row: PlaylistRow): VirtualPlaylist {
    const tracks = this.listTrackRows(row.playlist_id).map((track) => this.mapTrack(track));
    return {
      playlist_id: row.playlist_id,
      name: row.name,
      description: row.description,
      tracks,
      tracks_count: tracks.length,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private listTrackRows(playlistId: string): TrackRow[] {
    return this.database.db
      .prepare(
        `SELECT track_id, playlist_id, query, roon_item_key, title, artist, album, position, metadata_json, created_at
         FROM virtual_playlist_tracks
         WHERE playlist_id = ?
         ORDER BY position ASC, created_at ASC, track_id ASC`
      )
      .all(playlistId) as TrackRow[];
  }

  private getTrackRowOrThrow(playlistId: string, trackId: string): TrackRow {
    const row = this.database.db
      .prepare(
        `SELECT track_id, playlist_id, query, roon_item_key, title, artist, album, position, metadata_json, created_at
         FROM virtual_playlist_tracks
         WHERE playlist_id = ? AND track_id = ?`
      )
      .get(playlistId, trackId) as TrackRow | undefined;

    if (!row) {
      throw new ApiError("PLAYLIST_TRACK_NOT_FOUND", "Virtual playlist track not found", {
        playlist_id: playlistId,
        track_id: trackId
      });
    }

    return row;
  }

  private mapTrack(row: TrackRow): VirtualPlaylistTrack {
    const metadata = parseMetadata(row.metadata_json);
    const imageKey = imageKeyFromMetadata(metadata);

    return {
      track_id: row.track_id,
      query: row.query,
      roon_item_key: row.roon_item_key,
      title: row.title,
      artist: row.artist,
      album: row.album,
      image_key: imageKey,
      cover: buildCover(imageKey),
      position: row.position,
      metadata,
      created_at: row.created_at
    };
  }

  private nextTrackPosition(playlistId: string): number {
    const row = this.database.db
      .prepare(
        "SELECT COALESCE(MAX(position), 0) AS max_position FROM virtual_playlist_tracks WHERE playlist_id = ?"
      )
      .get(playlistId) as { max_position?: number } | undefined;

    return (row?.max_position || 0) + 1;
  }

  private insertTracks(playlistId: string, tracks: unknown[], createdAt: string): void {
    tracks.forEach((track, index) => {
      const normalized = normalizeTrackInput(track, undefined, index + 1, createdAt);
      this.insertTrack(playlistId, normalized);
    });
    this.normalizeTrackPositions(playlistId);
  }

  private insertTrack(playlistId: string, track: NormalizedTrackInput): void {
    this.database.db
      .prepare(
        `INSERT INTO virtual_playlist_tracks (
          track_id, playlist_id, query, roon_item_key, title, artist, album, position, metadata_json, created_at
         ) VALUES (
          :track_id, :playlist_id, :query, :roon_item_key, :title, :artist, :album, :position, :metadata_json, :created_at
         )`
      )
      .run({
        track_id: track.track_id,
        playlist_id: playlistId,
        query: track.query,
        roon_item_key: track.roon_item_key,
        title: track.title,
        artist: track.artist,
        album: track.album,
        position: track.position ?? this.nextTrackPosition(playlistId),
        metadata_json: track.metadata_json,
        created_at: track.created_at
      });
  }

  private normalizeTrackPositions(playlistId: string): void {
    const update = this.database.db.prepare(
      `UPDATE virtual_playlist_tracks
       SET position = :position
       WHERE playlist_id = :playlist_id AND track_id = :track_id`
    );

    this.listTrackRows(playlistId).forEach((track, index) => {
      update.run({
        playlist_id: playlistId,
        track_id: track.track_id,
        position: index + 1
      });
    });
  }

  private touchPlaylist(playlistId: string, updatedAt = nowIso()): void {
    this.database.db
      .prepare(
        "UPDATE virtual_playlists SET updated_at = :updated_at WHERE playlist_id = :playlist_id"
      )
      .run({
        playlist_id: playlistId,
        updated_at: updatedAt
      });
  }

  private async applyTrack(
    roonClient: RoonClient,
    zoneId: string,
    track: VirtualPlaylistTrack,
    mode: PlaylistPlayMode,
    sessionKey: string,
    results: Record<string, unknown>[],
    failures: Record<string, unknown>[]
  ): Promise<void> {
    try {
      if (mode === "play_now") {
        const result = await playByQuery(roonClient, {
          zoneId,
          query: track.query,
          sessionKey
        });
        results.push({ track, result });
        return;
      }

      const result = await queueByQuery(roonClient, {
        zoneId,
        query: track.query,
        mode,
        sessionKey
      });
      results.push({ track, result });
    } catch (error) {
      if (error instanceof ApiError) {
        failures.push({
          track,
          error: {
            code: error.code,
            message: error.message,
            details: error.details
          }
        });
        return;
      }

      failures.push({
        track,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }
}
