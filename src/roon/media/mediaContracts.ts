export type MediaType = "track" | "album" | "artist" | "playlist";
export type ReleaseType = "album" | "ep" | "single" | "single_ep" | "compilation" | "live" | "remix" | "unknown";
export type ReleaseTypeSource = "roon_metadata" | "roon_section" | "musicbrainz" | "inferred" | "unknown";
export type MediaSource = "tidal" | "qobuz" | "library" | "radio" | "playlist" | "unknown";
export type MediaDataOrigin = "roon_library" | "roon_search_session" | "external_metadata" | "inferred";
export type MediaCompleteness = "complete" | "partial" | "unknown";
export type MediaActionMode = "replace_queue" | "play_next" | "append";
export type SourcePreference = "highest_quality" | "streaming_first" | "library_first";
export type SearchStrategy = "broaden" | "remove_context" | "artist_only" | "title_only" | "fuzzy" | "all";
export type VersionHint =
  | "studio"
  | "live"
  | "remix"
  | "edit"
  | "remaster"
  | "cover"
  | "alternate"
  | "unknown";

export type MediaQuality = {
  label: string;
  bit_depth: number | null;
  sample_rate_hz: number | null;
  format: string | null;
};
export type MediaResult = {
  result_id: string;
  roon_item_key: string | null;
  type: MediaType;
  media_type: MediaType;
  title: string;
  artist: string | null;
  artists: MediaEntityLink[];
  album: string | null;
  album_artist: string | null;
  version_hint: VersionHint;
  subtitle: string | null;
  image_key: string | null;
  source: MediaSource;
  source_confidence: "high" | "medium" | "low";
  quality: MediaQuality | null;
  is_library: boolean | null;
  playable: boolean;
  is_best_match: boolean;
  selection_required: boolean;
  match_score: number;
  confidence: "high" | "medium" | "low";
  match_reasons: string[];
  match_penalties: string[];
  version_penalties: string[];
  warnings: string[];
  expires_at: string;
  release_year?: number | null;
  duration_seconds?: number | null;
  track_number?: number | null;
  disc_number?: number | null;
  content_count?: number | null;
  release_type: ReleaseType | null;
  release_type_source: ReleaseTypeSource | null;
  release_section: string | null;
  roon_rank: number;
  direct_match: boolean;
  direct_match_score: number;
  data_origin: MediaDataOrigin;
  completeness: MediaCompleteness;
  ordered: boolean | null;
  identity_verified: boolean;
  links: {
    artist: MediaEntityLink | null;
    artists: MediaEntityLink[];
    album: MediaEntityLink | null;
  };
};

export type MediaEntityLink = {
  type: "artist" | "album";
  title: string;
  artist: string | null;
  result_id: string | null;
};

export type SearchMediaGroups = {
  artist: MediaResult[];
  album: MediaResult[];
  ep: MediaResult[];
  single_ep: MediaResult[];
  single: MediaResult[];
  track: MediaResult[];
  playlist: MediaResult[];
};

export type SearchMediaResponse = {
  query: string;
  source_preference: SourcePreference;
  results: MediaResult[];
  groups: SearchMediaGroups;
  best_match: MediaResult | null;
  best_by_type: Partial<Record<keyof SearchMediaGroups, MediaResult>>;
  ambiguous: boolean;
  ambiguity_reason: string | null;
  recommended_result_id: string | null;
  selection_required: boolean;
  available_counts: Partial<Record<MediaType, number>>;
  warnings: string[];
};

export type ArtistMediaDetail = {
  artist: MediaResult;
  bio: string | null;
  popular_tracks: MediaResult[];
  albums: MediaResult[];
  singles_eps: MediaResult[];
  release_sections: Array<{
    title: string;
    release_type: ReleaseType;
    releases: MediaResult[];
  }>;
  data_origin: MediaDataOrigin;
  completeness: MediaCompleteness;
  identity_verified: boolean;
  warnings: string[];
};

export type AlbumMediaDetail = {
  album: MediaResult;
  description: string | null;
  tracks: MediaResult[];
  related_tracks: MediaResult[];
  data_origin: MediaDataOrigin;
  completeness: MediaCompleteness;
  ordered: boolean;
  identity_verified: boolean;
  warnings: string[];
};

export type PlaylistMediaTrack = MediaResult & {
  playlist_position: number;
};

export type PlaylistMediaDetail = {
  playlist: MediaResult;
  tracks: PlaylistMediaTrack[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    returned: number;
    has_more: boolean;
  };
  data_origin: MediaDataOrigin;
  completeness: MediaCompleteness;
  ordered: boolean;
  identity_verified: boolean;
  warnings: string[];
};

export type SearchMediaRequest = {
  query: string;
  types?: MediaType[];
  zoneId?: string;
  count?: number;
  sourcePreference?: SourcePreference;
  strategy?: SearchStrategyOptions;
};

export type SearchStrategyOptions = {
  source_preference?: SourcePreference;
  avoid_live?: boolean;
  avoid_remix?: boolean;
  avoid_cover?: boolean;
  prefer_original_album?: boolean;
};
