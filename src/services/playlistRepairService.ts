import type { RoonMediaService, SourcePreference } from "../roon/roonMediaService";
import type { Logger } from "../utils/logger";
import { ApiError } from "../utils/errors";
import { PlaylistMetadataEnrichmentService } from "./playlistMetadataEnrichmentService";
import { PlaylistService } from "./playlistService";

export class PlaylistRepairService {
  constructor(
    private readonly playlistService: PlaylistService,
    private readonly mediaService: RoonMediaService,
    private readonly metadataService: PlaylistMetadataEnrichmentService,
    private readonly logger?: Logger
  ) {}

  async repairPlaylist(input: {
    playlistId: string;
    trackIds?: string[];
    force?: boolean;
    sourcePreference?: SourcePreference;
  }) {
    const resolution = await this.playlistService.resolveVirtualPlaylistItems(input.playlistId, {
      mediaService: this.mediaService,
      logger: this.logger,
      sourcePreference: input.sourcePreference || "streaming_first",
      trackIds: input.trackIds,
      force: input.force
    });
    const resolvedTrackIds = resolution.resolution
      .filter((entry) => entry.status === "resolved" || entry.status === "manual")
      .map((entry) => entry.track_id);
    const enrichment = resolvedTrackIds.length
      ? await this.metadataService.refreshPlaylist(input.playlistId, {
          trackIds: resolvedTrackIds,
          force: true,
          sourcePreference: input.sourcePreference
        })
      : await this.metadataService.refreshPlaylist(input.playlistId, {
          trackIds: [],
          sourcePreference: input.sourcePreference
        });
    return {
      playlist: this.playlistService.getPlaylist(input.playlistId),
      resolution: resolution.resolution,
      enrichment
    };
  }

  async selectTrack(input: {
    playlistId: string;
    trackId: string;
    resultId: string;
    selectionReason?: string;
    selectionOrigin?: "model" | "portal_user" | "unknown_explicit";
  }) {
    const result = this.mediaService.get(input.resultId);
    if (result.media_type !== "track" || !result.playable || !result.roon_item_key) {
      throw new ApiError("INVALID_PLAYLIST_TRACK", "result_id must reference a playable Roon track", {
        result_id: input.resultId,
        media_type: result.media_type,
        playable: result.playable
      });
    }
    this.playlistService.setTrackMatch(input.playlistId, input.trackId, input.resultId, {
      mediaService: this.mediaService,
      selectionReason: input.selectionReason,
      selectionOrigin: input.selectionOrigin
    });
    const enrichment = await this.metadataService.refreshTrack(input.playlistId, input.trackId, { result });
    return {
      playlist: this.playlistService.getPlaylist(input.playlistId),
      track: enrichment.track,
      enrichment: enrichment.report
    };
  }
}
