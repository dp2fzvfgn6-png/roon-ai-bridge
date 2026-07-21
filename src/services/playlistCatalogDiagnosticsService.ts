import { MetadataProviderCacheService } from "./metadataProviderCacheService";
import { PlaylistService } from "./playlistService";
import { RecordingCatalogResolution, RecordingMetadataService } from "./recordingMetadataService";
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
  error: string | null;
};

export class PlaylistCatalogDiagnosticsService {
  constructor(
    private readonly playlistService: PlaylistService,
    private readonly recordingMetadataService: RecordingMetadataService,
    private readonly cache: MetadataProviderCacheService,
    private readonly logger?: Logger
  ) {}

  async analyze(playlistId: string, trackIds: string[]) {
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
          error: "A reliable primary artist could not be reconstructed without guessing from Roon display credits."
        });
        continue;
      }
      try {
        const providerResult = await this.recordingMetadataService.lookup({
          title: intent.title,
          artist: intent.primary_artists[0],
          album: intent.album_hint,
          version_hint: intent.recording_intent,
          isrc: track.identity?.isrc,
          duration_seconds: track.identity?.duration_seconds
        });
        tracks.push({
          track_id: track.track_id,
          title: track.title || track.query,
          diagnostic: trackCatalogIdentityV2(track, intent, providerResult),
          provider_result: providerResult,
          error: null
        });
      } catch (error) {
        tracks.push({
          track_id: track.track_id,
          title: track.title || track.query,
          diagnostic: trackCatalogIdentityV2(track, intent, null, true),
          provider_result: null,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const statuses = tracks.reduce<Record<string, number>>((summary, track) => {
      const status = track.diagnostic.status;
      summary[status] = (summary[status] || 0) + 1;
      return summary;
    }, {});
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
      cache: this.cache.summary("musicbrainz"),
      tracks
    };
  }
}
