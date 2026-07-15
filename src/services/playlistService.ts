import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { AppConfig } from "../config/env";
import { createDatabase, SqliteDatabase } from "../db/database";
import { playByQuery, queueByQuery } from "../roon/roonBrowseService";
import { RoonClient } from "../roon/roonClient";
import { controlPlayback } from "../roon/roonPlaybackService";
import {
  MediaResult,
  RoonMediaService,
  SourcePreference,
  VersionHint
} from "../roon/roonMediaService";
import { TrackResolutionService } from "./trackResolutionService";
import { ApiError } from "../utils/errors";
import { Logger } from "../utils/logger";

export const playlistServiceImplemented = true;
const CUSTOM_COVER_PREFIX = "custom:";
const MAX_CUSTOM_COVER_BYTES = 5 * 1024 * 1024;
const MAX_CUSTOM_COVER_INPUT_PIXELS = 40_000_000;
const NORMALIZED_COVER_SIZE = 768;
const MAX_NORMALIZED_COVER_BYTES = 750 * 1024;
const COVER_CONTENT_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

export type VirtualPlaylistTrackMetadata = Record<string, unknown>;
export type AudioMetadata = Record<string, unknown>;
export type ResolutionMetadata = Record<string, unknown>;
export type TrackIdentityMetadata = {
  version: 1;
  fingerprint: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  album_artist: string | null;
  duration_seconds: number | null;
  isrc: string | null;
  release_year: number | null;
  track_number: number | null;
  disc_number: number | null;
  version_hint: string | null;
  source: string | null;
  canonical_query: string;
};

export type RoonBinding = {
  state: "stale" | "missing";
  item_key: string | null;
  reusable: false;
  last_observed_at: string | null;
};

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
  identity: TrackIdentityMetadata;
  resolution: ResolutionMetadata | null;
  roon_binding: RoonBinding;
  created_at: string;
};

export type VirtualPlaylist = {
  playlist_id: string;
  name: string;
  description: string | null;
  cover_image_key: string | null;
  cover: { image_key: string } | null;
  tracks: VirtualPlaylistTrack[];
  track_count: number;
  tracks_count: number;
  last_played_at: string | null;
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

export type PlaylistPlaybackRuntime = {
  mediaService?: RoonMediaService;
  logger?: Logger;
  sourcePreference?: SourcePreference;
};

export type StoredPlaylistCover = {
  cover_image_key: string;
  content_type: string;
  bytes: Buffer;
};

type PlaylistRow = {
  playlist_id: string;
  name: string;
  description: string | null;
  cover_image_key: string | null;
  last_played_at: string | null;
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
  identity: TrackIdentityMetadata | null;
  resolution: ResolutionMetadata | null;
  legacy_metadata: VirtualPlaylistTrackMetadata | null;
} {
  if (!value) {
    return {
      audio_metadata: null,
      user_metadata: null,
      identity: null,
      resolution: null,
      legacy_metadata: null
    };
  }

  const explicitAudio = objectValue(value.audio_metadata);
  const explicitUser = objectValue(value.user_metadata);
  const explicitIdentity = objectValue(value.identity) as TrackIdentityMetadata | null;
  const explicitResolution =
    objectValue(value.resolution) || objectValue(value.resolution_metadata);
  const derivedAudio: Record<string, unknown> = {};
  const derivedUser: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === "audio_metadata" || key === "user_metadata" || key === "identity" || key === "resolution" || key === "resolution_metadata") continue;
    if (AUDIO_METADATA_KEYS.has(key)) derivedAudio[key] = entry;
    else derivedUser[key] = entry;
  }

  const audio = explicitAudio || (Object.keys(derivedAudio).length ? derivedAudio : null);
  const user = explicitUser || (Object.keys(derivedUser).length ? derivedUser : null);
  const resolution = explicitResolution || null;
  return {
    audio_metadata: audio,
    user_metadata: user,
    identity: explicitIdentity,
    resolution,
    legacy_metadata: {
      ...(user || {}),
      ...(audio || {}),
      ...(explicitIdentity ? { identity: explicitIdentity } : {}),
      ...(resolution ? { resolution } : {})
    }
  };
}

function buildStoredMetadata(input: {
  metadata?: unknown;
  audio_metadata?: unknown;
  user_metadata?: unknown;
  identity?: unknown;
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
  const identity = objectValue(input.identity) || legacy.identity;
  const stored: Record<string, unknown> = {};
  if (audio && Object.keys(audio).length > 0) stored.audio_metadata = audio;
  if (user && Object.keys(user).length > 0) stored.user_metadata = user;
  if (identity && Object.keys(identity).length > 0) stored.identity = identity;
  if (resolution && Object.keys(resolution).length > 0) stored.resolution = resolution;
  return Object.keys(stored).length > 0 ? stored : null;
}

function audioMetadataFromMedia(result: Partial<MediaResult> & Record<string, unknown>): AudioMetadata {
  return {
    title: typeof result.title === "string" ? result.title : null,
    artist: typeof result.artist === "string" ? result.artist : typeof result.subtitle === "string" ? result.subtitle : null,
    album: typeof result.album === "string" ? result.album : null,
    album_artist: typeof result.album_artist === "string" ? result.album_artist : null,
    composer: optionalString(result.composer),
    genre: result.genre || null,
    release_year: optionalFiniteInteger(result.release_year),
    track_number: optionalFiniteInteger(result.track_number),
    disc_number: optionalFiniteInteger(result.disc_number),
    duration_seconds: optionalFiniteInteger(result.duration_seconds),
    isrc: optionalString(result.isrc),
    version_hint: typeof result.version_hint === "string" ? result.version_hint : null,
    source: result.source || "unknown",
    quality: result.quality || null,
    image_key: typeof result.image_key === "string" ? result.image_key : null,
    cover: typeof result.image_key === "string" ? { image_key: result.image_key } : null
  };
}

function mediaCandidateSnapshot(result: Record<string, unknown>): Record<string, unknown> {
  return {
    media_type: result.media_type || result.type || null,
    title: result.title || null,
    artist: result.artist || result.subtitle || null,
    album: result.album || null,
    album_artist: result.album_artist || null,
    duration_seconds: result.duration_seconds || null,
    isrc: result.isrc || null,
    release_year: result.release_year || null,
    track_number: result.track_number || null,
    disc_number: result.disc_number || null,
    version_hint: result.version_hint || null,
    source: result.source || null,
    quality: result.quality || null,
    image_key: result.image_key || null,
    playable: result.playable ?? null,
    confidence: result.confidence || null,
    match_score: result.match_score ?? null
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

function customCoverFileName(imageKey: string | null): string | null {
  if (!imageKey?.startsWith(CUSTOM_COVER_PREFIX)) return null;
  const fileName = imageKey.slice(CUSTOM_COVER_PREFIX.length);
  return fileName && path.basename(fileName) === fileName ? fileName : null;
}

function decodeCoverInput(input: {
  data_url?: unknown;
  image_base64?: unknown;
  content_type?: unknown;
}): { contentType: string; extension: string; bytes: Buffer } {
  let contentType = optionalString(input.content_type);
  let encoded = optionalString(input.image_base64);
  const dataUrl = optionalString(input.data_url);
  if (dataUrl) {
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) {
      throw new ApiError("INVALID_PLAYLIST_COVER", "data_url must contain a base64 JPEG, PNG or WebP image");
    }
    contentType = match[1].toLowerCase();
    encoded = match[2];
  }
  const extension = contentType ? COVER_CONTENT_TYPES.get(contentType) : null;
  if (!contentType || !extension || !encoded) {
    throw new ApiError("INVALID_PLAYLIST_COVER", "Image data and a supported content_type are required", {
      allowed_content_types: Array.from(COVER_CONTENT_TYPES.keys())
    });
  }
  const compact = encoded.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new ApiError("INVALID_PLAYLIST_COVER", "image_base64 is not valid base64 data");
  }
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length === 0 || bytes.length > MAX_CUSTOM_COVER_BYTES) {
    throw new ApiError("INVALID_PLAYLIST_COVER", "Playlist cover must be between 1 byte and 5 MB", {
      maximum_bytes: MAX_CUSTOM_COVER_BYTES,
      received_bytes: bytes.length
    });
  }
  const signatureMatches =
    (contentType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (contentType === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) ||
    (contentType === "image/webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP");
  if (!signatureMatches) {
    throw new ApiError("INVALID_PLAYLIST_COVER", "Image bytes do not match content_type");
  }
  return { contentType, extension, bytes };
}

async function normalizeCoverImage(bytes: Buffer): Promise<Buffer> {
  try {
    const image = sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_CUSTOM_COVER_INPUT_PIXELS
    })
      .rotate()
      .resize(NORMALIZED_COVER_SIZE, NORMALIZED_COVER_SIZE, {
        fit: "cover",
        position: "centre",
        withoutEnlargement: true
      });

    for (const quality of [80, 70, 60, 50]) {
      const normalized = await image.clone().webp({ quality, effort: 4 }).toBuffer();
      if (normalized.length <= MAX_NORMALIZED_COVER_BYTES) return normalized;
    }

    const fallback = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_CUSTOM_COVER_INPUT_PIXELS
    })
      .rotate()
      .resize(512, 512, { fit: "cover", position: "centre", withoutEnlargement: true })
      .webp({ quality: 55, effort: 5 })
      .toBuffer();
    if (fallback.length > MAX_NORMALIZED_COVER_BYTES) {
      throw new Error("normalized image remains larger than 750 KB");
    }
    return fallback;
  } catch (error) {
    throw new ApiError("INVALID_PLAYLIST_COVER", "Playlist cover could not be decoded or normalized", {
      maximum_input_pixels: MAX_CUSTOM_COVER_INPUT_PIXELS,
      normalized_size_pixels: NORMALIZED_COVER_SIZE,
      maximum_normalized_bytes: MAX_NORMALIZED_COVER_BYTES,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function canonicalText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function identityFromTrack(input: {
  query: string;
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  audioMetadata?: AudioMetadata | null;
  existing?: TrackIdentityMetadata | null;
}): TrackIdentityMetadata {
  const audio = input.audioMetadata || {};
  const existing = input.existing || null;
  const title = optionalString(audio.title) || optionalString(input.title) || existing?.title || null;
  const artist = optionalString(audio.artist) || optionalString(input.artist) || existing?.artist || null;
  const album = optionalString(audio.album) || optionalString(input.album) || existing?.album || null;
  const albumArtist = optionalString(audio.album_artist) || existing?.album_artist || null;
  const duration = optionalFiniteInteger(audio.duration_seconds) ?? existing?.duration_seconds ?? null;
  const isrc = optionalString(audio.isrc) || existing?.isrc || null;
  const releaseYear = optionalFiniteInteger(audio.release_year) ?? existing?.release_year ?? null;
  const trackNumber = optionalFiniteInteger(audio.track_number) ?? existing?.track_number ?? null;
  const discNumber = optionalFiniteInteger(audio.disc_number) ?? existing?.disc_number ?? null;
  const versionHint = optionalString(audio.version_hint) || existing?.version_hint || null;
  const source = optionalString(audio.source) || existing?.source || null;
  const canonicalQuery = [artist, title, album, versionHint && versionHint !== "studio" ? versionHint : null]
    .filter(Boolean)
    .join(" ")
    .trim() || input.query;
  const fingerprintMaterial = [isrc || "", title || input.query, artist || "", album || "", duration || "", versionHint || ""]
    .map(canonicalText)
    .join("|");

  return {
    version: 1,
    fingerprint: `sha256:${crypto.createHash("sha256").update(fingerprintMaterial).digest("hex")}`,
    title,
    artist,
    album,
    album_artist: albumArtist,
    duration_seconds: duration,
    isrc,
    release_year: releaseYear,
    track_number: trackNumber,
    disc_number: discNumber,
    version_hint: versionHint,
    source,
    canonical_query: canonicalQuery
  };
}

function playbackQueryForTrack(track: VirtualPlaylistTrack): string {
  return track.identity.canonical_query || optionalString(track.user_metadata?.query) || track.query;
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
  | "stale"
  | "ambiguous"
  | "manual"
  | "missing"
  | "error";

export type VirtualPlaylistResolutionResult = {
  track_id: string;
  query: string;
  status: VirtualPlaylistResolutionStatus;
  roon_item_key: string | null;
  score: number | null;
  reason: string;
};

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
  "version_hint",
  "source",
  "quality",
  "image_key",
  "cover"
]);

function resolutionConfidence(input: {
  status: VirtualPlaylistResolutionStatus;
  roonItemKey: string | null;
  score: number | null;
  resultConfidence?: unknown;
  candidates?: Record<string, unknown>[];
}): "high" | "medium" | "low" {
  if (input.status === "ambiguous" || !input.roonItemKey) {
    return input.score !== null && input.score >= 60 ? "medium" : "low";
  }
  if (input.resultConfidence === "low") return input.score !== null && input.score >= 85 ? "medium" : "low";
  const allCandidatesLow = Boolean(
    input.candidates?.length &&
    input.candidates.every((candidate) => candidate.confidence === "low")
  );
  if (allCandidatesLow) return input.score !== null && input.score >= 60 ? "medium" : "low";
  if (input.status === "manual") return input.resultConfidence === "high" ? "high" : "medium";
  if (input.score !== null && input.score >= 85) return "high";
  if (input.score !== null && input.score >= 60) return "medium";
  return "low";
}

function canonicalResolutionStatus(value: unknown, roonItemKey: string | null): VirtualPlaylistResolutionStatus {
  if (value === "resolved" || value === "manual" || value === "ambiguous" || value === "stale" || value === "missing" || value === "error") {
    return value;
  }
  if (value === "unresolved") return "missing";
  if (value === "failed") return "error";
  return roonItemKey ? "stale" : "missing";
}

function roonBinding(roonItemKey: string | null, resolution: ResolutionMetadata | null): RoonBinding {
  const storedBinding = objectValue(resolution?.binding);
  return {
    state: roonItemKey ? "stale" : "missing",
    item_key: roonItemKey,
    reusable: false,
    last_observed_at: roonItemKey
      ? optionalString(storedBinding?.observed_at) || optionalString(resolution?.resolved_at) || null
      : null
  };
}

function canonicalResolution(
  resolution: ResolutionMetadata | null,
  roonItemKey: string | null
): ResolutionMetadata {
  return {
    ...(resolution || {}),
    status: canonicalResolutionStatus(resolution?.status, roonItemKey),
    binding: {
      ...(objectValue(resolution?.binding) || {}),
      ...roonBinding(roonItemKey, resolution)
    },
    persistent_identity: "track_id",
    roon_item_key_persistent: false
  };
}

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

  const trackId = nonEmptyString(payload.track_id) || fallbackTrackId || `track-${randomSuffix()}`;
  const storedMetadata = buildStoredMetadata({
    metadata: objectValue(payload.metadata) || objectValue(payload.metadata_json),
    audio_metadata: (objectValue(payload.audio_metadata) || Object.keys(derivedAudio).length)
      ? { ...derivedAudio, ...(objectValue(payload.audio_metadata) || {}) }
      : null,
    user_metadata: objectValue(payload.user_metadata),
    identity: objectValue(payload.identity),
    resolution: objectValue(payload.resolution) || objectValue(payload.resolution_metadata)
  }) || {};
  const split = splitStoredMetadata(storedMetadata);
  storedMetadata.identity = identityFromTrack({
    query,
    title,
    artist,
    album: optionalString(payload.album),
    audioMetadata: split.audio_metadata,
    existing: split.identity
  });
  storedMetadata.resolution = canonicalResolution(
    split.resolution,
    optionalString(payload.roon_item_key)
  );

  return {
    track_id: trackId,
    query,
    roon_item_key: optionalString(payload.roon_item_key),
    title,
    artist,
    album: optionalString(payload.album),
    position: optionalFiniteInteger(payload.position) ?? fallbackPosition ?? null,
    metadata_json: serializeMetadata(storedMetadata),
    created_at: optionalString(payload.created_at) || fallbackCreatedAt || nowIso()
  };
}

export class PlaylistService {
  private readonly database: SqliteDatabase;
  private readonly coverDirectory: string;

  constructor(config: AppConfig, database?: SqliteDatabase) {
    this.database = database || createDatabase(config);
    this.coverDirectory = path.join(config.dataDir, "playlist-covers");
    this.backfillPersistentTrackIdentity();
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
        `SELECT playlist_id, name, description, cover_image_key, last_played_at, created_at, updated_at
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
      cover_image_key: row.cover_image_key,
      cover: buildCover(row.cover_image_key),
      track_count: trackCount,
      tracks_count: trackCount,
      include_tracks: includeTracks,
      limit,
      offset,
      returned_count: tracks?.length || 0,
      has_more: includeTracks ? offset + (tracks?.length || 0) < trackCount : false,
      last_played_at: row.last_played_at,
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
    cover_image_key?: unknown;
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
          `INSERT INTO virtual_playlists (playlist_id, name, description, cover_image_key, created_at, updated_at)
           VALUES (:playlist_id, :name, :description, :cover_image_key, :created_at, :updated_at)`
        )
        .run({
          playlist_id: playlistId,
          name,
          description: optionalString(input.description),
          cover_image_key: optionalString(input.cover_image_key),
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
      cover_image_key?: unknown;
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
    input: { name?: unknown; description?: unknown; cover_image_key?: unknown }
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
    const nextCoverImageKey = input.cover_image_key === undefined
      ? current.cover_image_key
      : optionalString(input.cover_image_key);

    this.database.db
      .prepare(
        `UPDATE virtual_playlists
         SET name = :name, description = :description, cover_image_key = :cover_image_key, updated_at = :updated_at
         WHERE playlist_id = :playlist_id`
      )
      .run({
        playlist_id: playlistId,
        name: nextName,
        description: nextDescription,
        cover_image_key: nextCoverImageKey,
        updated_at: nowIso()
      });

    return this.getPlaylistById(playlistId);
  }

  async setCustomCover(
    playlistId: string,
    input: { data_url?: unknown; image_base64?: unknown; content_type?: unknown }
  ): Promise<VirtualPlaylist> {
    const current = this.getPlaylistById(playlistId);
    const decoded = decodeCoverInput(input);
    const normalizedBytes = await normalizeCoverImage(decoded.bytes);
    fs.mkdirSync(this.coverDirectory, { recursive: true });
    const fileName = `${crypto.randomUUID()}.webp`;
    const finalPath = path.join(this.coverDirectory, fileName);
    const temporaryPath = `${finalPath}.tmp`;
    fs.writeFileSync(temporaryPath, normalizedBytes, { flag: "wx" });
    fs.renameSync(temporaryPath, finalPath);
    try {
      const updated = this.updatePlaylist(playlistId, {
        cover_image_key: `${CUSTOM_COVER_PREFIX}${fileName}`
      });
      this.removeCustomCoverFile(current.cover_image_key);
      return updated;
    } catch (error) {
      fs.rmSync(finalPath, { force: true });
      throw error;
    }
  }

  clearCustomCover(playlistId: string): VirtualPlaylist {
    const current = this.getPlaylistById(playlistId);
    const updated = this.updatePlaylist(playlistId, { cover_image_key: null });
    this.removeCustomCoverFile(current.cover_image_key);
    return updated;
  }

  getCustomCover(coverId: string): StoredPlaylistCover {
    const fileName = path.basename(coverId);
    if (!fileName || fileName !== coverId) {
      throw new ApiError("PLAYLIST_COVER_NOT_FOUND", "Playlist cover was not found");
    }
    const extension = path.extname(fileName).slice(1).toLowerCase();
    const contentType = extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "png"
        ? "image/png"
        : extension === "webp"
          ? "image/webp"
          : null;
    const filePath = path.join(this.coverDirectory, fileName);
    if (!contentType || !fs.existsSync(filePath)) {
      throw new ApiError("PLAYLIST_COVER_NOT_FOUND", "Playlist cover was not found", {
        cover_id: coverId
      });
    }
    return {
      cover_image_key: `${CUSTOM_COVER_PREFIX}${fileName}`,
      content_type: contentType,
      bytes: fs.readFileSync(filePath)
    };
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
    const existing = this.mapTrack(row);
    const incomingMetadata = splitStoredMetadata(objectValue(payload.metadata));
    const incomingAudio = {
      ...(incomingMetadata.audio_metadata || {}),
      ...(objectValue(payload.audio_metadata) || {})
    };
    const matchingFieldsChanged = ["query", "title", "artist", "album"].some(
      (field) => hasOwn(payload, field) && optionalString(payload[field]) !== optionalString((existing as any)[field])
    ) || ["title", "artist", "album", "album_artist", "duration_seconds", "isrc", "version_hint"].some(
      (field) => hasOwn(incomingAudio, field) && incomingAudio[field] !== existing.audio_metadata?.[field]
    ) || hasOwn(payload, "identity");
    const merged: Record<string, unknown> = {
      ...existing,
      ...payload,
      audio_metadata: {
        ...(existing.audio_metadata || {}),
        ...(incomingMetadata.audio_metadata || {}),
        ...(objectValue(payload.audio_metadata) || {})
      },
      user_metadata: {
        ...(existing.user_metadata || {}),
        ...(incomingMetadata.user_metadata || {}),
        ...(objectValue(payload.user_metadata) || {})
      },
      identity: hasOwn(payload, "identity") ? payload.identity : existing.identity,
      resolution: hasOwn(payload, "resolution") ? payload.resolution : existing.resolution
    };
    if (matchingFieldsChanged && !hasOwn(payload, "resolution")) {
      merged.roon_item_key = null;
      merged.resolution = {
        ...(existing.resolution || {}),
        status: "missing",
        reason: "identity_metadata_changed",
        selected_result_id: null,
        selected_roon_item_key: null,
        binding: roonBinding(null, null)
      };
    }
    const normalized = normalizeTrackInput(merged, row.track_id, row.position, row.created_at);
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
      const status = canonicalResolutionStatus(
        splitStoredMetadata(parseMetadata(track.metadata_json)).resolution?.status,
        track.roon_item_key
      );
      return options.force || (status !== "resolved" && status !== "manual");
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

  private removeCustomCoverFile(imageKey: string | null): void {
    const fileName = customCoverFileName(imageKey);
    if (!fileName) return;
    fs.rmSync(path.join(this.coverDirectory, fileName), { force: true });
  }

  deletePlaylist(playlistId: string): { ok: true; playlist_id: string } {
    const current = this.getPlaylistById(playlistId);
    const result = this.database.db
      .prepare("DELETE FROM virtual_playlists WHERE playlist_id = ?")
      .run(playlistId) as { changes?: number };

    if (!result?.changes) {
      throw new ApiError("PLAYLIST_NOT_FOUND", "Virtual playlist not found", {
        playlist_id: playlistId
      });
    }

    this.removeCustomCoverFile(current.cover_image_key);

    return { ok: true, playlist_id: playlistId };
  }

  validatePlaylist(playlistId: string): Record<string, unknown> {
    const playlist = this.getPlaylistById(playlistId);
    const issues: Record<string, unknown>[] = [];
    const titleArtist = new Map<string, VirtualPlaylistTrack[]>();
    const identities = new Map<string, VirtualPlaylistTrack[]>();
    const positions = new Map<number, VirtualPlaylistTrack[]>();

    for (const track of playlist.tracks) {
      const status = canonicalResolutionStatus(track.resolution?.status, track.roon_item_key);
      if (!track.query) {
        issues.push({ track_id: track.track_id, type: "missing_query", severity: "error", message: "Track has no query", suggested_actions: ["edit_track"] });
      }
      if (status === "missing" || status === "stale" || status === "error") {
        issues.push({
          track_id: track.track_id,
          type: status,
          severity: status === "error" ? "error" : "warning",
          message: status === "stale"
            ? "Legacy Roon reference must be reconstructed from the stored identity"
            : status === "error"
              ? "The last identity resolution failed"
              : "No confident Roon recording match has been stored",
          suggested_actions: ["resolve", "manual_select"]
        });
      }
      if (status === "ambiguous") {
        issues.push({ track_id: track.track_id, type: "ambiguous", severity: "warning", message: "Several close candidates were found", suggested_actions: ["manual_select"] });
      }
      if (!track.audio_metadata?.title || !track.audio_metadata?.artist) {
        issues.push({ track_id: track.track_id, type: "missing_metadata", severity: "info", message: "Audio metadata is incomplete", suggested_actions: ["resolve"] });
      }
      positions.set(track.position, [...(positions.get(track.position) || []), track]);
      const normalized = this.duplicateKey(track);
      if (normalized) titleArtist.set(normalized, [...(titleArtist.get(normalized) || []), track]);
      identities.set(track.identity.fingerprint, [...(identities.get(track.identity.fingerprint) || []), track]);
    }

    for (const [position, group] of positions.entries()) {
      if (group.length > 1) {
        for (const track of group) {
          issues.push({ track_id: track.track_id, type: "duplicate_position", severity: "error", message: `Position ${position} is duplicated`, suggested_actions: ["sort"] });
        }
      }
    }
    const duplicateSignatures = new Set<string>();
    for (const group of [...identities.values(), ...titleArtist.values()]) {
      if (group.length > 1) {
        const signature = group.map((track) => track.track_id).sort().join("|");
        if (duplicateSignatures.has(signature)) continue;
        duplicateSignatures.add(signature);
        issues.push({ track_id: group.map((track) => track.track_id), type: "duplicates", severity: "info", message: "Probable duplicate tracks", suggested_actions: ["deduplicate"] });
      }
    }

    const statusCount = (status: VirtualPlaylistResolutionStatus) =>
      playlist.tracks.filter((track) => canonicalResolutionStatus(track.resolution?.status, track.roon_item_key) === status).length;
    const resolved = statusCount("resolved");
    const manual = statusCount("manual");
    const summary = {
      ready: resolved + manual,
      resolved,
      manual,
      stale: statusCount("stale"),
      missing: statusCount("missing"),
      error: statusCount("error"),
      unresolved: playlist.tracks.length - resolved - manual,
      ambiguous: statusCount("ambiguous"),
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
      if (strategy.match_by_identity !== false) add(`identity:${track.identity.fingerprint}`, track);
      if (strategy.match_by_normalized_title_artist !== false) add(this.duplicateKey(track), track);
      if (strategy.match_by_roon_item_key === true) add(track.roon_item_key ? `legacy_roon_reference:${track.roon_item_key}` : null, track);
    }
    const seenGroups = new Set<string>();
    const duplicateGroups = [...groups.entries()]
      .map(([key, tracks]) => ({ key, tracks: tracks.filter((track, index, arr) => arr.findIndex((other) => other.track_id === track.track_id) === index) }))
      .filter((group) => group.tracks.length > 1)
      .filter((group) => {
        const signature = group.tracks.map((track) => track.track_id).sort().join("|");
        if (seenGroups.has(signature)) return false;
        seenGroups.add(signature);
        return true;
      })
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
      const headers = ["track_id", "identity_fingerprint", "position", "query", "title", "artist", "album", "resolution_status", "roon_binding_status", "last_roon_item_key", ...userKeys.map((key) => `user_metadata.${key}`)];
      const rows = playlist.tracks.map((track) => headers.map((header) => {
        const value = header.startsWith("user_metadata.")
          ? track.user_metadata?.[header.slice("user_metadata.".length)]
          : header === "identity_fingerprint"
            ? track.identity.fingerprint
          : header === "resolution_status"
            ? track.resolution?.status
            : header === "roon_binding_status"
              ? track.roon_binding.state
              : header === "last_roon_item_key"
                ? track.roon_item_key
            : (track as any)[header] ?? track.audio_metadata?.[header];
        return `"${String(value ?? "").replaceAll('"', '""')}"`;
      }).join(","));
      return [headers.join(","), ...rows].join("\n");
    }
    if (format === "m3u") {
      return ["#EXTM3U", ...playlist.tracks.map((track) => `#EXTINF:${track.audio_metadata?.duration_seconds ?? -1},${track.artist || track.audio_metadata?.artist || ""} - ${track.title || track.audio_metadata?.title || track.query}\n${track.identity.canonical_query}`)].join("\n");
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

  setTrackMatch(playlistId: string, trackId: string, resultId: string, input: {
    mediaService: RoonMediaService;
    selectionReason?: string;
    selectionOrigin?: "model" | "portal_user" | "unknown_explicit";
  }): VirtualPlaylist {
    const row = this.getTrackRowOrThrow(playlistId, trackId);
    const result = input.mediaService.get(resultId);
    this.updateTrackResolution(row, {
      status: "manual",
      query: row.query,
      roonItemKey: result.roon_item_key || null,
      score: result.match_score,
      reason: input.selectionReason || "manual_user_selection",
      result,
      selectionOrigin: input.selectionOrigin || "unknown_explicit"
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
      roon_item_key: result.roon_item_key || null,
      title: result.title,
      artist: result.artist || result.subtitle,
      album: result.album,
      position: input.position,
      audio_metadata: audioMetadataFromMedia(result),
      user_metadata: objectValue(input.user_metadata),
      resolution: {
        status: "manual",
        selected_result_id: result.result_id,
        selected_roon_item_key: result.roon_item_key || null,
        selected_candidate: mediaCandidateSnapshot(result as unknown as Record<string, unknown>),
        score: result.match_score,
        confidence: result.confidence,
        reason: "added_from_search_result",
        selection_origin: "portal_user",
        resolved_at: nowIso(),
        binding: {
          state: result.roon_item_key ? "stale" : "missing",
          item_key: result.roon_item_key || null,
          reusable: false
        },
        persistent_identity: "track_id",
        roon_item_key_persistent: false
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
    input: { zone_id?: unknown; mode?: unknown; limit?: unknown; session_key?: unknown },
    runtime: PlaylistPlaybackRuntime = {}
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
      const firstStarted = await this.applyTrack(
        roonClient,
        playlistId,
        zoneId,
        tracks[0],
        "play_now",
        `${sessionPrefix}-0`,
        results,
        failures,
        runtime
      );

      if (firstStarted) {
        for (const [index, track] of tracks.slice(1).entries()) {
          await this.applyTrack(
            roonClient,
            playlistId,
            zoneId,
            track,
            "add_to_queue",
            `${sessionPrefix}-${index + 1}`,
            results,
            failures,
            runtime
          );
        }
        playback = await controlPlayback(roonClient, zoneId, "play");
      } else {
        for (const track of tracks.slice(1)) {
          failures.push({
            track_id: track.track_id,
            identity: track.identity,
            skipped: true,
            error: {
              code: "PLAYLIST_START_ABORTED",
              message: "The first track could not be reconstructed; the existing queue was left unchanged"
            }
          });
        }
      }
    } else {
      const orderedTracks = mode === "add_next" ? tracks.slice().reverse() : tracks;
      for (const [index, track] of orderedTracks.entries()) {
        await this.applyTrack(
          roonClient,
          playlistId,
          zoneId,
          track,
          mode,
          `${sessionPrefix}-${index}`,
          results,
          failures,
          runtime
        );
      }
    }

    const lastPlayedAt = mode === "play_now" && results.length > 0
      ? this.markPlaylistPlayed(playlistId)
      : playlist.last_played_at;

    return {
      ok: failures.length === 0,
      playlist_id: playlist.playlist_id,
      last_played_at: lastPlayedAt,
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

  async playPlaylistTrack(
    roonClient: RoonClient,
    playlistId: string,
    trackId: string,
    input: { zone_id?: unknown; mode?: unknown; session_key?: unknown },
    runtime: PlaylistPlaybackRuntime = {}
  ): Promise<Record<string, unknown>> {
    const playlist = this.getPlaylistById(playlistId);
    const track = playlist.tracks.find((candidate) => candidate.track_id === trackId);
    if (!track) {
      throw new ApiError("PLAYLIST_TRACK_NOT_FOUND", "Virtual playlist track not found", {
        playlist_id: playlistId,
        track_id: trackId
      });
    }
    const zoneId = nonEmptyString(input.zone_id);
    if (!zoneId) throw new ApiError("ZONE_NOT_FOUND", "zone_id is required");
    const mode = this.parsePlayMode(input.mode);
    const results: Record<string, unknown>[] = [];
    const failures: Record<string, unknown>[] = [];
    const succeeded = await this.applyTrack(
      roonClient,
      playlistId,
      zoneId,
      track,
      mode,
      nonEmptyString(input.session_key) || `roon-ai-bridge-playlist-track-${track.track_id}-${Date.now().toString(36)}`,
      results,
      failures,
      runtime
    );
    const playback = succeeded && mode === "play_now"
      ? await controlPlayback(roonClient, zoneId, "play")
      : null;
    return {
      ok: succeeded,
      playlist_id: playlistId,
      track_id: trackId,
      zone_id: zoneId,
      mode,
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
        `SELECT playlist_id, name, description, cover_image_key, last_played_at, created_at, updated_at
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
      cover_image_key: row.cover_image_key,
      cover: buildCover(row.cover_image_key),
      tracks,
      track_count: trackCount,
      tracks_count: trackCount,
      last_played_at: row.last_played_at,
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
      cover_image_key: row.cover_image_key,
      cover: buildCover(row.cover_image_key),
      track_count: trackCount,
      tracks_count: trackCount,
      last_played_at: row.last_played_at,
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

  private backfillPersistentTrackIdentity(): void {
    const rows = this.database.db
      .prepare(
        `SELECT track_id, playlist_id, query, roon_item_key, title, artist, album, position, metadata_json, created_at
         FROM virtual_playlist_tracks`
      )
      .all() as TrackRow[];
    const update = this.database.db.prepare(
      `UPDATE virtual_playlist_tracks
       SET metadata_json = :metadata_json
       WHERE playlist_id = :playlist_id AND track_id = :track_id`
    );

    this.database.transaction(() => {
      for (const row of rows) {
        const metadata = parseMetadata(row.metadata_json) || {};
        const split = splitStoredMetadata(metadata);
        const rawStatus = split.resolution?.status;
        const needsBackfill =
          !split.identity ||
          split.identity.version !== 1 ||
          !optionalString(split.identity.fingerprint) ||
          rawStatus === "unresolved" ||
          rawStatus === "failed" ||
          !objectValue(split.resolution?.binding) ||
          split.resolution?.roon_item_key_persistent !== false;
        if (!needsBackfill) continue;
        const identity = identityFromTrack({
          query: row.query,
          title: row.title,
          artist: row.artist,
          album: row.album,
          audioMetadata: split.audio_metadata,
          existing: split.identity
        });
        update.run({
          playlist_id: row.playlist_id,
          track_id: row.track_id,
          metadata_json: JSON.stringify({
            ...(split.audio_metadata ? { audio_metadata: split.audio_metadata } : {}),
            ...(split.user_metadata ? { user_metadata: split.user_metadata } : {}),
            identity,
            resolution: canonicalResolution(split.resolution, row.roon_item_key)
          })
        });
      }
    });
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
    const identity = identityFromTrack({
      query: row.query,
      title: row.title,
      artist: row.artist,
      album: row.album,
      audioMetadata: split.audio_metadata,
      existing: split.identity
    });
    const resolution = canonicalResolution(split.resolution, row.roon_item_key);

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
      identity,
      resolution,
      roon_binding: roonBinding(row.roon_item_key, resolution),
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
    const storedTrack = this.mapTrack(row);
    const query = row.query || playbackQueryForTrack(storedTrack);
    logger?.info("Virtual playlist entry resolution started", {
      playlistId: row.playlist_id,
      trackId: row.track_id,
      query,
      title: row.title,
      artist: row.artist
    });

    try {
      const match = await new TrackResolutionService(options.mediaService).resolve({
        query,
        title: row.title,
        artist: row.artist,
        album: row.album,
        versionHint: storedTrack.identity.version_hint as VersionHint | null,
        count: 25,
        sourcePreference: options.sourcePreference || "streaming_first"
      });
      logger?.info("Virtual playlist entry search completed", {
        playlistId: row.playlist_id,
        trackId: row.track_id,
        query,
        status: match.status,
        reason: match.reason,
        queries: match.queries,
        results: match.candidates.length
      });

      const best = match.selected || match.candidates[0];
      if (!best) {
        const unresolved = this.updateTrackResolution(row, {
          status: "missing",
          query,
          roonItemKey: null,
          score: null,
          reason: match.reason,
          selectionOrigin: "automatic"
        });
        logger?.warn("Virtual playlist entry unresolved", unresolved);
        return unresolved;
      }

      const roonItemKey = best.result.roon_item_key || null;
      const accepted = match.status === "resolved";
      const status: VirtualPlaylistResolutionStatus = match.status;
      const stored = this.updateTrackResolution(row, {
        status,
        query,
        roonItemKey: accepted ? roonItemKey : null,
        score: best.identity_score,
        reason: match.reason,
        result: best.result,
        candidates: match.candidates.map((candidate) => candidate.result),
        selectionOrigin: "automatic"
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
        status: "error",
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
      selectionOrigin?: "automatic" | "model" | "portal_user" | "unknown_explicit";
    }
  ): VirtualPlaylistResolutionResult {
    const metadata = parseMetadata(row.metadata_json) || {};
    const split = splitStoredMetadata(metadata);
    const accepted = resolution.status === "resolved" || resolution.status === "manual";
    const audioMetadata = accepted && resolution.result
      ? { ...(split.audio_metadata || {}), ...audioMetadataFromMedia(resolution.result as MediaResult) }
      : split.audio_metadata;
    const identity = identityFromTrack({
      query: row.query,
      title: accepted ? resolution.result?.title : row.title,
      artist: accepted ? resolution.result?.artist || resolution.result?.subtitle : row.artist,
      album: accepted ? resolution.result?.album : row.album,
      audioMetadata,
      existing: split.identity
    });
    const resolvedAt = nowIso();
    const nextMetadata: Record<string, unknown> = {
      ...(split.user_metadata ? { user_metadata: split.user_metadata } : {}),
      ...(audioMetadata ? { audio_metadata: audioMetadata } : {}),
      identity,
      resolution: {
        status: resolution.status,
        query: resolution.query,
        selected_result_id: resolution.result?.result_id || null,
        selected_roon_item_key: resolution.roonItemKey,
        selected_candidate: accepted && resolution.result
          ? mediaCandidateSnapshot(resolution.result)
          : null,
        score: resolution.score,
        confidence: resolutionConfidence({
          status: resolution.status,
          roonItemKey: resolution.roonItemKey,
          score: resolution.score,
          resultConfidence: resolution.result?.confidence,
          candidates: resolution.candidates
        }),
        reason: resolution.reason,
        selection_origin: resolution.selectionOrigin || (resolution.status === "manual" ? "unknown_explicit" : "automatic"),
        resolved_at: resolvedAt,
        candidates: resolution.candidates?.map(mediaCandidateSnapshot) || [],
        binding: {
          state: resolution.roonItemKey ? "stale" : "missing",
          item_key: resolution.roonItemKey,
          reusable: false,
          observed_at: resolution.roonItemKey ? resolvedAt : null
        },
        persistent_identity: "track_id",
        roon_item_key_persistent: false
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
             title = :title,
             artist = :artist,
             album = :album,
             metadata_json = :metadata_json
         WHERE playlist_id = :playlist_id AND track_id = :track_id`
      )
      .run({
        playlist_id: row.playlist_id,
        track_id: row.track_id,
        roon_item_key: resolution.roonItemKey,
        title: identity.title,
        artist: identity.artist,
        album: identity.album,
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

  private markPlaylistPlayed(playlistId: string): string {
    const lastPlayedAt = nowIso();
    this.database.db
      .prepare("UPDATE virtual_playlists SET last_played_at = ? WHERE playlist_id = ?")
      .run(lastPlayedAt, playlistId);
    return lastPlayedAt;
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

  private async resolvePlaybackCandidate(
    track: VirtualPlaylistTrack,
    mediaService: RoonMediaService,
    sourcePreference: SourcePreference = "streaming_first"
  ): Promise<{ result: MediaResult; score: number }> {
    const query = playbackQueryForTrack(track);
    const match = await new TrackResolutionService(mediaService).resolve({
      query,
      title: track.identity.title,
      artist: track.identity.artist,
      album: track.identity.album,
      versionHint: track.identity.version_hint as VersionHint | null,
      count: 25,
      sourcePreference: sourcePreference || "streaming_first"
    });
    if (match.status === "ambiguous") {
      throw new ApiError(
        "PLAYLIST_TRACK_AMBIGUOUS",
        "Several Roon recordings match the stored identity too closely",
        {
          track_id: track.track_id,
          identity_fingerprint: track.identity.fingerprint,
          query,
          candidates: match.candidates.map((candidate) => ({
            ...mediaCandidateSnapshot(candidate.result as unknown as Record<string, unknown>),
            identity_score: candidate.identity_score
          }))
        }
      );
    }
    const best = match.selected;
    if (match.status === "missing" || !best) {
      throw new ApiError("SEARCH_NO_RESULTS", "The stored track identity could not be found in Roon", {
        track_id: track.track_id,
        identity_fingerprint: track.identity.fingerprint,
        query,
        reason: match.reason,
        candidates: match.candidates.map((candidate) => ({
          ...mediaCandidateSnapshot(candidate.result as unknown as Record<string, unknown>),
          identity_score: candidate.identity_score
        }))
      });
    }
    return { result: best.result, score: best.identity_score };
  }

  private async applyTrack(
    roonClient: RoonClient,
    playlistId: string,
    zoneId: string,
    track: VirtualPlaylistTrack,
    mode: PlaylistPlayMode,
    sessionKey: string,
    results: Record<string, unknown>[],
    failures: Record<string, unknown>[],
    runtime: PlaylistPlaybackRuntime
  ): Promise<boolean> {
    try {
      let result: Record<string, unknown>;
      let candidate: Record<string, unknown> | null = null;
      let resolvedCandidate: { result: MediaResult; score: number } | null = null;
      if (runtime.mediaService) {
        resolvedCandidate = await this.resolvePlaybackCandidate(
          track,
          runtime.mediaService,
          runtime.sourcePreference
        );
        candidate = {
          ...mediaCandidateSnapshot(resolvedCandidate.result as unknown as Record<string, unknown>),
          score: resolvedCandidate.score
        };
        result = await runtime.mediaService.play(
          resolvedCandidate.result.result_id,
          zoneId,
          mode === "play_now" ? "replace_queue" : mode === "add_next" ? "play_next" : "append"
        );
        if (result.ok === false) {
          throw new ApiError(
            mode === "play_now" ? "PLAYBACK_ACTION_NOT_FOUND" : "QUEUE_ACTION_NOT_FOUND",
            "Roon rejected the action for the freshly reconstructed recording",
            { track_id: track.track_id, mode, result }
          );
        }
      } else if (mode === "play_now") {
        result = await playByQuery(roonClient, {
          zoneId,
          query: playbackQueryForTrack(track),
          sessionKey
        });
      } else {
        result = await queueByQuery(roonClient, {
          zoneId,
          query: playbackQueryForTrack(track),
          mode,
          sessionKey
        });
      }
      runtime.logger?.info("Virtual playlist track reconstructed for playback", {
        trackId: track.track_id,
        identityFingerprint: track.identity.fingerprint,
        mode,
        candidate
      });
      if (resolvedCandidate) {
        const row = this.getTrackRowOrThrow(playlistId, track.track_id);
        this.updateTrackResolution(row, {
          status: track.resolution?.status === "manual" ? "manual" : "resolved",
          query: track.query,
          roonItemKey: resolvedCandidate.result.roon_item_key,
          score: resolvedCandidate.score,
          reason: "reconstructed_for_playback",
          result: resolvedCandidate.result as unknown as Record<string, unknown>
        });
        this.touchPlaylist(playlistId);
      }
      results.push({
        track_id: track.track_id,
        identity: track.identity,
        reconstructed: true,
        cached_roon_item_key_used: false,
        candidate,
        result
      });
      return true;
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === "PLAYLIST_TRACK_AMBIGUOUS" ||
          error.code === "PLAYLIST_TRACK_NOT_CONFIDENT" ||
          error.code === "SEARCH_NO_RESULTS")
      ) {
        const row = this.getTrackRowOrThrow(playlistId, track.track_id);
        this.updateTrackResolution(row, {
          status: error.code === "PLAYLIST_TRACK_AMBIGUOUS" ? "ambiguous" : "missing",
          query: track.query,
          roonItemKey: null,
          score: typeof error.details.best_score === "number" ? error.details.best_score : null,
          reason: error.message
        });
        this.touchPlaylist(playlistId);
      }
      if (error instanceof ApiError) {
        failures.push({
          track_id: track.track_id,
          identity: track.identity,
          error: {
            code: error.code,
            message: error.message,
            details: error.details
          }
        });
        return false;
      }

      failures.push({
        track_id: track.track_id,
        identity: track.identity,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error)
        }
      });
      return false;
    }
  }
}
