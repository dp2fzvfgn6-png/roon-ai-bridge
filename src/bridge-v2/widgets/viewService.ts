import { BridgeV2Context } from "../context";
import { TargetReference } from "../contracts";
import { TargetResolver } from "../targetResolver";
import { formatZone } from "../../roon/roonZoneService";
import type { MediaResult, MediaType, SourcePreference } from "../../roon/roonMediaService";
import { getQueueSnapshot } from "../../roon/roonQueueService";
import { createWidgetAssetUrl } from "../../services/widgetAssetService";

export type WidgetView =
  | "player"
  | "search"
  | "artist"
  | "album"
  | "track"
  | "queue"
  | "playlists"
  | "playlist";

export type WidgetPayload = {
  widget_version: 1;
  view: WidgetView;
  generated_at: string;
  navigation: {
    title: string;
    can_go_back: boolean;
    parent_view: WidgetView | null;
  };
  [key: string]: unknown;
};

function imageUrl(config: BridgeV2Context["config"], imageKey: unknown): string | null {
  if (typeof imageKey !== "string" || !imageKey) return null;
  return imageKey.startsWith("custom:")
    ? createWidgetAssetUrl(config, "playlist-cover", imageKey.slice("custom:".length))
    : createWidgetAssetUrl(config, "roon-image", imageKey);
}

function basePayload(
  view: WidgetView,
  title: string,
  parentView: WidgetView | null = null
): WidgetPayload {
  return {
    widget_version: 1,
    view,
    generated_at: new Date().toISOString(),
    navigation: {
      title,
      can_go_back: parentView !== null,
      parent_view: parentView
    }
  };
}

export class WidgetV2ViewService {
  private readonly targets: TargetResolver;

  constructor(private readonly context: BridgeV2Context) {
    this.targets = new TargetResolver(context.roonClient);
  }

  async player(input: { zone?: TargetReference } = {}): Promise<WidgetPayload> {
    const zones = this.context.roonClient.getZones().map(formatZone);
    const selected = input.zone
      ? this.targets.zone(input.zone)
      : this.context.roonClient.getZones().find((zone) => zone.state === "playing") ||
        this.context.roonClient.getZones()[0] || null;
    const selectedZone = selected
      ? zones.find((zone) => zone.zone_id === selected.zone_id) || null
      : null;
    let queuePreview: unknown[] = [];
    let queueWarning: string | null = null;
    if (selected && this.context.roonClient.isTransportReady()) {
      try {
        const queue = await getQueueSnapshot(this.context.roonClient, selected.zone_id, 8);
        queuePreview = queue.items.map((item: any, index) => ({
          ...item,
          position: index + 1,
          title: item.title || item.three_line?.line1 || null,
          artist: item.artist || item.three_line?.line2 || null,
          album: item.album || item.three_line?.line3 || null,
          image_url: imageUrl(this.context.config, item.image_key)
        }));
      } catch (error) {
        queueWarning = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      ...basePayload("player", "Now Playing"),
      core: {
        connected: this.context.roonClient.isCoreConnected(),
        name: this.context.roonClient.getCoreName(),
        transport_ready: this.context.roonClient.isTransportReady()
      },
      selected_zone_id: selected?.zone_id || null,
      zones: zones.map((zone) => {
        const output = zone.outputs.find((candidate) => candidate.volume) || zone.outputs[0] || null;
        return {
          zone_id: zone.zone_id,
          name: zone.display_name,
          state: zone.state,
          now_playing: {
            title: zone.now_playing.line1,
            artist: zone.now_playing.line2,
            album: zone.now_playing.line3,
            image_key: zone.now_playing.image_key,
            image_url: imageUrl(this.context.config, zone.now_playing.image_key),
            position_seconds: zone.now_playing.seek_position,
            duration_seconds: zone.now_playing.length
          },
          volume: output?.volume
            ? {
                output_id: output.output_id,
                value: output.volume.value ?? null,
                min: output.volume.min ?? null,
                max: output.volume.max ?? null,
                step: output.volume.step ?? 1,
                muted: Boolean(output.volume.is_muted)
              }
            : null,
          playback_options: zone.playback_settings,
          grouped_outputs: zone.outputs.map((item) => ({
            output_id: item.output_id,
            name: item.display_name
          }))
        };
      }),
      selected_zone: selectedZone,
      queue_preview: queuePreview,
      warnings: queueWarning ? [queueWarning] : []
    };
  }

  async search(input: {
    query: string;
    types?: MediaType[];
    count?: number;
    source_preference?: SourcePreference;
    zone?: TargetReference;
  }): Promise<WidgetPayload> {
    const result = await this.context.mediaService.search({
      query: input.query,
      types: input.types,
      count: input.count || 20,
      sourcePreference: input.source_preference || "highest_quality"
    });
    const selectedZoneId = this.selectedZoneId(input.zone);
    return {
      ...basePayload("search", `Results for “${input.query}”`),
      query: input.query,
      zones: this.zoneOptions(),
      selected_zone_id: selectedZoneId,
      filters: {
        types: input.types || [],
        source_preference: input.source_preference || "highest_quality"
      },
      results: result.results.map((media) => this.mediaCard(media)),
      recommended_result_id: result.recommended_result_id,
      selection_required: result.selection_required,
      ambiguous: result.ambiguous,
      warnings: result.warnings || []
    };
  }

  async entity(input: {
    result_id: string;
    zone?: TargetReference;
    count?: number;
  }): Promise<WidgetPayload> {
    const media = this.context.mediaService.get(input.result_id);
    const zoneId = this.selectedZoneId(input.zone);
    if (media.media_type === "artist") {
      const detail = await this.context.mediaService.getArtistDetail(
        input.result_id,
        zoneId || undefined,
        input.count || 50
      );
      return {
        ...basePayload("artist", detail.artist.title, "search"),
        zones: this.zoneOptions(),
        selected_zone_id: zoneId,
        artist: this.mediaCard(detail.artist),
        biography: detail.bio,
        popular_tracks: detail.popular_tracks.map((item) => this.mediaCard(item)),
        albums: detail.albums.map((item) => this.mediaCard(item)),
        singles_eps: detail.singles_eps.map((item) => this.mediaCard(item)),
        warnings: detail.warnings
      };
    }
    if (media.media_type === "album") {
      const detail = await this.context.mediaService.getAlbumDetail(
        input.result_id,
        zoneId || undefined,
        input.count || 100
      );
      return {
        ...basePayload("album", detail.album.title, "search"),
        zones: this.zoneOptions(),
        selected_zone_id: zoneId,
        album: this.mediaCard(detail.album),
        description: detail.description,
        tracks: detail.tracks.map((item) => this.mediaCard(item)),
        warnings: detail.warnings
      };
    }
    return {
      ...basePayload(media.media_type === "track" ? "track" : "search", media.title, "search"),
      zones: this.zoneOptions(),
      selected_zone_id: zoneId,
      entity: this.mediaCard(media),
      warnings: media.warnings || []
    };
  }

  async queue(input: { zone: TargetReference; count?: number }): Promise<WidgetPayload> {
    const zone = this.targets.zone(input.zone);
    const queue = await getQueueSnapshot(this.context.roonClient, zone.zone_id, input.count || 100);
    return {
      ...basePayload("queue", `Queue · ${zone.display_name}`, "player"),
      zones: this.zoneOptions(),
      selected_zone_id: zone.zone_id,
      zone: { zone_id: zone.zone_id, name: zone.display_name, state: zone.state },
      items: queue.items.map((item: any, index) => ({
        ...item,
        position: index + 1,
        title: item.title || item.three_line?.line1 || null,
        artist: item.artist || item.three_line?.line2 || null,
        album: item.album || item.three_line?.line3 || null,
        image_url: imageUrl(this.context.config, item.image_key)
      }))
    };
  }

  playlists(input: { limit?: number; offset?: number } = {}): WidgetPayload {
    const result = this.context.playlistService.listPlaylists({
      includeTracks: true,
      trackLimit: 1,
      trackOffset: 0,
      limit: input.limit || 40,
      offset: input.offset || 0
    });
    return {
      ...basePayload("playlists", "RoonIA Playlists"),
      zones: this.zoneOptions(),
      selected_zone_id: this.selectedZoneId(),
      playlists: result.playlists.map((playlist) => {
        const coverKey = playlist.cover_image_key || playlist.tracks?.[0]?.image_key || null;
        return {
          playlist_id: playlist.playlist_id,
          name: playlist.name,
          description: playlist.description,
          track_count: playlist.track_count,
          updated_at: playlist.updated_at,
          image_key: coverKey,
          image_url: imageUrl(this.context.config, coverKey)
        };
      }),
      pagination: {
        limit: input.limit || 40,
        offset: input.offset || 0,
        total: result.total,
        has_more: (input.offset || 0) + result.playlists.length < result.total
      }
    };
  }

  playlist(input: { playlist_id: string; limit?: number; offset?: number }): WidgetPayload {
    const playlist = this.context.playlistService.getPlaylistDetail(input.playlist_id, {
      includeTracks: true,
      limit: input.limit || 100,
      offset: input.offset || 0
    });
    return {
      ...basePayload("playlist", playlist.name, "playlists"),
      zones: this.zoneOptions(),
      selected_zone_id: this.selectedZoneId(),
      playlist: {
        playlist_id: playlist.playlist_id,
        name: playlist.name,
        description: playlist.description,
        track_count: playlist.track_count,
        image_key: playlist.cover_image_key,
        image_url: imageUrl(this.context.config, playlist.cover_image_key)
      },
      tracks: (playlist.tracks || []).map((track) => ({
        playlist_id: playlist.playlist_id,
        track_id: track.track_id,
        position: track.position,
        title: track.audio_metadata?.title || track.title || track.query,
        artist: track.audio_metadata?.artist || track.artist,
        album: track.audio_metadata?.album || track.album,
        duration_seconds: track.audio_metadata?.duration_seconds ?? null,
        image_key: track.image_key,
        image_url: imageUrl(this.context.config, track.image_key),
        resolution_status: track.resolution?.status || "missing",
        roon_binding_status: track.roon_binding.state
      })),
      pagination: {
        limit: input.limit || 100,
        offset: input.offset || 0,
        total: playlist.track_count,
        has_more: playlist.has_more
      }
    };
  }

  async navigate(input: {
    view: WidgetView;
    zone?: TargetReference;
    query?: string;
    types?: MediaType[];
    result_id?: string;
    playlist_id?: string;
    count?: number;
    limit?: number;
    offset?: number;
    source_preference?: SourcePreference;
  }): Promise<WidgetPayload> {
    if (input.view === "player") return this.player({ zone: input.zone });
    if (input.view === "search") {
      if (!input.query) throw new Error("query is required for search view");
      return this.search(input as any);
    }
    if (["artist", "album", "track"].includes(input.view)) {
      if (!input.result_id) throw new Error("result_id is required for entity view");
      return this.entity(input as any);
    }
    if (input.view === "queue") {
      if (!input.zone) throw new Error("zone is required for queue view");
      return this.queue(input as any);
    }
    if (input.view === "playlists") return this.playlists(input);
    if (input.view === "playlist") {
      if (!input.playlist_id) throw new Error("playlist_id is required for playlist view");
      return this.playlist(input as any);
    }
    throw new Error(`Unsupported widget view: ${input.view}`);
  }

  private mediaCard(media: MediaResult): Record<string, unknown> {
    return {
      result_id: media.result_id,
      media_type: media.media_type,
      title: media.title,
      artist: media.artist,
      album: media.album,
      album_artist: media.album_artist,
      subtitle: media.subtitle,
      release_year: media.release_year ?? null,
      duration_seconds: media.duration_seconds ?? null,
      track_number: media.track_number ?? null,
      disc_number: media.disc_number ?? null,
      source: media.source,
      quality: media.quality,
      confidence: media.confidence,
      playable: media.playable,
      image_key: media.image_key,
      image_url: imageUrl(this.context.config, media.image_key)
    };
  }

  private zoneOptions(): Array<{ zone_id: string; name: string; state: string }> {
    return this.context.roonClient.getZones().map((zone) => ({
      zone_id: zone.zone_id,
      name: zone.display_name,
      state: zone.state
    }));
  }

  private selectedZoneId(ref?: TargetReference): string | null {
    if (ref) return this.targets.zone(ref).zone_id;
    const selected = this.context.roonClient.getZones().find((zone) => zone.state === "playing") ||
      this.context.roonClient.getZones()[0];
    return selected?.zone_id || null;
  }
}
