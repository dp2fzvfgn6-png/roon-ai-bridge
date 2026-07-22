import { MetadataProviderCacheService } from "./metadataProviderCacheService";
import { PlaylistService } from "./playlistService";
import { RecordingCatalogResolution, RecordingMetadataService } from "./recordingMetadataService";
import { CatalogReleaseMetadataService, CatalogReleaseResolution } from "./catalogReleaseMetadataService";
import {
  catalogIntentForTrack,
  TrackCatalogIdentityV2,
  trackCatalogIdentityV2
} from "./playlists/trackCatalogIdentity";
import { ApiError } from "../utils/errors";
import type { Logger } from "../utils/logger";

const MAX_DIAGNOSTIC_TRACKS = 10;

type CatalogTrackDiagnostic = {
  track_id: string;
  title: string;
  diagnostic: TrackCatalogIdentityV2;
  provider_result: RecordingCatalogResolution | null;
  release_result: CatalogReleaseResolution | null;
  stored_metadata_audit: ReturnType<typeof auditStoredMetadata>;
  error: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function storedRecordingMbid(track: ReturnType<PlaylistService["getPlaylist"]>["tracks"][number]): string | null {
  const audio = record(track.audio_metadata);
  const enrichment = record(track.resolution?.metadata_enrichment);
  const recording = record(audio?.recording) || record(enrichment?.recording);
  return text(recording?.musicbrainz_id) || text(recording?.recording_id);
}

function storedAlbumObservation(track: ReturnType<PlaylistService["getPlaylist"]>["tracks"][number]): string | null {
  const audio = record(track.audio_metadata);
  const enrichment = record(track.resolution?.metadata_enrichment);
  const release = record(audio?.release) || record(enrichment?.release);
  return text(release?.title) || text(audio?.album) || text(track.album) || text(track.identity?.album);
}

function auditStoredMetadata(
  track: ReturnType<PlaylistService["getPlaylist"]>["tracks"][number],
  diagnostic: TrackCatalogIdentityV2,
  releaseResult: CatalogReleaseResolution | null
) {
  const audio = record(track.audio_metadata);
  const enrichment = record(track.resolution?.metadata_enrichment);
  const recording = record(audio?.recording) || record(enrichment?.recording);
  const provenance = record(audio?.field_provenance) || record(enrichment?.field_provenance);
  const durationProvenance = record(provenance?.duration_seconds);
  const storedStatus = text(audio?.metadata_status) || text(enrichment?.metadata_status);
  const storedDuration = Number(audio?.duration_seconds);
  const duration = Number.isFinite(storedDuration) ? storedDuration : null;
  const durationSource = text(durationProvenance?.source);
  const issues: string[] = [];
  if (storedStatus === "exact" && duration !== null && durationSource !== "musicbrainz_release_track") {
    issues.push("stored_exact_duration_lacks_release_track_provenance");
  }
  if (storedStatus === "exact" && ["ambiguous_recording", "not_found", "provider_error"].includes(diagnostic.status)) {
    issues.push("stored_exact_conflicts_with_shadow_recording_status");
  }
  if (storedStatus === "exact" && ["anchor_conflict", "not_found"].includes(releaseResult?.status || "")) {
    issues.push("stored_exact_release_conflicts_with_catalog");
  }
  if (
    duration !== null
    && releaseResult?.duration.exact_for_release
    && releaseResult.duration.seconds !== null
    && Math.abs(duration - releaseResult.duration.seconds) > 2
  ) {
    issues.push("stored_duration_differs_from_verified_release_track");
  }
  return {
    stored_status: storedStatus,
    recording_mbid: text(recording?.musicbrainz_id) || text(recording?.recording_id),
    duration_seconds: duration,
    duration_source: durationSource,
    issues
  };
}

export class PlaylistCatalogDiagnosticsService {
  constructor(
    private readonly playlistService: PlaylistService,
    private readonly recordingMetadataService: RecordingMetadataService,
    private readonly cache: MetadataProviderCacheService,
    private readonly logger?: Logger,
    private readonly releaseMetadataService = new CatalogReleaseMetadataService(recordingMetadataService)
  ) {}

  async analyze(playlistId: string, trackIds: string[]) {
    const startedAt = Date.now();
    const playlist = this.playlistService.getPlaylist(playlistId);
    const requested = Array.from(new Set(trackIds));
    if (!requested.length || requested.length > MAX_DIAGNOSTIC_TRACKS) {
      throw new ApiError("INVALID_PLAYLIST_TRACK", `catalog_track_ids must contain between 1 and ${MAX_DIAGNOSTIC_TRACKS} tracks`);
    }
    const selected = requested.map((trackId) => {
      const track = playlist.tracks.find((candidate) => candidate.track_id === trackId);
      if (!track) throw new ApiError("PLAYLIST_TRACK_NOT_FOUND", "Playlist track not found", {
        playlist_id: playlistId,
        track_id: trackId
      });
      return track;
    });

    const tracks: CatalogTrackDiagnostic[] = [];
    for (const track of selected) {
      const intent = catalogIntentForTrack(track);
      if (!intent.primary_artists.length) {
        tracks.push({
          track_id: track.track_id,
          title: track.title || track.query,
          diagnostic: trackCatalogIdentityV2(track, intent, null),
          provider_result: null,
          release_result: null,
          stored_metadata_audit: auditStoredMetadata(track, trackCatalogIdentityV2(track, intent, null), null),
          error: "A reliable primary artist could not be reconstructed without guessing from Roon display credits."
        });
        continue;
      }
      try {
        const providerResult = await this.recordingMetadataService.lookup({
          recording_id: storedRecordingMbid(track),
          title: intent.title,
          artist: intent.primary_artists[0],
          album: intent.album_hint,
          album_observation: storedAlbumObservation(track),
          version_hint: intent.recording_intent,
          isrc: track.identity?.isrc,
          duration_seconds: track.identity?.duration_seconds
        });
        const releaseResult = await this.releaseMetadataService.resolve(track, intent, providerResult);
        const diagnostic = trackCatalogIdentityV2(track, intent, providerResult, false, releaseResult);
        tracks.push({
          track_id: track.track_id,
          title: track.title || track.query,
          diagnostic,
          provider_result: providerResult,
          release_result: releaseResult,
          stored_metadata_audit: auditStoredMetadata(track, diagnostic, releaseResult),
          error: null
        });
      } catch (error) {
        const diagnostic = trackCatalogIdentityV2(track, intent, null, true);
        tracks.push({
          track_id: track.track_id,
          title: track.title || track.query,
          diagnostic,
          provider_result: null,
          release_result: null,
          stored_metadata_audit: auditStoredMetadata(track, diagnostic, null),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const statuses = tracks.reduce<Record<string, number>>((summary, track) => {
      const status = track.diagnostic.status;
      summary[status] = (summary[status] || 0) + 1;
      return summary;
    }, {});
    const recordingTraces = tracks.flatMap((track) => track.provider_result?.trace ? [track.provider_result.trace] : []);
    const releaseTraces = tracks.flatMap((track) => [
      track.release_result?.candidate_provider_trace,
      track.release_result?.provider_trace
    ].filter((trace): trace is NonNullable<typeof trace> => Boolean(trace)));
    const traceSummary = (traces: typeof recordingTraces) => ({
      calls: traces.length,
      cache_hits: traces.filter((trace) => trace.cache_hit).length,
      memory_hits: traces.filter((trace) => trace.cache_layer === "memory").length,
      persistent_hits: traces.filter((trace) => trace.cache_layer === "persistent").length,
      provider_requests: traces.reduce((total, trace) => total + trace.provider_requests, 0)
    });
    this.logger?.info("MusicBrainz identity V2 shadow diagnostics completed", {
      playlistId,
      inspectedTrackCount: tracks.length,
      statuses,
      mutatesPlaylist: false
    });
    return {
      mode: "shadow",
      mutates_playlist: false,
      identity_contract_version: 2,
      playlist_id: playlistId,
      inspected_track_count: tracks.length,
      statuses,
      observability: {
        elapsed_ms: Math.max(0, Date.now() - startedAt),
        recording: traceSummary(recordingTraces),
        release: traceSummary(releaseTraces)
      },
      cache: this.cache.summary("musicbrainz"),
      tracks
    };
  }
}
