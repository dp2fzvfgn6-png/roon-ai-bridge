import { controlPlayback } from "../roon/roonPlaybackService";
import { getRoonImage } from "../roon/roonImageService";
import { MediaResult, MediaType, RoonMediaService, SearchStrategy, SourcePreference } from "../roon/roonMediaService";
import { RoonClient } from "../roon/roonClient";
import { RoonOutput, RoonZone } from "../roon/roonTypes";
import { changeZoneVolume } from "../roon/roonVolumeService";
import { listZones } from "../roon/roonZoneService";
import { PlaylistService, VirtualPlaylistTrack } from "./playlistService";
import { VolumeLimitService } from "./volumeLimitService";
import { ApiError } from "../utils/errors";

export type WidgetContext = {
  roonClient: RoonClient;
  playlistService: PlaylistService;
  mediaService: RoonMediaService;
  volumeLimitService: VolumeLimitService;
  publicBaseUrl?: string | null;
};

type WidgetActionResult = {
  ok: boolean;
  action: string;
  message: string;
  result?: unknown;
  refresh?: Record<string, unknown>;
};

const DEFAULT_PAGE_LIMIT = 25;

function imageUrl(publicBaseUrl: string | null | undefined, imageKey: string | null | undefined): string | null {
  if (!imageKey) return null;
  const path = `/roon/images/${encodeURIComponent(imageKey)}`;
  return publicBaseUrl ? `${publicBaseUrl.replace(/\/+$/, "")}${path}` : path;
}

function firstVolumeOutput(zone: RoonZone | Record<string, any>): RoonOutput | null {
  const outputs = Array.isArray(zone.outputs) ? zone.outputs : [];
  return outputs.find((output) => output.volume) || outputs[0] || null;
}

function outputHardLimit(output: RoonOutput | null): number | null {
  if (!output?.volume) return null;
  const hard = (output.volume as Record<string, unknown>).hard_limit_max;
  if (typeof hard === "number" && Number.isFinite(hard)) return hard;
  return typeof output.volume.max === "number" ? output.volume.max : null;
}

function resolutionStatus(track: VirtualPlaylistTrack): string {
  const status = track.resolution?.status;
  return typeof status === "string" ? status : track.roon_item_key ? "stale" : "missing";
}

function trackImageKey(track: VirtualPlaylistTrack): string | null {
  return track.image_key || track.cover?.image_key || null;
}

function viewState(view: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { current_view: view, ...extra };
}

export class WidgetService {
  constructor(private readonly context: WidgetContext) {}

  getNowPlaying(input: { selected_zone_id?: string } = {}): Record<string, unknown> {
    const zones = listZones(this.context.roonClient);
    const selected = input.selected_zone_id || zones.find((zone) => zone.state === "playing")?.zone_id || zones[0]?.zone_id || null;
    const rawZones = this.context.roonClient.getZones();
    return {
      widget_type: "now_playing",
      selected_zone_id: selected,
      zones: zones.map((zone) => {
        const rawZone = rawZones.find((candidate) => candidate.zone_id === zone.zone_id);
        const output = firstVolumeOutput(rawZone || zone);
        const activeLimit = this.context.volumeLimitService.findActiveLimit(rawZone || null, output);
        const image_key = zone.now_playing.image_key;
        return {
          zone_id: zone.zone_id,
          display_name: zone.display_name,
          state: zone.state,
          now_playing: {
            title: zone.now_playing.line1,
            artist: zone.now_playing.line2,
            album: zone.now_playing.line3,
            image_key,
            image_url: imageUrl(this.context.publicBaseUrl, image_key),
            seek_position: zone.now_playing.seek_position,
            length: zone.now_playing.length
          },
          volume: {
            output_id: output?.output_id || null,
            value: typeof output?.volume?.value === "number" ? output.volume.value : null,
            is_muted: Boolean(output?.volume?.is_muted),
            safe_limit: activeLimit?.safe_max ?? null,
            hard_limit: outputHardLimit(output)
          },
          outputs: zone.outputs,
          playback_settings: zone.playback_settings,
          source_controls: rawZone?.source_controls || [],
          standby: Boolean(rawZone?.is_standby || rawZone?.standby),
          actions: [
            "play_pause",
            "previous",
            "next",
            "volume_down",
            "volume_up",
            "mute_toggle",
            "select_zone",
            "refresh"
          ]
        };
      })
    };
  }

  async nowPlayingAction(input: {
    action: string;
    zone_id: string;
    confirm?: boolean;
  }): Promise<WidgetActionResult> {
    if (!input.zone_id) throw new ApiError("ZONE_NOT_FOUND", "zone_id is required");
    const zone = this.context.roonClient.getZone(input.zone_id);
    if (!zone) throw new ApiError("ZONE_NOT_FOUND", "Zone not found", { zone_id: input.zone_id });
    let result: unknown;
    if (input.action === "play_pause") {
      result = await controlPlayback(this.context.roonClient, input.zone_id, "playpause");
    } else if (input.action === "previous" || input.action === "next") {
      result = await controlPlayback(this.context.roonClient, input.zone_id, input.action);
    } else if (input.action === "volume_down" || input.action === "volume_up") {
      result = await changeZoneVolume(
        this.context.roonClient,
        input.zone_id,
        "relative",
        input.action === "volume_up" ? 1 : -1,
        {
          confirm: Boolean(input.confirm),
          volumeLimits: this.context.volumeLimitService.activeSafetyLimits()
        }
      );
      const maybe = result as Record<string, unknown>;
      if (maybe.requires_confirmation) return maybe as WidgetActionResult;
    } else if (input.action === "mute_toggle") {
      const output = firstVolumeOutput(zone);
      if (!output?.output_id) throw new ApiError("VOLUME_NOT_SUPPORTED", "No mutable output found");
      const advanced = await import("../roon/roonAdvancedTransportService");
      result = await advanced.muteOutput(
        this.context.roonClient,
        output.output_id,
        output.volume?.is_muted ? "unmute" : "mute"
      );
    } else if (input.action === "refresh" || input.action === "select_zone") {
      result = { ok: true };
    } else {
      throw new ApiError("UNSUPPORTED_COMMAND", "Unsupported now playing widget action", { action: input.action });
    }
    return {
      ok: true,
      action: input.action,
      message: "Widget action completed.",
      result,
      refresh: { widget_type: "now_playing", selected_zone_id: input.zone_id }
    };
  }

  getPlaylists(input: { limit?: number; offset?: number } = {}): Record<string, unknown> {
    const limit = Math.max(1, Math.min(input.limit || DEFAULT_PAGE_LIMIT, 100));
    const offset = Math.max(0, input.offset || 0);
    const payload = this.context.playlistService.listPlaylists({
      includeTracks: true,
      limit,
      offset,
      trackLimit: 1,
      trackOffset: 0
    });
    return {
      widget_type: "virtual_playlists",
      view: "list",
      playlists: payload.playlists.map((playlist) => {
        const coverTrack = playlist.tracks?.find((track) => trackImageKey(track));
        const image_key = coverTrack ? trackImageKey(coverTrack) : null;
        return {
          playlist_id: playlist.playlist_id,
          name: playlist.name,
          description: playlist.description,
          track_count: playlist.track_count,
          image_key,
          image_url: imageUrl(this.context.publicBaseUrl, image_key),
          updated_at: playlist.updated_at,
          actions: ["open", "play_now", "add_to_queue", "validate", "edit_in_portal"]
        };
      }),
      pagination: {
        limit,
        offset,
        returned_count: payload.playlists.length,
        total: payload.total,
        has_more: offset + payload.playlists.length < payload.total
      },
      navigation: { can_go_back: false, current_view: "list", back_stack: [] }
    };
  }

  getPlaylistDetail(input: {
    playlist_id: string;
    limit?: number;
    offset?: number;
    recent_track_ids?: string[];
    widget_type?: "virtual_playlists" | "playlist_created";
  }): Record<string, unknown> {
    const limit = Math.max(1, Math.min(input.limit || DEFAULT_PAGE_LIMIT, 100));
    const offset = Math.max(0, input.offset || 0);
    const detail = this.context.playlistService.getPlaylistDetail(input.playlist_id, {
      includeTracks: true,
      limit,
      offset
    });
    return {
      widget_type: input.widget_type || "virtual_playlists",
      view: "playlist_detail",
      playlist: {
        playlist_id: detail.playlist_id,
        name: detail.name,
        description: detail.description,
        track_count: detail.track_count,
        updated_at: detail.updated_at,
        actions: ["play_playlist", "add_playlist_to_queue", "open_in_portal", "validate", "resolve_pending", "edit"]
      },
      pagination: {
        limit,
        offset,
        returned_count: detail.returned_count,
        total: detail.track_count,
        has_more: detail.has_more
      },
      tracks: (detail.tracks || []).map((track) => {
        const image_key = trackImageKey(track);
        return {
          track_id: track.track_id,
          position: track.position,
          title: track.audio_metadata?.title || track.title,
          artist: track.audio_metadata?.artist || track.artist,
          album: track.audio_metadata?.album || track.album,
          duration_seconds: track.audio_metadata?.duration_seconds ?? null,
          image_key,
          image_url: imageUrl(this.context.publicBaseUrl, image_key),
          user_metadata: track.user_metadata,
          identity_fingerprint: track.identity.fingerprint,
          resolution_status: resolutionStatus(track),
          roon_binding_status: track.roon_binding.state,
          last_roon_item_key: track.roon_item_key,
          recently_added: input.recent_track_ids?.includes(track.track_id) || false,
          actions: ["play_track", "add_track_to_queue", "open_details", "open_album", "open_artist"]
        };
      }),
      navigation: {
        can_go_back: true,
        back_target: "playlist_list",
        current_view: "playlist_detail",
        back_stack: [{ view: "list" }]
      }
    };
  }

  async playlistAction(input: {
    action: string;
    playlist_id: string;
    track_id?: string;
    zone_id?: string;
  }): Promise<WidgetActionResult> {
    if (!input.playlist_id) throw new ApiError("INVALID_PLAYLIST", "playlist_id is required");
    let result: unknown = { ok: true };
    if (input.action === "play_playlist" || input.action === "add_playlist_to_queue") {
      if (!input.zone_id) throw new ApiError("ZONE_NOT_FOUND", "zone_id is required");
      result = await this.context.playlistService.playPlaylist(this.context.roonClient, input.playlist_id, {
        zone_id: input.zone_id,
        mode: input.action === "play_playlist" ? "play_now" : "add_to_queue"
      }, {
        mediaService: this.context.mediaService
      });
    } else if (input.action === "play_track" || input.action === "add_track_to_queue") {
      if (!input.zone_id || !input.track_id) throw new ApiError("INVALID_PLAYLIST_TRACK", "zone_id and track_id are required");
      result = await this.context.playlistService.playPlaylistTrack(
        this.context.roonClient,
        input.playlist_id,
        input.track_id,
        {
          zone_id: input.zone_id,
          mode: input.action === "play_track" ? "play_now" : "add_to_queue",
          session_key: `widget-track-${input.track_id}`
        },
        { mediaService: this.context.mediaService }
      );
    } else if (input.action !== "open_playlist" && input.action !== "refresh") {
      throw new ApiError("UNSUPPORTED_COMMAND", "Unsupported playlist widget action", { action: input.action });
    }
    return {
      ok: true,
      action: input.action,
      message: "Playlist widget action completed.",
      result,
      refresh: { widget_type: "virtual_playlists", playlist_id: input.playlist_id }
    };
  }

  async getMediaSearch(input: {
    query: string;
    types?: MediaType[];
    zone_id?: string;
    count?: number;
    source_preference?: SourcePreference;
    strategy?: SearchStrategy;
  }): Promise<Record<string, unknown>> {
    const payload = await this.context.mediaService.search({
      query: input.query,
      types: input.types,
      zoneId: input.zone_id,
      count: input.count || 10,
      sourcePreference: input.source_preference || "highest_quality"
    });
    const primaryType = input.types?.[0] || payload.results[0]?.media_type || "track";
    return {
      widget_type: "media_search",
      view: `${primaryType}_results`,
      query: payload.query,
      source_preference: payload.source_preference,
      results: payload.results.map((result) => this.mediaResultCard(result)),
      ambiguous: payload.ambiguous,
      recommended_result_id: payload.recommended_result_id,
      selection_required: payload.selection_required,
      expansion_actions: ["broaden", "remove_context", "artist_only", "title_only"],
      warnings: payload.warnings,
      navigation: viewState(`${primaryType}_results`, { can_go_back: false, back_stack: [] })
    };
  }

  getMediaEntity(input: { result_id: string; back_stack?: unknown[] }): Record<string, unknown> {
    const media = this.context.mediaService.get(input.result_id);
    if (media.media_type === "artist") {
      return {
        widget_type: "media_search",
        view: "artist_detail",
        artist: {
          ...this.mediaResultCard(media),
          name: media.title,
          bio: null,
          genres: [],
          warnings: ["artist_bio_not_available_from_current_roon_payload"]
        },
        popular_tracks: [],
        albums: [],
        actions: ["play_artist", "start_artist_radio"],
        navigation: viewState("artist_detail", {
          can_go_back: true,
          back_stack: input.back_stack || []
        })
      };
    }
    if (media.media_type === "album") {
      return {
        widget_type: "media_search",
        view: "album_detail",
        album: this.mediaResultCard(media),
        tracks: [],
        actions: ["play_album", "add_album_to_queue", "open_artist"],
        warnings: ["album_track_listing_requires_roon_browse_detail_not_available_from_cached_result"],
        navigation: viewState("album_detail", {
          can_go_back: true,
          back_stack: input.back_stack || []
        })
      };
    }
    return {
      widget_type: "media_search",
      view: `${media.media_type}_detail`,
      entity: this.mediaResultCard(media),
      navigation: viewState(`${media.media_type}_detail`, {
        can_go_back: true,
        back_stack: input.back_stack || []
      })
    };
  }

  async mediaSearchAction(input: {
    action: string;
    result_id?: string;
    zone_id?: string;
    query?: string;
    types?: MediaType[];
    strategy?: SearchStrategy;
  }): Promise<WidgetActionResult | Record<string, unknown>> {
    if (input.action === "expand_search") {
      const payload = await this.context.mediaService.expandSearch({
        originalQuery: input.query || "",
        types: input.types,
        strategy: input.strategy || "all",
        zoneId: input.zone_id,
        count: 25
      });
      return {
        ok: true,
        action: input.action,
        message: "Expanded search completed.",
        widget: {
          widget_type: "media_search",
          view: "expanded_results",
          query: payload.original_query,
          results: payload.best_candidates.map((result) => this.mediaResultCard(result)),
          attempts: payload.attempts.map((attempt) => ({
            query: attempt.query,
            strategy: attempt.strategy,
            results_count: attempt.results_count
          })),
          navigation: viewState("expanded_results", { can_go_back: true, back_stack: [] })
        }
      };
    }
    if (!input.result_id) throw new ApiError("SEARCH_NO_RESULTS", "result_id is required");
    if (input.action === "open_album" || input.action === "open_artist" || input.action === "open_entity") {
      return {
        ok: true,
        action: input.action,
        message: "Entity opened.",
        widget: this.getMediaEntity({ result_id: input.result_id })
      };
    }
    if (!input.zone_id) throw new ApiError("ZONE_NOT_FOUND", "zone_id is required");
    let result: unknown;
    if (input.action === "play" || input.action === "play_album" || input.action === "play_artist") {
      result = input.action === "play_artist"
        ? await this.context.mediaService.play(input.result_id, input.zone_id, "replace_queue", "catalog")
        : await this.context.mediaService.play(input.result_id, input.zone_id, "replace_queue");
    } else if (input.action === "start_artist_radio") {
      result = await this.context.mediaService.startRadio(input.result_id, input.zone_id);
    } else if (input.action === "add_to_queue" || input.action === "add_album_to_queue") {
      result = await this.context.mediaService.play(input.result_id, input.zone_id, "append");
    } else {
      throw new ApiError("UNSUPPORTED_COMMAND", "Unsupported media search widget action", { action: input.action });
    }
    return {
      ok: true,
      action: input.action,
      message: "Media widget action completed.",
      result,
      refresh: { widget_type: "media_search", result_id: input.result_id }
    };
  }

  async getImage(imageKey: string, options: { width?: number; height?: number } = {}): Promise<{ contentType: string; bytes: Buffer }> {
    return getRoonImage(this.context.roonClient, imageKey, {
      width: options.width || 320,
      height: options.height || 320,
      scale: "fit",
      format: "image/jpeg"
    });
  }

  private mediaResultCard(result: MediaResult): Record<string, unknown> {
    const image_key = result.image_key;
    return {
      result_id: result.result_id,
      type: result.media_type,
      media_type: result.media_type,
      title: result.title,
      artist: result.artist,
      album: result.album,
      album_artist: result.album_artist,
      subtitle: result.subtitle,
      version: result.version_hint,
      source: result.source,
      quality: result.quality,
      image_key,
      image_url: imageUrl(this.context.publicBaseUrl, image_key),
      match_score: result.match_score,
      confidence: result.confidence,
      playable: result.playable,
      actions: this.mediaActions(result.media_type)
    };
  }

  private mediaActions(type: MediaType): string[] {
    if (type === "track") return ["play", "add_to_queue", "open_album", "open_artist", "add_to_playlist"];
    if (type === "album") return ["open_album", "play_album", "add_album_to_queue", "open_artist"];
    if (type === "artist") return ["open_artist", "play_artist", "start_artist_radio"];
    return ["play", "add_to_queue", "open_playlist"];
  }
}
