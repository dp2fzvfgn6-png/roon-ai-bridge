import type { MediaResult } from "../../roon/media/mediaContracts";
import type { AudioMetadata } from "./playlistContracts";

export const CORE_AUDIO_METADATA_FIELDS = [
  "title",
  "artist",
  "album",
  "duration_seconds"
] as const;

export type CoreAudioMetadataField = typeof CORE_AUDIO_METADATA_FIELDS[number];

export type MetadataCompleteness = {
  complete: boolean;
  present_fields: string[];
  missing_fields: CoreAudioMetadataField[];
};

export type PlaylistMetadataStatus = "exact" | "partial" | "conflict" | "unverified";

const ENRICHED_CATALOG_FIELDS = new Set([
  "album",
  "album_artist",
  "composer",
  "composers",
  "lyricists",
  "genre",
  "genres",
  "release_year",
  "original_release_year",
  "track_number",
  "disc_number",
  "duration_seconds",
  "isrc",
  "isrcs",
  "source",
  "source_confidence",
  "quality",
  "recording",
  "release",
  "field_provenance",
  "metadata_status"
]);

function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return true;
}

/** Keep only observed values so a sparse Roon response cannot erase stored metadata. */
export function compactMetadata(values: Record<string, unknown>): AudioMetadata {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => present(value)));
}

export function audioMetadataFromMedia(
  result: Partial<MediaResult> & Record<string, unknown>
): AudioMetadata {
  const imageKey = typeof result.image_key === "string" ? result.image_key.trim() : "";
  return compactMetadata({
    title: result.title,
    artist: result.artist || result.subtitle,
    album: result.album,
    album_artist: result.album_artist,
    composer: result.composer,
    genre: result.genre,
    release_year: result.release_year,
    track_number: result.track_number,
    disc_number: result.disc_number,
    duration_seconds: result.duration_seconds,
    isrc: result.isrc,
    version_hint: result.version_hint,
    source: result.source,
    source_confidence: result.source_confidence,
    quality: result.quality,
    image_key: imageKey || null,
    cover: imageKey ? { image_key: imageKey } : null
  });
}

/**
 * Catalog enrichment is a replaceable observation, not part of the selected
 * recording identity. Remove a previous observation before applying a fresh
 * one so a failed or conflicting refresh cannot leave an album or duration
 * from another edition behind.
 */
export function replaceCatalogAudioMetadata(
  existing: AudioMetadata | null | undefined,
  observed: AudioMetadata | null | undefined
): AudioMetadata | null {
  const retained = Object.fromEntries(
    Object.entries(existing || {}).filter(([field]) => !ENRICHED_CATALOG_FIELDS.has(field))
  );
  const merged = {
    ...retained,
    ...compactMetadata(observed || {})
  };
  return Object.keys(merged).length ? merged : null;
}

export function mergeAudioMetadata(
  existing: AudioMetadata | null | undefined,
  observed: AudioMetadata | null | undefined
): AudioMetadata | null {
  const merged = {
    ...(existing || {}),
    ...compactMetadata(observed || {})
  };
  return Object.keys(merged).length ? merged : null;
}

export function metadataCompleteness(metadata: AudioMetadata | null | undefined): MetadataCompleteness {
  const values = metadata || {};
  const missing = CORE_AUDIO_METADATA_FIELDS.filter((field) => !present(values[field]));
  return {
    complete: missing.length === 0,
    present_fields: Object.keys(values).filter((field) => present(values[field])),
    missing_fields: missing
  };
}

export function mergeMediaResult(base: MediaResult, observed?: Partial<MediaResult> | null): MediaResult {
  if (!observed) return base;
  return {
    ...base,
    ...compactMetadata(observed as Record<string, unknown>),
    links: {
      artist: observed.links?.artist || base.links.artist,
      artists: observed.links?.artists?.length ? observed.links.artists : base.links.artists,
      album: observed.links?.album || base.links.album
    }
  } as MediaResult;
}
