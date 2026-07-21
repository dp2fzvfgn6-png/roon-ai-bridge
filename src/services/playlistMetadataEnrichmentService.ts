import { splitArtistCredit, type MediaResult, type RoonMediaService, type SourcePreference, type VersionHint } from "../roon/roonMediaService";
import type { Logger } from "../utils/logger";
import { ApiError } from "../utils/errors";
import type { AudioMetadata, VirtualPlaylistTrack } from "./playlists/playlistContracts";
import {
  audioMetadataFromMedia,
  mergeAudioMetadata,
  mergeMediaResult,
  metadataCompleteness,
  type MetadataCompleteness
} from "./playlists/playlistMetadataPolicy";
import { PlaylistService, type VirtualPlaylistResolutionStatus } from "./playlistService";
import { RecordingMetadataService } from "./recordingMetadataService";
import { TrackResolutionService } from "./trackResolutionService";

export type MetadataEnrichmentReport = {
  status: "completed" | "partial" | "skipped" | "failed";
  observed_at: string;
  source_result_id: string | null;
  album_result_id: string | null;
  completeness: MetadataCompleteness;
  warnings: string[];
};

export type EnrichedMediaResult = {
  result: MediaResult;
  audio_metadata: AudioMetadata;
  report: MetadataEnrichmentReport;
};

export type PlaylistMetadataRefreshResult = {
  playlist_id: string;
  attempted: number;
  completed: number;
  partial: number;
  skipped: number;
  failed: number;
  tracks: Array<{ track_id: string; report: MetadataEnrichmentReport }>;
  playlist: ReturnType<PlaylistService["getPlaylist"]>;
};

function normalize(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameText(left: unknown, right: unknown): boolean {
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && a === b);
}

function canonicalTrackTitle(value: unknown): string {
  return normalize(value)
    .replace(/\b(?:lp|album|single) version\b.*$/g, "")
    .replace(/\b(?:live|en vivo|directo|remaster(?:ed)?|remix|mix|radio edit|edit|cover|tribute|demo|alternate take|version|binaural|3d)\b.*$/g, "")
    .trim();
}

function sameRecordingTitle(left: unknown, right: unknown): boolean {
  const a = canonicalTrackTitle(left);
  const b = canonicalTrackTitle(right);
  return Boolean(a && b && a === b);
}

function safeMetadataVariant(candidate: MediaResult, source: MediaResult): boolean {
  if (source.version_hint && !["studio", "remaster", "unknown"].includes(source.version_hint)) {
    return candidate.version_hint === source.version_hint;
  }
  return !/\b(?:live|en vivo|directo|remix|cover|tribute|demo|alternate take|atmos|binaural|3d)\b/i.test(candidate.title);
}

function artistMatches(track: { artist?: unknown; subtitle?: unknown }, artist: unknown): boolean {
  const expected = normalize(artist);
  if (!expected) return true;
  const actual = normalize(track.artist || track.subtitle);
  return Boolean(actual && (actual.includes(expected) || expected.includes(actual)));
}

function resolutionStatus(track: VirtualPlaylistTrack): VirtualPlaylistResolutionStatus {
  const status = track.resolution?.status;
  return ["resolved", "stale", "ambiguous", "manual", "missing", "error"].includes(String(status))
    ? status as VirtualPlaylistResolutionStatus
    : track.roon_item_key ? "stale" : "missing";
}

export class PlaylistMetadataEnrichmentService {
  private readonly activeTrackRefreshes = new Map<string, Promise<{ track: VirtualPlaylistTrack; report: MetadataEnrichmentReport }>>();
  private readonly artistReleaseCache = new Map<string, { expiresAt: number; promise: Promise<MediaResult[]> }>();

  constructor(
    private readonly playlistService: PlaylistService,
    private readonly mediaService: RoonMediaService,
    private readonly logger?: Logger,
    private readonly sourcePreference: SourcePreference = "streaming_first",
    private readonly recordingMetadataService?: RecordingMetadataService
  ) {}

  async enrichResult(
    source: MediaResult,
    hints: { title?: string | null; artist?: string | null; album?: string | null } = {}
  ): Promise<EnrichedMediaResult> {
    const warnings: string[] = [];
    let result = source;
    if ((!source.album || !source.duration_seconds) && typeof this.mediaService.getTrackMetadata === "function") {
      try {
        result = mergeMediaResult(result, await this.mediaService.getTrackMetadata(source.result_id));
      } catch (error) {
        warnings.push(`track_detail_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    let albumResultId = result.links?.album?.result_id || null;
    const albumTitle = result.album || hints.album || null;

    if (!albumResultId && albumTitle && !metadataCompleteness(
      audioMetadataFromMedia(result as MediaResult & Record<string, unknown>)
    ).complete) {
      try {
        const search = await this.mediaService.search({
          query: [albumTitle, source.album_artist || source.artist || hints.artist].filter(Boolean).join(" "),
          types: ["album"],
          count: 10,
          sourcePreference: this.sourcePreference
        });
        const exact = search.results.find((candidate) =>
          candidate.media_type === "album" &&
          sameText(candidate.title, albumTitle) &&
          artistMatches(candidate, source.album_artist || source.artist || hints.artist)
        );
        albumResultId = exact?.result_id || null;
        if (!albumResultId) warnings.push("album_search_no_exact_match");
      } catch (error) {
        warnings.push(`album_search_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (albumResultId) {
      try {
        const detail = await this.mediaService.getAlbumDetail(albumResultId, undefined, 500);
        const candidates = [...(detail.tracks || []), ...(detail.related_tracks || [])];
        const matchedTrack = candidates.find((candidate) =>
          sameText(candidate.title, source.title || hints.title) &&
          artistMatches(candidate, source.artist || hints.artist)
        ) || null;
        result = mergeMediaResult(result, matchedTrack);
        result = mergeMediaResult(result, {
          album: result.album || detail.album.title,
          album_artist: result.album_artist || detail.album.album_artist || detail.album.artist,
          release_year: result.release_year || detail.album.release_year,
          image_key: result.image_key || detail.album.image_key
        });
        warnings.push(...detail.warnings);
        if (!matchedTrack) warnings.push("album_track_not_found");
      } catch (error) {
        warnings.push(`album_detail_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    let catalogArtist: string | null = null;
    if (!result.album) {
      try {
        const catalog = await this.enrichFromArtistCatalog(result, hints);
        if (catalog) {
          result = mergeMediaResult(result, catalog.metadata);
          albumResultId = albumResultId || catalog.album_result_id;
          catalogArtist = catalog.artist;
          warnings.push(...catalog.warnings);
        }
      } catch (error) {
        warnings.push(`artist_catalog_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (this.recordingMetadataService && !metadataCompleteness(
      audioMetadataFromMedia(result as MediaResult & Record<string, unknown>)
    ).complete) {
      const artist = catalogArtist || result.artists?.[0]?.title || splitArtistCredit(hints.artist || result.artist)[0] || null;
      const title = result.title || hints.title || null;
      if (title && artist) {
        try {
          const external = await this.recordingMetadataService.lookup({
            title,
            artist,
            album: result.album || hints.album || null
          });
          if (external) {
            const existingIsrc = (result as MediaResult & { isrc?: string | null }).isrc;
            result = mergeMediaResult(result, {
              album: result.album || external.album,
              duration_seconds: result.duration_seconds || external.duration_seconds,
              release_year: result.release_year || external.release_year,
              isrc: existingIsrc || external.isrc
            } as Partial<MediaResult> & { isrc?: string | null });
            warnings.push(`musicbrainz_metadata:${external.confidence}`);
          } else {
            warnings.push("musicbrainz_recording_not_found");
          }
        } catch (error) {
          warnings.push(`musicbrainz_failed:${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    if (!result.album) warnings.push("album_reference_unavailable");

    const audioMetadata = audioMetadataFromMedia(result as MediaResult & Record<string, unknown>);
    const completeness = metadataCompleteness(audioMetadata);
    return {
      result,
      audio_metadata: audioMetadata,
      report: {
        status: completeness.complete ? "completed" : "partial",
        observed_at: new Date().toISOString(),
        source_result_id: source.result_id || null,
        album_result_id: albumResultId,
        completeness,
        warnings: Array.from(new Set(warnings))
      }
    };
  }

  private async enrichFromArtistCatalog(
    source: MediaResult,
    hints: { title?: string | null; artist?: string | null; album?: string | null }
  ): Promise<{
    artist: string;
    album_result_id: string;
    metadata: Partial<MediaResult> & { isrc?: string | null };
    warnings: string[];
  } | null> {
    const title = source.title || hints.title;
    if (!title) return null;
    const artistHints = Array.from(new Map([
      ...(source.artists || []).map((artist) => artist.title),
      ...splitArtistCredit(hints.artist || source.artist)
    ].filter(Boolean).map((artist) => [normalize(artist), artist])).values()).slice(0, 5);

    for (const artistHint of artistHints) {
      const [trackSearch, artistSearch] = await Promise.all([
        this.mediaService.search({
          query: [title, artistHint].filter(Boolean).join(" "),
          types: ["track"],
          count: 25,
          sourcePreference: this.sourcePreference
        }),
        this.mediaService.search({
          query: artistHint,
          types: ["artist"],
          count: 10,
          sourcePreference: this.sourcePreference
        })
      ]);
      const artist = artistSearch.results.find((candidate) =>
        candidate.media_type === "artist" && sameText(candidate.title, artistHint)
      );
      if (!artist) continue;
      const releases = await this.loadArtistReleases(artist.result_id, artistHint);
      const coverKeys = new Set([
        source.image_key,
        ...trackSearch.results.filter((candidate) =>
          candidate.media_type === "track" &&
          sameRecordingTitle(candidate.title, title) &&
          safeMetadataVariant(candidate, source)
        ).map((candidate) => candidate.image_key)
      ].filter((value): value is string => Boolean(value)));
      const release = releases.find((candidate) => candidate.image_key && coverKeys.has(candidate.image_key));
      if (!release) continue;
      const detail = await this.mediaService.getAlbumDetail(release.result_id, undefined, 500);
      const matchedTrack = [...(detail.tracks || []), ...(detail.related_tracks || [])].find((candidate) =>
        sameRecordingTitle(candidate.title, title) &&
        artistMatches(candidate, artistHint)
      ) || null;
      const matchedIsrc = (matchedTrack as (MediaResult & { isrc?: string | null }) | null)?.isrc;
      const sourceIsrc = (source as MediaResult & { isrc?: string | null }).isrc;
      return {
        artist: artistHint,
        album_result_id: release.result_id,
        metadata: {
          album: detail.album.title || release.title,
          album_artist: detail.album.album_artist || detail.album.artist || release.artist || artistHint,
          duration_seconds: matchedTrack?.duration_seconds || source.duration_seconds,
          release_year: matchedTrack?.release_year || detail.album.release_year || release.release_year,
          track_number: matchedTrack?.track_number || source.track_number,
          disc_number: matchedTrack?.disc_number || source.disc_number,
          isrc: matchedIsrc || sourceIsrc,
          image_key: source.image_key || matchedTrack?.image_key || detail.album.image_key || release.image_key
        },
        warnings: detail.warnings
      };
    }
    return null;
  }

  private async loadArtistReleases(resultId: string, artist: string): Promise<MediaResult[]> {
    const key = normalize(artist);
    const cached = this.artistReleaseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    const pending = this.mediaService.listArtistReleases(resultId, undefined, 200)
      .then((result) => result.releases);
    const entry = { expiresAt: Date.now() + 10 * 60 * 1000, promise: pending };
    this.artistReleaseCache.set(key, entry);
    try {
      return await pending;
    } catch (error) {
      if (this.artistReleaseCache.get(key) === entry) this.artistReleaseCache.delete(key);
      throw error;
    }
  }

  async refreshTrack(
    playlistId: string,
    trackId: string,
    options: { result?: MediaResult; sourcePreference?: SourcePreference } = {}
  ): Promise<{ track: VirtualPlaylistTrack; report: MetadataEnrichmentReport }> {
    const refreshKey = `${playlistId}:${trackId}`;
    const active = this.activeTrackRefreshes.get(refreshKey);
    if (active) return active;
    const pending = this.refreshTrackOnce(playlistId, trackId, options);
    this.activeTrackRefreshes.set(refreshKey, pending);
    try {
      return await pending;
    } finally {
      if (this.activeTrackRefreshes.get(refreshKey) === pending) this.activeTrackRefreshes.delete(refreshKey);
    }
  }

  private async refreshTrackOnce(
    playlistId: string,
    trackId: string,
    options: { result?: MediaResult; sourcePreference?: SourcePreference } = {}
  ): Promise<{ track: VirtualPlaylistTrack; report: MetadataEnrichmentReport }> {
    const playlist = this.playlistService.getPlaylist(playlistId);
    const track = playlist.tracks.find((candidate) => candidate.track_id === trackId);
    if (!track) throw new ApiError("PLAYLIST_TRACK_NOT_FOUND", "Virtual playlist track not found", {
      playlist_id: playlistId,
      track_id: trackId
    });

    let result = options.result || null;
    if (!result) {
      const status = resolutionStatus(track);
      if (status !== "resolved" && status !== "manual" && status !== "stale") {
        const report = this.skippedReport("identity_resolution_required", track.audio_metadata);
        return { track, report };
      }
      const resolution = await new TrackResolutionService(this.mediaService).resolve({
        query: track.query || track.identity.canonical_query,
        title: track.identity.title || track.title,
        artist: track.identity.artist || track.artist,
        album: track.identity.album || track.album,
        releaseYear: track.identity.release_year,
        versionHint: track.identity.version_hint as VersionHint | null,
        count: 25,
        includeExactQuery: false,
        sourcePreference: options.sourcePreference || this.sourcePreference
      });
      const storedImageKey = track.image_key || (typeof track.audio_metadata?.image_key === "string"
        ? track.audio_metadata.image_key
        : null);
      const recovered = resolution.candidates.find((candidate) =>
        Boolean(storedImageKey && candidate.result.image_key === storedImageKey) &&
        sameRecordingTitle(candidate.result.title, track.identity.title || track.title)
      ) || resolution.candidates.find((candidate) =>
        sameRecordingTitle(candidate.result.title, track.identity.title || track.title) &&
        artistMatches(candidate.result, track.identity.artist || track.artist) &&
        safeMetadataVariant(candidate.result, candidate.result)
      );
      result = resolution.status === "resolved"
        ? resolution.selected?.result || null
        : recovered?.result || null;
      if (!result) {
        const report = this.skippedReport(`identity_${resolution.status}:${resolution.reason}`, track.audio_metadata);
        return { track, report };
      }
    }

    try {
      const enriched = await this.enrichResult(result, {
        title: track.identity.title || track.title,
        artist: track.identity.artist || track.artist,
        album: track.identity.album || track.album
      });
      const merged = mergeAudioMetadata(track.audio_metadata, enriched.audio_metadata) || {};
      const completeness = metadataCompleteness(merged);
      const report = {
        ...enriched.report,
        status: completeness.complete ? "completed" as const : "partial" as const,
        completeness
      };
      const updated = this.playlistService.updateTrackAudioMetadata(playlistId, trackId, merged, report);
      this.logger?.info("Playlist track metadata refreshed", {
        playlistId,
        trackId,
        status: report.status,
        missingFields: completeness.missing_fields
      });
      return { track: updated, report };
    } catch (error) {
      const report: MetadataEnrichmentReport = {
        status: "failed",
        observed_at: new Date().toISOString(),
        source_result_id: result.result_id || null,
        album_result_id: null,
        completeness: metadataCompleteness(track.audio_metadata),
        warnings: [error instanceof Error ? error.message : String(error)]
      };
      this.logger?.warn("Playlist track metadata refresh failed", { playlistId, trackId, error: report.warnings[0] });
      return { track, report };
    }
  }

  async refreshPlaylist(
    playlistId: string,
    options: { trackIds?: string[]; force?: boolean; sourcePreference?: SourcePreference } = {}
  ): Promise<PlaylistMetadataRefreshResult> {
    const playlist = this.playlistService.getPlaylist(playlistId);
    const selected = options.trackIds ? new Set(options.trackIds) : null;
    if (selected) {
      const known = new Set(playlist.tracks.map((track) => track.track_id));
      const unknown = [...selected].filter((trackId) => !known.has(trackId));
      if (unknown.length) throw new ApiError("PLAYLIST_TRACK_NOT_FOUND", "Virtual playlist track not found", {
        playlist_id: playlistId,
        track_ids: unknown
      });
    }
    const tracks = playlist.tracks.filter((track) =>
      (!selected || selected.has(track.track_id)) &&
      (options.force || !metadataCompleteness(track.audio_metadata).complete)
    );
    const results: PlaylistMetadataRefreshResult["tracks"] = [];
    for (const track of tracks) {
      const refreshed = await this.refreshTrack(playlistId, track.track_id, {
        sourcePreference: options.sourcePreference
      });
      results.push({ track_id: track.track_id, report: refreshed.report });
    }
    const count = (status: MetadataEnrichmentReport["status"]) =>
      results.filter((entry) => entry.report.status === status).length;
    return {
      playlist_id: playlistId,
      attempted: results.length,
      completed: count("completed"),
      partial: count("partial"),
      skipped: count("skipped"),
      failed: count("failed"),
      tracks: results,
      playlist: this.playlistService.getPlaylist(playlistId)
    };
  }

  private skippedReport(reason: string, metadata: AudioMetadata | null): MetadataEnrichmentReport {
    return {
      status: "skipped",
      observed_at: new Date().toISOString(),
      source_result_id: null,
      album_result_id: null,
      completeness: metadataCompleteness(metadata),
      warnings: [reason]
    };
  }
}
