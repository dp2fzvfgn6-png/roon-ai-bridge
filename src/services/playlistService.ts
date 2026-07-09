import { AppConfig } from "../config/env";
import { createDatabase, SqliteDatabase } from "../db/database";
import { playByItemKey, playByQuery, queueByItemKey, queueByQuery } from "../roon/roonBrowseService";
import { RoonClient } from "../roon/roonClient";
import { controlPlayback } from "../roon/roonPlaybackService";
import {
  MediaResult,
  RoonMediaService,
  scoreSearchResult,
  SearchStrategyOptions,
  SourcePreference
} from "../roon/roonMediaService";
import { ApiError } from "../utils/errors";
import { Logger } from "../utils/logger";

export const playlistServiceImplemented = true;

export type VirtualPlaylistTrackMetadata = Record<string, unknown>;
export type AudioMetadata = Record<string, unknown>;
export type ResolutionMetadata = Record<string, unknown>;

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
  audio_metadata: AudioMetadata | null;
  user_metadata: VirtualPlaylistTrackMetadata | null;
  resolution: ResolutionMetadata | null;
  created_at: string;
};

export type VirtualPlaylist = {
  playlist_id: string;
  name: string;
  description: string | null;
  tracks: VirtualPlaylistTrack[];
  track_count: number;
  tracks_count: number;
  created_at: string;
  updated_at: string;
};

export type VirtualPlaylistListItem = Omit<VirtualPlaylist, "tracks"> & {
  tracks?: VirtualPlaylistTrack[];
  track_pagination?: {
    limit: number;
    offset: number;
    returned: number;
    total: number;
  };
};

export type VirtualPlaylistListOptions = {
  includeTracks?: boolean;
  limit?: number;
  offset?: number;
  trackLimit?: number;
  trackOffset?: number;
};

export type VirtualPlaylistListResult = {
  playlists: VirtualPlaylistListItem[];
  total: number;
  limit: number;
  offset: number;
  include_tracks: boolean;
};

export type VirtualPlaylistDetailResult = Omit<VirtualPlaylist, "tracks"> & {
  tracks?: VirtualPlaylistTrack[];
  include_tracks: boolean;
  limit: number;
  offset: number;
  returned_count: number;
  has_more: boolean;
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

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizePageNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new ApiError("INVALID_PLAYLIST", "Invalid pagination value", {
      value,
      min,
      max
    });
  }
  return Math.max(min, Math.min(Math.floor(parsed), max));
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

function splitStoredMetadata(value: VirtualPlaylistTrackMetadata | null): {
  audio_metadata: AudioMetadata | null;
  user_metadata: VirtualPlaylistTrackMetadata | null;
  resolution: ResolutionMetadata | null;
  legacy_metadata: VirtualPlaylistTrackMetadata | null;
} {
  if (!value) {
    return {
      audio_metadata: null,
      user_metadata: null,
      resolution: null,
      legacy_metadata: null
    };
  }

  const explicitAudio = objectValue(value.audio_metadata);
  const explicitUser = objectValue(value.user_metadata);
  const explicitResolution =
    objectValue(value.resolution) || objectValue(value.resolution_metadata);
  const derivedAudio: Record<string, unknown> = {};
  const derivedUser: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === "audio_metadata" || key === "user_metadata" || key === "resolution" || key === "resolution_metadata") continue;
    if (AUDIO_METADATA_KEYS.has(key)) derivedAudio[key] = entry;
    else derivedUser[key] = entry;
  }

  const audio = explicitAudio || (Object.keys(derivedAudio).length ? derivedAudio : null);
  const user = explicitUser || (Object.keys(derivedUser).length ? derivedUser : null);
  const resolution = explicitResolution || null;
  return {
    audio_metadata: audio,
    user_metadata: user,
    resolution,
    legacy_metadata: {
      ...(user || {}),
      ...(audio || {}),
      ...(resolution ? { resolution } : {})
    }
  };
}

function buildStoredMetadata(input: {
  metadata?: unknown;
  audio_metadata?: unknown;
  user_metadata?: unknown;
  resolution?: unknown;
}): VirtualPlaylistTrackMetadata | null {
  const legacy = splitStoredMetadata(objectValue(input.metadata));
  const explicitAudio = objectValue(input.audio_metadata);
  const explicitUser = objectValue(input.user_metadata);
  const audio = legacy.audio_metadata || explicitAudio
    ? { ...(legacy.audio_metadata || {}), ...(explicitAudio || {}) }
    : null;
  const user = legacy.user_metadata || explicitUser
    ? { ...(legacy.user_metadata || {}), ...(explicitUser || {}) }
    : null;
  const resolution = objectValue(input.resolution) || legacy.resolution;
  const stored: Record<string, unknown> = {};
  if (audio && Object.keys(audio).length > 0) stored.audio_metadata = audio;
  if (user && Object.keys(user).length > 0) stored.user_metadata = user;
  if (resolution && Object.keys(resolution).length > 0) stored.resolution = resolution;
  return Object.keys(stored).length > 0 ? stored : null;
}

function audioMetadataFromMedia(result: Partial<MediaResult> & Record<string, unknown>): AudioMetadata {
  return {
    title: typeof result.title === "string" ? result.title : null,
    artist: typeof result.artist === "string" ? result.artist : typeof result.subtitle === "string" ? result.subtitle : null,
    album: typeof result.album === "string" ? result.album : null,
    album_artist: typeof result.album_artist === "string" ? result.album_artist : null,
    composer: null,
    genre: null,
    release_year: null,
    track_number: null,
    disc_number: null,
    duration_seconds: null,
    isrc: null,
    source: result.source || "unknown",
    quality: result.quality || null,
    image_key: typeof result.image_key === "string" ? result.image_key : null,
    cover: typeof result.image_key === "string" ? { image_key: result.image_key } : null
  };
}

function imageKeyFromMetadata(metadata: VirtualPlaylistTrackMetadata | null): string | null {
  if (!metadata) return null;
  const split = splitStoredMetadata(metadata);
  const audio = split.audio_metadata;
  const audioImage = optionalString(audio?.image_key);
  if (audioImage) return audioImage;
  const audioCover = objectValue(audio?.cover);
  const audioCoverImage = optionalString(audioCover?.image_key);
  if (audioCoverImage) return audioCoverImage;

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

export type VirtualPlaylistResolutionStatus =
  | "resolved"
  | "unresolved"
  | "ambiguous"
  | "manual"
  | "failed";

export type VirtualPlaylistResolutionResult = {
  track_id: string;
  query: string;
  status: VirtualPlaylistResolutionStatus;
  roon_item_key: string | null;
  score: number | null;
  reason: string;
};

const RESOLUTION_SCORE_THRESHOLD = 85;
const AMBIGUOUS_SCORE_DELTA = 20;
const AUDIO_METADATA_KEYS = new Set([
  "title",
  "artist",
  "album",
  "album_artist",
  "composer",
  "genre",
  "release_year",
  "track_number",
  "disc_number",
  "duration_seconds",
  "isrc",
  "source",
  "quality",
  "image_key",
  "cover"
]);

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

  const title = optionalString(payload.title);
  const artist = optionalString(payload.artist);
  const query =
    nonEmptyString(payload.query) ||
    [title, artist].filter(Boolean).join(" ").trim();
  if (!query) {
    throw new ApiError("INVALID_PLAYLIST_TRACK", "Track query or title is required");
  }

  const derivedAudio: Record<string, unknown> = {};
  for (const key of AUDIO_METADATA_KEYS) {
    if (payload[key] !== undefined) derivedAudio[key] = payload[key];
  }
  if (title && derivedAudio.title === undefined) derivedAudio.title = title;
  if (artist && derivedAudio.artist === undefined) derivedAudio.artist = artist;
  if (payload.album !== undefined && derivedAudio.album === undefined) {
    derivedAudio.album = optionalString(payload.album);
  }

  return {
    track_id: nonEmptyString(payload.track_id) || fallbackTrackId || `track-${randomSuffix()}`,
    query,
    roon_item_key: optionalString(payload.roon_item_key),
    title,
    artist,
    album: optionalString(payload.album),
    position: optionalFiniteInteger(payload.position) ?? fallbackPosition ?? null,
    metadata_json: serializeMetadata(buildStoredMetadata({
      metadata: objectValue(payload.metadata) || objectValue(payload.metadata_json),
      audio_metadata: objectValue(payload.audio_metadata) || (Object.keys(derivedAudio).length ? derivedAudio : null),
      user_metadata: objectValue(payload.user_metadata),
      resolution: objectValue(payload.resolution) || objectValue(payload.resolution_metadata)
    })),
    created_at: optionalString(payload.created_at) || fallbackCreatedAt || nowIso()
  };
}

export class PlaylistService {
  private readonly database: SqliteDatabase;

  constructor(config: AppConfig, database?: SqliteDatabase) {
    this.database = database || createDatabase(config);
  }

  listPlaylists(options: VirtualPlaylistListOptions = {}): VirtualPlaylistListResult {
    const limit = normalizePageNumber(options.limit, 25, 1, 100);
    const offset = normalizePageNumber(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const includeTracks = Boolean(options.includeTracks);
    const trackLimit = normalizePageNumber(options.trackLimit, 25, 1, 100);
    const trackOffset = normalizePageNumber(options.trackOffset, 0, 0, Number.MAX_SAFE_INTEGER);
    const total = this.countPlaylists();
    const playlistRows = this.database.db
      .prepare(
        `SELECT playlist_id, name, description, created_at, updated_at
         FROM virtual_playlists
         ORDER BY updated_at DESC, name ASC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as PlaylistRow[];

    return {
      playlists: playlistRows.map((row) =>
        this.getPlaylistListItem(row, {
          includeTracks,
          trackLimit,
          trackOffset
        })
      ),
      total,
      limit,
      offset,
      include_tracks: includeTracks
    };
  }

  getPlaylist(playlistId: string): VirtualPlaylist {
    return this.getPlaylistById(playlistId);
  }

  getPlaylistDetail(
    playlistId: string,
    options: {
      includeTracks?: boolean;
      limit?: unknown;
      offset?: unknown;
    } = {}
  ): VirtualPlaylistDetailResult {
    const row = this.getPlaylistRowOrThrow(playlistId);
    const includeTracks = options.includeTracks !== false;
    const limit = normalizePageNumber(options.limit, 50, 1, 500);
    const offset = normalizePageNumber(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const trackCount = this.countTrackRows(playlistId);
    const tracks = includeTracks
      ? this.listTrackRows(playlistId, limit, offset).map((track) => this.mapTrack(track))
      : undefined;
    const result: VirtualPlaylistDetailResult = {
      playlist_id: row.playlist_id,
      name: row.name,
      description: row.description,
      track_count: trackCount,
      tracks_count: trackCount,
      include_tracks: includeTracks,
      limit,
      offset,
      returned_count: tracks?.length || 0,
      has_more: includeTracks ? offset + (tracks?.length || 0) < trackCount : false,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
    if (tracks) result.tracks = tracks;
    return result;
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

  async createPlaylistResolved(
    input: {
      playlist_id?: unknown;
      name?: unknown;
      description?: unknown;
      tracks?: unknown;
    },
    options: {
      mediaService: RoonMediaService;
      logger?: Logger;
      sourcePreference?: SourcePreference;
    }
  ): Promise<VirtualPlaylist> {
    const playlist = this.createPlaylist(input);
    await this.resolveVirtualPlaylistItems(playlist.playlist_id, options);
    return this.getPlaylistById(playlist.playlist_id);
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

  async addTrackResolved(
    playlistId: string,
    input: unknown,
    options: {
      mediaService: RoonMediaService;
      logger?: Logger;
      sourcePreference?: SourcePreference;
    }
  ): Promise<VirtualPlaylist> {
    const playlist = this.addTrack(playlistId, input);
    const track = playlist.tracks[playlist.tracks.length - 1];
    await this.resolveVirtualPlaylistItems(playlistId, {
      ...options,
      trackIds: track ? [track.track_id] : undefined
    });
    return this.getPlaylistById(playlistId);
  }

  updateTrack(playlistId: string, trackId: string, input: unknown): VirtualPlaylist {
    const row = this.getTrackRowOrThrow(playlistId, trackId);
    const payload = objectValue(input);
    if (!payload) {
      throw new ApiError("INVALID_PLAYLIST_TRACK", "Track must be an object");
    }
    const requestedPosition = hasOwn(payload, "position")
      ? optionalFiniteInteger(payload.position)
      : null;
    if (hasOwn(payload, "position") && requestedPosition === null) {
      throw new ApiError("INVALID_PLAYLIST_TRACK", "Track position must be a finite integer", {
        playlist_id: playlistId,
        track_id: trackId,
        position: payload.position
      });
    }
    const normalized = normalizeTrackInput(input, row.track_id, row.position, row.created_at);
    const rows = this.listTrackRows(playlistId);
    if (requestedPosition !== null) {
      this.validateTrackPositionRange(playlistId, trackId, requestedPosition, rows.length);
    }

    this.database.transaction(() => {
      this.database.db
        .prepare(
          `UPDATE virtual_playlist_tracks
           SET query = :query,
               roon_item_key = :roon_item_key,
               title = :title,
               artist = :artist,
               album = :album,
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
          metadata_json: normalized.metadata_json
        });

      if (requestedPosition !== null) {
        this.moveTrackToPositionUnchecked(playlistId, trackId, requestedPosition, rows);
      } else {
        this.normalizeTrackPositions(playlistId);
      }
      this.touchPlaylist(playlistId);
    });

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

  async replaceTracksResolved(
    playlistId: string,
    tracks: unknown,
    options: {
      mediaService: RoonMediaService;
      logger?: Logger;
      sourcePreference?: SourcePreference;
    }
  ): Promise<VirtualPlaylist> {
    this.replaceTracks(playlistId, tracks);
    await this.resolveVirtualPlaylistItems(playlistId, options);
    return this.getPlaylistById(playlistId);
  }

  async resolveVirtualPlaylistItems(
    playlistId: string,
    options: {
      mediaService: RoonMediaService;
      logger?: Logger;
      sourcePreference?: SourcePreference;
      trackIds?: string[];
      force?: boolean;
    }
  ): Promise<{
    playlist: VirtualPlaylist;
    resolution: VirtualPlaylistResolutionResult[];
  }> {
    this.getPlaylistById(playlistId);
    const trackIdFilter = options.trackIds ? new Set(options.trackIds) : null;
    const rows = this.listTrackRows(playlistId).filter((track) => {
      if (trackIdFilter && !trackIdFilter.has(track.track_id)) return false;
      return options.force || !track.roon_item_key;
    });
    const resolution: VirtualPlaylistResolutionResult[] = [];

    for (const row of rows) {
      const result = await this.resolvePlaylistEntry(row, options);
      resolution.push(result);
    }

    if (resolution.length > 0) this.touchPlaylist(playlistId);
    return {
      playlist: this.getPlaylistById(playlistId),
      resolution
    };
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

  validatePlaylist(playlistId: string): Record<string, unknown> {
    const playlist = this.getPlaylistById(playlistId);
    const issues: Record<string, unknown>[] = [];
    const titleArtist = new Map<string, VirtualPlaylistTrack[]>();
    const roonKeys = new Map<string, VirtualPlaylistTrack[]>();
    const positions = new Map<number, VirtualPlaylistTrack[]>();

    for (const track of playlist.tracks) {
      if (!track.query) {
        issues.push({ track_id: track.track_id, type: "missing_query", severity: "error", message: "Track has no query", suggested_actions: ["edit_track"] });
      }
      if (!track.roon_item_key) {
        issues.push({ track_id: track.track_id, type: "unresolved", severity: "warning", message: "No playable Roon result stored", suggested_actions: ["search_broader", "manual_select"] });
      }
      if (track.resolution?.status === "ambiguous") {
        issues.push({ track_id: track.track_id, type: "ambiguous", severity: "warning", message: "Several close candidates were found", suggested_actions: ["manual_select"] });
      }
      if (!track.audio_metadata?.title || !track.audio_metadata?.artist) {
        issues.push({ track_id: track.track_id, type: "missing_metadata", severity: "info", message: "Audio metadata is incomplete", suggested_actions: ["resolve"] });
      }
      positions.set(track.position, [...(positions.get(track.position) || []), track]);
      const normalized = this.duplicateKey(track);
      if (normalized) titleArtist.set(normalized, [...(titleArtist.get(normalized) || []), track]);
      if (track.roon_item_key) roonKeys.set(track.roon_item_key, [...(roonKeys.get(track.roon_item_key) || []), track]);
    }

    for (const [position, group] of positions.entries()) {
      if (group.length > 1) {
        for (const track of group) {
          issues.push({ track_id: track.track_id, type: "duplicate_position", severity: "error", message: `Position ${position} is duplicated`, suggested_actions: ["sort"] });
        }
      }
    }
    for (const group of [...titleArtist.values(), ...roonKeys.values()]) {
      if (group.length > 1) {
        issues.push({ track_id: group.map((track) => track.track_id), type: "duplicates", severity: "info", message: "Probable duplicate tracks", suggested_actions: ["deduplicate"] });
      }
    }

    const summary = {
      resolved: playlist.tracks.filter((track) => track.roon_item_key && track.resolution?.status !== "ambiguous").length,
      unresolved: playlist.tracks.filter((track) => !track.roon_item_key).length,
      ambiguous: playlist.tracks.filter((track) => track.resolution?.status === "ambiguous").length,
      missing_metadata: playlist.tracks.filter((track) => !track.audio_metadata?.title || !track.audio_metadata?.artist).length,
      duplicates: issues.filter((issue) => issue.type === "duplicates").length
    };

    return { ok: true, playlist_id: playlistId, track_count: playlist.track_count, summary, issues };
  }

  deduplicatePlaylist(playlistId: string, input: { dry_run?: unknown; strategy?: Record<string, unknown> } = {}): Record<string, unknown> {
    const playlist = this.getPlaylistById(playlistId);
    const strategy = input.strategy || {};
    const groups = new Map<string, VirtualPlaylistTrack[]>();
    const add = (key: string | null, track: VirtualPlaylistTrack) => {
      if (!key) return;
      groups.set(key, [...(groups.get(key) || []), track]);
    };
    for (const track of playlist.tracks) {
      if (strategy.match_by_roon_item_key !== false) add(track.roon_item_key ? `roon:${track.roon_item_key}` : null, track);
      if (strategy.match_by_normalized_title_artist !== false) add(this.duplicateKey(track), track);
    }
    const duplicateGroups = [...groups.entries()]
      .map(([key, tracks]) => ({ key, tracks: tracks.filter((track, index, arr) => arr.findIndex((other) => other.track_id === track.track_id) === index) }))
      .filter((group) => group.tracks.length > 1)
      .map((group) => ({
        match_key: group.key,
        tracks: group.tracks,
        suggested_keep_track_id: group.tracks[0].track_id,
        suggested_remove_track_ids: group.tracks.slice(1).map((track) => track.track_id)
      }));
    return { ok: true, playlist_id: playlistId, dry_run: input.dry_run !== false, groups: duplicateGroups };
  }

  sortPlaylist(playlistId: string, input: { sort_by?: Array<{ field?: string; direction?: string }>; dry_run?: unknown } = {}): Record<string, unknown> {
    const playlist = this.getPlaylistById(playlistId);
    const sortBy = input.sort_by?.length ? input.sort_by : [{ field: "position", direction: "asc" }];
    const sorted = playlist.tracks.slice().sort((a, b) => {
      for (const rule of sortBy) {
        const direction = rule.direction === "desc" ? -1 : 1;
        const av = this.sortValue(a, rule.field || "position");
        const bv = this.sortValue(b, rule.field || "position");
        if (av === undefined || av === null || av === "") {
          if (bv === undefined || bv === null || bv === "") continue;
          return 1;
        }
        if (bv === undefined || bv === null || bv === "") return -1;
        const cmp = typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av ?? "").localeCompare(String(bv ?? ""), "es", { numeric: true, sensitivity: "base" });
        if (cmp !== 0) return cmp * direction;
      }
      return a.position - b.position;
    });
    if (input.dry_run !== false) {
      return { ok: true, playlist_id: playlistId, dry_run: true, tracks: sorted.map((track, index) => ({ track_id: track.track_id, old_position: track.position, new_position: index + 1 })) };
    }
    return { ok: true, playlist_id: playlistId, playlist: this.reorderTracks(playlistId, sorted.map((track) => track.track_id)) };
  }

  exportPlaylist(playlistId: string, format = "json"): Record<string, unknown> | string {
    const playlist = this.getPlaylistById(playlistId);
    if (format === "csv") {
      const userKeys = Array.from(new Set(playlist.tracks.flatMap((track) => Object.keys(track.user_metadata || {}))));
      const headers = ["track_id", "position", "query", "roon_item_key", "title", "artist", "album", "resolution_status", ...userKeys.map((key) => `user_metadata.${key}`)];
      const rows = playlist.tracks.map((track) => headers.map((header) => {
        const value = header.startsWith("user_metadata.")
          ? track.user_metadata?.[header.slice("user_metadata.".length)]
          : header === "resolution_status"
            ? track.resolution?.status
            : (track as any)[header] ?? track.audio_metadata?.[header];
        return `"${String(value ?? "").replaceAll('"', '""')}"`;
      }).join(","));
      return [headers.join(","), ...rows].join("\n");
    }
    if (format === "m3u") {
      return ["#EXTM3U", ...playlist.tracks.map((track) => `#EXTINF:${track.audio_metadata?.duration_seconds ?? -1},${track.artist || track.audio_metadata?.artist || ""} - ${track.title || track.audio_metadata?.title || track.query}\n${track.roon_item_key || track.query}`)].join("\n");
    }
    return { ok: true, format: "json", playlist };
  }

  importPlaylist(input: Record<string, unknown>): Record<string, unknown> {
    const dryRun = Boolean(input.dry_run);
    const overwrite = Boolean(input.overwrite || input.confirm);
    const rawPlaylist = objectValue(input.playlist) || input;
    const playlistId = nonEmptyString(rawPlaylist.playlist_id);
    const exists = playlistId ? this.playlistExists(playlistId) : false;
    if (exists && !overwrite) {
      throw new ApiError("INVALID_PLAYLIST", "Playlist exists; pass overwrite or confirm to update it", { playlist_id: playlistId });
    }
    const tracks = Array.isArray(rawPlaylist.tracks) ? rawPlaylist.tracks : [];
    if (dryRun) {
      return { ok: true, dry_run: true, would_update: exists, playlist_id: playlistId, track_count: tracks.length };
    }
    if (exists && playlistId) {
      this.updatePlaylist(playlistId, { name: rawPlaylist.name, description: rawPlaylist.description });
      this.replaceTracks(playlistId, tracks);
      return { ok: true, action: "updated", playlist: this.getPlaylistById(playlistId) };
    }
    return { ok: true, action: "created", playlist: this.createPlaylist(rawPlaylist as any) };
  }

  setTrackMatch(playlistId: string, trackId: string, resultId: string, input: { mediaService: RoonMediaService; selectionReason?: string }): VirtualPlaylist {
    const row = this.getTrackRowOrThrow(playlistId, trackId);
    const result = input.mediaService.get(resultId);
    this.updateTrackResolution(row, {
      status: "manual",
      query: row.query,
      roonItemKey: result.roon_item_key || result.result_id,
      score: result.match_score,
      reason: input.selectionReason || "manual_user_selection",
      result
    });
    this.touchPlaylist(playlistId);
    return this.getPlaylistById(playlistId);
  }

  addSearchResultToPlaylist(playlistId: string, input: { result_id?: unknown; position?: unknown; user_metadata?: unknown }, mediaService: RoonMediaService): VirtualPlaylist {
    const resultId = nonEmptyString(input.result_id);
    if (!resultId) throw new ApiError("INVALID_SEARCH_QUERY", "result_id is required");
    const result = mediaService.get(resultId);
    const added = this.addTrack(playlistId, {
      query: [result.title, result.artist || result.subtitle].filter(Boolean).join(" "),
      roon_item_key: result.roon_item_key || result.result_id,
      title: result.title,
      artist: result.artist || result.subtitle,
      album: result.album,
      position: input.position,
      audio_metadata: audioMetadataFromMedia(result),
      user_metadata: objectValue(input.user_metadata),
      resolution: {
        status: "manual",
        selected_result_id: result.result_id,
        selected_roon_item_key: result.roon_item_key || result.result_id,
        score: result.match_score,
        confidence: result.confidence,
        reason: "added_from_search_result",
        resolved_at: nowIso()
      }
    });
    if (input.position !== undefined) {
      const track = added.tracks[added.tracks.length - 1];
      return this.updateTrack(playlistId, track.track_id, { ...track, position: input.position });
    }
    return this.getPlaylistById(playlistId);
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
    let playback: Record<string, unknown> | null = null;
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

      if (failures.length === 0) {
        playback = await controlPlayback(roonClient, zoneId, "play");
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
      playback,
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

  private duplicateKey(track: VirtualPlaylistTrack): string | null {
    const title = track.audio_metadata?.title || track.title;
    const artist = track.audio_metadata?.artist || track.artist;
    if (!title || !artist) return null;
    return `title_artist:${slugify(String(title))}:${slugify(String(artist))}`;
  }

  private sortValue(track: VirtualPlaylistTrack, field: string): unknown {
    if (field === "season_episode") {
      return `${track.user_metadata?.season ?? ""}.${track.user_metadata?.episode ?? ""}.${track.position}`;
    }
    if (field.startsWith("user_metadata.")) {
      return track.user_metadata?.[field.slice("user_metadata.".length)];
    }
    if (field === "duration") return track.audio_metadata?.duration_seconds;
    if (field in track) return (track as any)[field];
    return track.audio_metadata?.[field];
  }

  private playlistExists(playlistId: string): boolean {
    const row = this.database.db
      .prepare("SELECT 1 FROM virtual_playlists WHERE playlist_id = ?")
      .get(playlistId) as Record<string, unknown> | undefined;
    return Boolean(row);
  }

  private countPlaylists(): number {
    const row = this.database.db
      .prepare("SELECT COUNT(*) AS count FROM virtual_playlists")
      .get() as { count?: number } | undefined;
    return row?.count || 0;
  }

  private getPlaylistById(playlistId: string): VirtualPlaylist {
    return this.getPlaylistFromRow(this.getPlaylistRowOrThrow(playlistId));
  }

  private getPlaylistRowOrThrow(playlistId: string): PlaylistRow {
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

    return row;
  }

  private getPlaylistFromRow(row: PlaylistRow): VirtualPlaylist {
    const tracks = this.listTrackRows(row.playlist_id).map((track) => this.mapTrack(track));
    const trackCount = tracks.length;
    return {
      playlist_id: row.playlist_id,
      name: row.name,
      description: row.description,
      tracks,
      track_count: trackCount,
      tracks_count: trackCount,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private getPlaylistListItem(
    row: PlaylistRow,
    options: { includeTracks: boolean; trackLimit: number; trackOffset: number }
  ): VirtualPlaylistListItem {
    const trackCount = this.countTrackRows(row.playlist_id);
    const base = {
      playlist_id: row.playlist_id,
      name: row.name,
      description: row.description,
      track_count: trackCount,
      tracks_count: trackCount,
      created_at: row.created_at,
      updated_at: row.updated_at
    };

    if (!options.includeTracks) return base;

    const tracks = this.listTrackRows(
      row.playlist_id,
      options.trackLimit,
      options.trackOffset
    ).map((track) => this.mapTrack(track));
    return {
      ...base,
      tracks,
      track_pagination: {
        limit: options.trackLimit,
        offset: options.trackOffset,
        returned: tracks.length,
        total: trackCount
      }
    };
  }

  private listTrackRows(
    playlistId: string,
    limit?: number,
    offset?: number
  ): TrackRow[] {
    const sql = `SELECT track_id, playlist_id, query, roon_item_key, title, artist, album, position, metadata_json, created_at
         FROM virtual_playlist_tracks
         WHERE playlist_id = ?
         ORDER BY position ASC, created_at ASC, track_id ASC`;
    if (typeof limit === "number") {
      return this.database.db
        .prepare(`${sql} LIMIT ? OFFSET ?`)
        .all(playlistId, limit, offset || 0) as TrackRow[];
    }
    return this.database.db.prepare(sql).all(playlistId) as TrackRow[];
  }

  private countTrackRows(playlistId: string): number {
    const row = this.database.db
      .prepare(
        "SELECT COUNT(*) AS count FROM virtual_playlist_tracks WHERE playlist_id = ?"
      )
      .get(playlistId) as { count?: number } | undefined;
    return row?.count || 0;
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
    const split = splitStoredMetadata(metadata);
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
      metadata: split.legacy_metadata,
      audio_metadata: split.audio_metadata,
      user_metadata: split.user_metadata,
      resolution: split.resolution,
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

  private moveTrackToPosition(
    playlistId: string,
    trackId: string,
    position: number
  ): void {
    const rows = this.listTrackRows(playlistId);
    this.validateTrackPositionRange(playlistId, trackId, position, rows.length);

    this.database.transaction(() => {
      this.moveTrackToPositionUnchecked(playlistId, trackId, position, rows);
    });
  }

  private validateTrackPositionRange(
    playlistId: string,
    trackId: string,
    position: number,
    trackCount: number
  ): void {
    if (position < 1 || position > trackCount) {
      throw new ApiError("INVALID_PLAYLIST_TRACK", "Track position is outside playlist range", {
        playlist_id: playlistId,
        track_id: trackId,
        position,
        min: 1,
        max: trackCount
      });
    }
  }

  private moveTrackToPositionUnchecked(
    playlistId: string,
    trackId: string,
    position: number,
    rows: TrackRow[]
  ): void {
    const currentIndex = rows.findIndex((track) => track.track_id === trackId);
    if (currentIndex < 0) {
      throw new ApiError("PLAYLIST_TRACK_NOT_FOUND", "Virtual playlist track not found", {
        playlist_id: playlistId,
        track_id: trackId
      });
    }

    const [moving] = rows.splice(currentIndex, 1);
    rows.splice(position - 1, 0, moving);

    const update = this.database.db.prepare(
      `UPDATE virtual_playlist_tracks
       SET position = :position
       WHERE playlist_id = :playlist_id AND track_id = :track_id`
    );
    rows.forEach((track, index) => {
      update.run({
        playlist_id: playlistId,
        track_id: track.track_id,
        position: index + 1
      });
    });
  }

  private async resolvePlaylistEntry(
    row: TrackRow,
    options: {
      mediaService: RoonMediaService;
      logger?: Logger;
      sourcePreference?: SourcePreference;
    }
  ): Promise<VirtualPlaylistResolutionResult> {
    const logger = options.logger;
    const query = row.query || [row.title, row.artist].filter(Boolean).join(" ");
    logger?.info("Virtual playlist entry resolution started", {
      playlistId: row.playlist_id,
      trackId: row.track_id,
      query,
      title: row.title,
      artist: row.artist
    });

    try {
      const payload = await options.mediaService.search({
        query,
        count: 10,
        sourcePreference: options.sourcePreference || "highest_quality"
      });
      logger?.info("Virtual playlist entry search completed", {
        playlistId: row.playlist_id,
        trackId: row.track_id,
        query,
        results: payload.results.length,
        warnings: payload.warnings
      });

      const candidates = payload.results
        .map((result) => ({
          result,
          scoring: scoreSearchResult(result, {
            query,
            title: row.title,
            artist: row.artist,
            album: row.album,
            sourcePreference: options.sourcePreference || "highest_quality"
          })
        }))
        .sort((a, b) => b.scoring.score - a.scoring.score);

      const best = candidates[0];
      if (!best) {
        const unresolved = this.updateTrackResolution(row, {
          status: "unresolved",
          query,
          roonItemKey: null,
          score: null,
          reason: "Roon search returned no results"
        });
        logger?.warn("Virtual playlist entry unresolved", unresolved);
        return unresolved;
      }

      const roonItemKey = best.result.roon_item_key || best.result.result_id;
      const second = candidates[1];
      const ambiguous = Boolean(
        second &&
        second.result.media_type === best.result.media_type &&
        second.scoring.score >= 60 &&
        Math.abs(best.scoring.score - second.scoring.score) <= AMBIGUOUS_SCORE_DELTA
      );
      const hasStablePlayableKey = Boolean(best.result.roon_item_key || best.result.result_id);
      const baseConfidence = best.result.confidence || best.scoring.confidence;
      const richEnough =
        Boolean(row.album || best.result.album) ||
        best.result.source !== "unknown" ||
        best.result.quality !== null ||
        best.result.is_library !== null;
      const accepted =
        best.result.media_type === "track" &&
        best.result.playable &&
        hasStablePlayableKey &&
        best.scoring.score >= RESOLUTION_SCORE_THRESHOLD &&
        baseConfidence !== "low" &&
        richEnough &&
        !ambiguous;
      const status: VirtualPlaylistResolutionStatus = accepted
        ? "resolved"
        : ambiguous
          ? "ambiguous"
          : "unresolved";
      const reason = best.scoring.reasons.join(", ") || "best available candidate";
      const stored = this.updateTrackResolution(row, {
        status,
        query,
        roonItemKey: accepted ? roonItemKey : null,
        score: best.scoring.score,
        reason,
        result: best.result,
        candidates: candidates.slice(0, 5).map((candidate) => candidate.result)
      });

      const logMeta = {
        ...stored,
        candidate_title: best.result.title,
        candidate_subtitle: best.result.subtitle,
        candidate_type: best.result.media_type,
        candidate_playable: best.result.playable
      };
      if (accepted) {
        logger?.info("Virtual playlist entry resolved", logMeta);
      } else {
        logger?.warn("Virtual playlist entry low confidence", logMeta);
      }
      return stored;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = this.updateTrackResolution(row, {
        status: "failed",
        query,
        roonItemKey: null,
        score: null,
        reason: message
      });
      logger?.warn("Virtual playlist entry resolution failed", {
        ...failed,
        error: message
      });
      return failed;
    }
  }

  private updateTrackResolution(
    row: TrackRow,
    resolution: {
      status: VirtualPlaylistResolutionStatus;
      query: string;
      roonItemKey: string | null;
      score: number | null;
      reason: string;
      result?: Record<string, unknown>;
      candidates?: Record<string, unknown>[];
    }
  ): VirtualPlaylistResolutionResult {
    const metadata = parseMetadata(row.metadata_json) || {};
    const split = splitStoredMetadata(metadata);
    const audioMetadata = resolution.result
      ? audioMetadataFromMedia(resolution.result as MediaResult)
      : split.audio_metadata;
    const nextMetadata: Record<string, unknown> = {
      ...(split.user_metadata ? { user_metadata: split.user_metadata } : {}),
      ...(audioMetadata ? { audio_metadata: audioMetadata } : {}),
      resolution: {
        status: resolution.status,
        query: resolution.query,
        selected_result_id: resolution.result?.result_id || null,
        selected_roon_item_key: resolution.roonItemKey,
        score: resolution.score,
        confidence: resolution.score === null
          ? "low"
          : resolution.score >= 85
            ? "high"
            : resolution.score >= 60
              ? "medium"
              : "low",
        reason: resolution.reason,
        resolved_at: nowIso(),
        candidates: resolution.candidates?.map((candidate) => ({
          result_id: candidate.result_id,
          roon_item_key: candidate.roon_item_key,
          title: candidate.title,
          artist: candidate.artist,
          album: candidate.album,
          source: candidate.source,
          playable: candidate.playable,
          match_score: candidate.match_score,
          confidence: candidate.confidence
        })) || [],
        result: resolution.result
          ? {
              result_id: resolution.result.result_id,
              media_type: resolution.result.media_type,
              title: resolution.result.title,
              subtitle: resolution.result.subtitle,
              source: resolution.result.source,
              quality: resolution.result.quality,
              playable: resolution.result.playable
            }
          : null
      }
    };
    const imageKey =
      resolution.result && typeof resolution.result.image_key === "string"
        ? resolution.result.image_key
        : imageKeyFromMetadata(metadata);
    if (imageKey) {
      nextMetadata.audio_metadata = {
        ...(objectValue(nextMetadata.audio_metadata) || {}),
        image_key: imageKey,
        cover: { image_key: imageKey }
      };
    }

    this.database.db
      .prepare(
        `UPDATE virtual_playlist_tracks
         SET roon_item_key = :roon_item_key,
             metadata_json = :metadata_json
         WHERE playlist_id = :playlist_id AND track_id = :track_id`
      )
      .run({
        playlist_id: row.playlist_id,
        track_id: row.track_id,
        roon_item_key: resolution.roonItemKey,
        metadata_json: JSON.stringify(nextMetadata)
      });

    return {
      track_id: row.track_id,
      query: resolution.query,
      status: resolution.status,
      roon_item_key: resolution.roonItemKey,
      score: resolution.score,
      reason: resolution.reason
    };
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
        const result = track.roon_item_key
          ? await playByItemKey(roonClient, {
            zoneId,
            itemKey: track.roon_item_key,
            label: track.title || track.query,
            sessionKey
          })
          : await playByQuery(roonClient, {
            zoneId,
            query: track.query,
            sessionKey
          });
        results.push({ track, result });
        return;
      }

      const result = track.roon_item_key
        ? await queueByItemKey(roonClient, {
          zoneId,
          itemKey: track.roon_item_key,
          label: track.title || track.query,
          mode,
          sessionKey
        })
        : await queueByQuery(roonClient, {
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
