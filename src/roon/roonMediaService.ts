import crypto from "crypto";
import { ApiError } from "../utils/errors";
import {
  BrowseItem,
  BrowseResponse,
  browseCall,
  browseLibrary,
  loadCurrentList,
  requireBrowse,
  searchRoon
} from "./roonBrowseService";
import { RoonClient } from "./roonClient";
import { cleanRoonDisplayText } from "./roonText";
import { getZoneOrThrow } from "./roonZoneService";
import {
  matchReleaseCatalog,
  ReleaseMetadataService
} from "../services/releaseMetadataService";

export type MediaType = "track" | "album" | "artist" | "playlist";
export type ReleaseType = "album" | "ep" | "single" | "single_ep" | "compilation" | "live" | "remix" | "unknown";
export type ReleaseTypeSource = "roon_metadata" | "roon_section" | "musicbrainz" | "inferred" | "unknown";
export type MediaSource = "tidal" | "qobuz" | "library" | "radio" | "playlist" | "unknown";
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
  roon_rank: number;
  direct_match: boolean;
  direct_match_score: number;
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
  warnings: string[];
};

export type ArtistMediaDetail = {
  artist: MediaResult;
  bio: string | null;
  popular_tracks: MediaResult[];
  albums: MediaResult[];
  singles_eps: MediaResult[];
  warnings: string[];
};

export type AlbumMediaDetail = {
  album: MediaResult;
  description: string | null;
  tracks: MediaResult[];
  warnings: string[];
};

type MediaReference = MediaResult & {
  query: string;
  ordinal: number;
  hierarchy: "search" | "playlists";
  sourcePreference: SourcePreference;
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

const CATEGORY_TITLE: Record<MediaType, string[]> = {
  track: ["tracks", "canciones"],
  album: ["albums", "álbumes", "albumes"],
  artist: ["artists", "artistas"],
  playlist: ["playlists", "listas de reproducción", "listas"]
};

const ACTION_TITLES: Record<MediaActionMode, string[]> = {
  replace_queue: [
    "play now",
    "play album",
    "play artist",
    "play track",
    "play playlist",
    "play",
    "reproducir ahora",
    "reproducir álbum",
    "reproducir artista",
    "reproducir canción",
    "reproducir lista"
  ],
  play_next: [
    "add next",
    "play next",
    "add to next",
    "add as next",
    "añadir siguiente",
    "añadir como siguiente",
    "reproducir siguiente"
  ],
  append: [
    "queue",
    "add at end",
    "add to end",
    "add to end of queue",
    "add to queue end",
    "add last",
    "append to queue",
    "añadir al final",
    "añadir al final de la cola"
  ]
};

const ARTIST_CATALOG_ACTION_TITLES = [
  "shuffle",
  "mezclar",
  "play artist",
  "reproducir artista"
];

const RADIO_ACTION_TITLES = [
  "start radio",
  "iniciar radio"
];

const DEFAULT_TYPES: MediaType[] = ["track", "album", "artist", "playlist"];
const REFERENCE_TTL_MS = 20 * 60 * 1000;
const MAX_REFERENCES = 2000;

function normalize(value: string): string {
  return (cleanRoonDisplayText(value) || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function artistContentCount(subtitle: string | null | undefined): number | null {
  const match = normalize(subtitle || "").match(/(?:^|\s)(\d+)\s+(?:albums?|albumes|álbumes)(?:\s|$)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function releaseTypeValue(value: unknown): ReleaseType | null {
  const normalized = normalize(typeof value === "string" ? value : "");
  if (!normalized) return null;
  if (normalized === "single_ep" || normalized === "single ep") return "single_ep";
  if (/\b(single\s*[&/]\s*ep|ep\s*[&/]\s*single)\b/.test(normalized)) return "single_ep";
  if (/\b(ep|extended play)\b/.test(normalized)) return "ep";
  if (/\b(single|sencillo)\b/.test(normalized)) return "single";
  if (/\b(compilation|recopilatorio)\b/.test(normalized)) return "compilation";
  if (/\b(live|en vivo|directo)\b/.test(normalized)) return "live";
  if (/\b(remix|remixes)\b/.test(normalized)) return "remix";
  if (/\b(album|lp)\b/.test(normalized)) return "album";
  return null;
}

export function inferReleaseType(
  item: BrowseItem,
  sectionType?: ReleaseType | null
): { type: ReleaseType; source: ReleaseTypeSource } {
  const raw = objectValue(item) || {};
  const media = objectValue(item.media) || {};
  for (const key of ["release_type", "album_type", "product_type", "release_format", "format"]) {
    const typed = releaseTypeValue(media[key]) || releaseTypeValue(raw[key]);
    if (typed) return { type: typed, source: "roon_metadata" };
  }
  const inferred = releaseTypeValue(`${item.title || ""} ${item.subtitle || ""}`);
  const context = releaseTypeValue(raw.release_type_context) || sectionType || null;
  if (context === "single_ep" && inferred && ["single", "ep"].includes(inferred)) {
    return { type: inferred, source: "inferred" };
  }
  if (context === "single_ep") {
    const contentCount = releaseContentCount(item);
    if (contentCount === 1) return { type: "single", source: "inferred" };
    if (contentCount !== null && contentCount >= 2 && contentCount <= 6) {
      return { type: "ep", source: "inferred" };
    }
  }
  if (context) return { type: context, source: "roon_section" };
  if (inferred) return { type: inferred, source: "inferred" };
  return { type: "album", source: "unknown" };
}

function emptyGroups(): SearchMediaGroups {
  return { artist: [], album: [], ep: [], single_ep: [], single: [], track: [], playlist: [] };
}

function groupKey(result: MediaResult): keyof SearchMediaGroups {
  if (result.media_type !== "album") return result.media_type;
  if (result.release_type === "ep") return "ep";
  if (result.release_type === "single") return "single";
  if (result.release_type === "single_ep") return "single_ep";
  return "album";
}

export function splitArtistCredit(value: string | null | undefined): string[] {
  const cleaned = cleanRoonDisplayText(value)?.trim() || "";
  if (!cleaned) return [];
  const parts = cleaned
    .replace(/[()[\]]/g, " ")
    .split(/\s*(?:,|;|\/|\u00b7|\bfeat(?:uring)?\.?|\bft\.?|\bwith\b|\bcon\b|\bx\b)\s*/iu)
    .map((part) => part.trim())
    .filter(Boolean);
  return Array.from(new Map((parts.length ? parts : [cleaned]).map((part) => [normalize(part), part])).values());
}

function artistCreditIncludes(credit: string | null | undefined, artist: string): boolean {
  const target = normalize(artist);
  const whole = normalize(credit || "");
  if (!target || !whole) return false;
  if (whole === target) return true;
  return (credit || "")
    .split(/\s*(?:,|;|\/|\u00b7|&|\+|\bfeat(?:uring)?\.?|\bft\.?|\bwith\b|\bcon\b|\bx\b|\by\b)\s*/iu)
    .some((part) => normalize(part) === target);
}

function structuredArtistNames(item: BrowseItem): string[] {
  const raw = objectValue(item) || {};
  const media = objectValue(raw.media) || {};
  const names: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      splitArtistCredit(value).forEach((name) => names.push(name));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = objectValue(value);
    if (!record) return;
    const name = pickString(record, ["name", "title", "artist", "artist_name"]);
    if (name) names.push(cleanRoonDisplayText(name) || name);
  };
  for (const key of ["artists", "artist_names", "performers", "performer", "contributors"]) {
    visit(media[key]);
    visit(raw[key]);
  }
  return Array.from(new Map(names.filter(Boolean).map((name) => [normalize(name), name])).values());
}

function artistNamesForItem(item: BrowseItem, primary: string | null): string[] {
  const structured = structuredArtistNames(item);
  return structured.length ? structured : splitArtistCredit(primary);
}

function mediaBelongsToArtist(result: MediaResult, artist: string): boolean {
  const credits = [
    ...result.artists.map((entry) => entry.title),
    result.album_artist,
    result.artist,
    result.subtitle
  ];
  return credits.some((credit) => artistCreditIncludes(credit, artist));
}

function sectionTitleMatches(item: BrowseItem, names: string[]): boolean {
  const title = normalize(String(item.title || ""));
  return names.some((name) => {
    const candidate = normalize(name);
    return title === candidate || title.startsWith(`${candidate} `) || title.includes(` ${candidate}`);
  });
}

function releaseContentCount(item: BrowseItem): number | null {
  const nested = pickNestedNumber(item, ["content_count", "track_count", "tracks_count", "tracks"]);
  if (nested !== null) return nested;
  const match = `${item.subtitle || ""} ${item.title || ""}`.match(/\b(\d+)\s*(?:tracks?|songs?|canciones?|pistas?)\b/i);
  return match ? Number(match[1]) : null;
}

async function loadCompleteList(
  browse: any,
  hierarchy: "search",
  sessionKey: string,
  maximum: number
): Promise<BrowseResponse> {
  const limit = Math.max(1, Math.min(maximum, 500));
  const pageSize = Math.min(100, limit);
  const first = await loadCurrentList(browse, hierarchy, sessionKey, 0, pageSize);
  const total = Math.min(limit, Math.max(first.items.length, Number(first.list?.count) || 0));
  const items = [...first.items];
  for (let offset = items.length; offset < total;) {
    const loaded = await loadCurrentList(browse, hierarchy, sessionKey, offset, Math.min(pageSize, total - offset));
    if (!loaded.items.length) break;
    items.push(...loaded.items);
    offset += loaded.items.length;
  }
  return { ...first, items, count: items.length };
}

function entityPriority(result: MediaResult): number {
  return ({ artist: 0, album: 1, ep: 2, single_ep: 3, single: 4, track: 5, playlist: 6 } as const)[groupKey(result)];
}

function mediaEntityLink(
  type: "artist" | "album",
  title: string | null,
  artist: string | null,
  candidates: MediaResult[]
): MediaEntityLink | null {
  if (!title) return null;
  const normalizedTitle = normalize(title);
  const normalizedArtist = normalize(artist || "");
  const match = candidates.find((candidate) =>
    candidate.media_type === type &&
    normalize(candidate.title) === normalizedTitle &&
    (!normalizedArtist || normalize(candidate.artist || candidate.subtitle || "").includes(normalizedArtist))
  );
  return { type, title, artist, result_id: match?.result_id || null };
}

function directSearchItems(items: BrowseItem[]): BrowseItem[] {
  return selectableItems(itemsWithSourceContext(items)).filter((item) =>
    !Object.keys(CATEGORY_TITLE).some((type) => titleMatchesCategory(String(item.title || ""), type as MediaType)) &&
    isMediaContentItem(item)
  );
}

function directMatchScore(result: MediaResult, directItems: BrowseItem[]): number {
  const title = normalize(result.title);
  const artist = normalize(result.artist || result.subtitle || "");
  let score = 0;
  for (const direct of directItems) {
    if (normalize(String(direct.title || "")) !== title) continue;
    const directArtist = normalize(String(direct.subtitle || ""));
    let candidate = 70;
    if (artist && directArtist && (artist === directArtist || artist.includes(directArtist) || directArtist.includes(artist))) candidate += 20;
    if (result.image_key && direct.image_key === result.image_key) candidate += 30;
    score = Math.max(score, candidate);
  }
  return score;
}

function sortGroup(results: MediaResult[]): MediaResult[] {
  return results.sort((a, b) =>
    b.direct_match_score - a.direct_match_score ||
    b.match_score - a.match_score ||
    a.roon_rank - b.roon_rank
  );
}

type SearchTypeResult = { items: BrowseItem[]; directItems: BrowseItem[] };

const ENTITY_SECTION_TITLES = [
  "albums",
  "albumes",
  "discography",
  "discografia",
  "main albums",
  "singles",
  "singles and eps",
  "singles & eps",
  "sencillos",
  "eps",
  "tracks",
  "songs",
  "canciones",
  "popular tracks",
  "top tracks",
  "popular",
  "tracklist",
  "lista de canciones",
  "discography",
  "discografia",
  "main albums",
  "appearances",
  "credits",
  "versions",
  "biography",
  "biografia",
  "bio"
];

function isEntitySection(item: BrowseItem): boolean {
  const title = normalize(String(item.title || ""));
  return sectionTitleMatches(item, ENTITY_SECTION_TITLES) || isDiscSection(item);
}

function isDiscSection(item: BrowseItem): boolean {
  return /^(?:disc|disco|cd)\s*\d+\b/.test(normalize(String(item.title || "")));
}

function isMediaContentItem(item: BrowseItem): boolean {
  if (!item.item_key || item.hint === "header" || item.hint === "action") return false;
  if (isEntitySection(item)) return false;
  const title = normalize(String(item.title || ""));
  const actionTitles = [
    ...Object.values(ACTION_TITLES).flat(),
    ...ARTIST_CATALOG_ACTION_TITLES,
    ...RADIO_ACTION_TITLES
  ].map(normalize);
  return !actionTitles.some((candidate) => title === candidate || title.startsWith(`${candidate} `));
}

function descriptiveText(...sources: unknown[]): string | null {
  const preferredKeys = ["biography", "bio", "description", "summary", "overview", "text"];
  const candidates: string[] = [];
  const visit = (value: unknown, depth = 0): void => {
    if (!value || depth > 3) return;
    if (Array.isArray(value)) {
      value.slice(0, 30).forEach((child) => visit(child, depth + 1));
      return;
    }
    const record = objectValue(value);
    if (!record) return;
    for (const key of preferredKeys) {
      const text = record[key];
      if (typeof text === "string" && text.trim().length >= 40) candidates.push(text.trim());
    }
    const title = normalize(typeof record.title === "string" ? record.title : "");
    const subtitle = typeof record.subtitle === "string" ? record.subtitle.trim() : "";
    if (subtitle.length >= 120) candidates.push(subtitle);
    if (["biography", "biografia", "bio", "about", "acerca de"].includes(title) && subtitle.length >= 40) {
      candidates.push(subtitle);
    }
    for (const key of ["item", "list", "media", "metadata", "items"]) visit(record[key], depth + 1);
  };
  sources.forEach((source) => visit(source));
  return candidates.sort((left, right) => right.length - left.length)[0] || null;
}

function uniqueMedia(results: MediaResult[]): MediaResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = [normalize(result.title), normalize(result.artist || result.subtitle || "")].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function itemText(item: BrowseItem): string {
  return JSON.stringify(item).toLowerCase();
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function pickNumber(item: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function pickNestedString(item: BrowseItem, keys: string[]): string | null {
  const raw = objectValue(item) || {};
  const media = objectValue(raw.media) || {};
  return pickString(media, keys) || pickString(raw, keys);
}

function pickNestedNumber(item: BrowseItem, keys: string[]): number | null {
  const raw = objectValue(item) || {};
  const media = objectValue(raw.media) || {};
  return pickNumber(media, keys) ?? pickNumber(raw, keys);
}

export function inferMediaSource(item: BrowseItem): {
  source: MediaSource;
  confidence: "high" | "medium" | "low";
} {
  const raw = objectValue(item) || {};
  const media = objectValue(raw.media) || {};
  const explicit = [
    pickString(raw, ["source", "source_context", "service", "provider"]),
    pickString(media, ["source", "source_context", "service", "provider"])
  ].find(Boolean);
  const normalizedExplicit = explicit ? normalize(explicit) : "";
  if (normalizedExplicit.includes("tidal")) return { source: "tidal", confidence: "high" };
  if (normalizedExplicit.includes("qobuz")) return { source: "qobuz", confidence: "high" };
  if (
    normalizedExplicit.includes("library") ||
    normalizedExplicit.includes("biblioteca") ||
    normalizedExplicit.includes("local")
  ) {
    return { source: "library", confidence: "high" };
  }
  if (normalizedExplicit.includes("radio")) return { source: "radio", confidence: "high" };
  if (normalizedExplicit.includes("playlist") || normalizedExplicit.includes("lista")) {
    return { source: "playlist", confidence: "high" };
  }

  const text = itemText(item);
  if (text.includes("tidal")) return { source: "tidal", confidence: "high" };
  if (text.includes("qobuz")) return { source: "qobuz", confidence: "high" };
  if (
    text.includes("library") ||
    text.includes("biblioteca") ||
    text.includes("local file") ||
    text.includes("archivo local")
  ) {
    return { source: "library", confidence: "medium" };
  }
  if (text.includes("internet radio") || text.includes("live radio")) {
    return { source: "radio", confidence: "medium" };
  }
  return { source: "unknown", confidence: "low" };
}

export function inferConfiguredStreamingSource(
  item: BrowseItem,
  configuredSource: "tidal" | "qobuz" | null
): {
  source: MediaSource;
  confidence: "high" | "medium" | "low";
} {
  const explicit = inferMediaSource(item);
  if (explicit.source !== "unknown" || !configuredSource) return explicit;

  const subtitle = typeof item.subtitle === "string" ? item.subtitle : "";
  if (item.roon_linked_metadata === true || /\[\[\d+\|.+?\]\]/.test(subtitle)) {
    return {
      source: configuredSource,
      confidence: "medium"
    };
  }
  return explicit;
}

export function inferMediaQuality(item: BrowseItem): MediaQuality | null {
  const raw = objectValue(item) || {};
  const media = objectValue(raw.media) || {};
  const qualityValue = media.quality ?? raw.quality ?? media.audio_quality ?? raw.audio_quality;
  if (qualityValue && typeof qualityValue === "object" && !Array.isArray(qualityValue)) {
    const qualityObject = qualityValue as Record<string, unknown>;
    const label = pickString(qualityObject, ["label", "description", "name"]);
    const bitDepth =
      typeof qualityObject.bit_depth === "number"
        ? qualityObject.bit_depth
        : typeof qualityObject.bits_per_sample === "number"
          ? qualityObject.bits_per_sample
          : null;
    const sampleRate =
      typeof qualityObject.sample_rate_hz === "number"
        ? qualityObject.sample_rate_hz
        : typeof qualityObject.sample_rate === "number"
          ? qualityObject.sample_rate
          : null;
    const format = pickString(qualityObject, ["format", "codec"]);
    if (label || bitDepth || sampleRate || format) {
      const parts = [
        label,
        !label && bitDepth ? `${bitDepth}-bit` : null,
        !label && sampleRate ? `${sampleRate / 1000} kHz` : null,
        !label ? format : null
      ].filter(Boolean);
      return {
        label: parts.join(" / "),
        bit_depth: bitDepth,
        sample_rate_hz: sampleRate,
        format: format ? format.toUpperCase() : null
      };
    }
  }

  const text = itemText(item);
  const bitDepthMatch = text.match(/(\d{2})\s*[- ]?bit/);
  const sampleRateMatch = text.match(/(\d{2,3}(?:\.\d+)?)\s*khz/);
  const formatMatch = text.match(/\b(flac|alac|aac|mp3|mqa|dsd\d*)\b/);

  if (!bitDepthMatch && !sampleRateMatch && !formatMatch) return null;

  const bitDepth = bitDepthMatch ? Number.parseInt(bitDepthMatch[1], 10) : null;
  const sampleRate = sampleRateMatch
    ? Math.round(Number.parseFloat(sampleRateMatch[1]) * 1000)
    : null;
  const format = formatMatch ? formatMatch[1].toUpperCase() : null;
  const parts = [
    bitDepth ? `${bitDepth}-bit` : null,
    sampleRate ? `${sampleRate / 1000} kHz` : null,
    format
  ].filter(Boolean);

  return {
    label: parts.join(" / "),
    bit_depth: bitDepth,
    sample_rate_hz: sampleRate,
    format
  };
}

function qualityScore(quality: MediaQuality | null): number {
  if (!quality) return 0;
  return (quality.bit_depth || 0) * 100 + (quality.sample_rate_hz || 0) / 1000;
}

function sourceScore(source: MediaSource, preference: SourcePreference): number {
  if (preference === "library_first") return source === "library" ? 30 : source === "tidal" ? 20 : source === "qobuz" ? 20 : 0;
  if (preference === "streaming_first") {
    return source === "tidal" ? 30 : source === "qobuz" ? 25 : source === "library" ? 10 : 0;
  }
  return source === "tidal" ? 20 : source === "qobuz" ? 15 : source === "library" ? 10 : 0;
}

function confidenceFromScore(score: number): "high" | "medium" | "low" {
  if (score >= 75) return "high";
  if (score >= 60) return "medium";
  return "low";
}

function requestedAlternateVersion(request: {
  query?: string | null;
  title?: string | null;
}): boolean {
  const text = normalize(`${request.query || ""} ${request.title || ""}`);
  return /\b(3d|binaural|headphones only|remix|mix|edit|live|cover|remaster(?:ed)?|interpretation|version)\b/.test(text);
}

function inferVersionDetails(title: string, subtitle: string | null): {
  version_hint: VersionHint;
  is_alternate_version: boolean;
  version_penalties: string[];
} {
  const text = normalize(`${title} ${subtitle || ""}`);
  const penalties: string[] = [];
  if (/\b3d\b/.test(text)) penalties.push("alternate_3d");
  if (/\bbinaural\b|\bheadphones only\b/.test(text)) penalties.push("binaural_version");
  if (/\binterpretation\b/.test(text)) penalties.push("interpretation_version");
  if (/\bremix\b|\brework\b/.test(text)) penalties.push("remix_version");
  if (/\bedit\b|\bradio edit\b/.test(text)) penalties.push("edit_version");
  if (/\blive\b|\ben vivo\b|\bdirecto\b/.test(text)) penalties.push("live_version");
  if (/\bremaster(?:ed)?\b/.test(text)) penalties.push("remaster_version");
  if (/\bcover\b|\btribute\b/.test(text)) penalties.push("cover_version");
  if (/\bversion\b/.test(text)) penalties.push("alternate_version");
  if (/\bmix\b/.test(text) && !penalties.includes("remix_version")) {
    penalties.push("mix_version");
  }

  if (penalties.includes("binaural_version") || penalties.includes("alternate_3d")) {
    return { version_hint: "alternate", is_alternate_version: true, version_penalties: penalties };
  }
  if (penalties.includes("remix_version") || penalties.includes("mix_version")) {
    return { version_hint: "remix", is_alternate_version: true, version_penalties: penalties };
  }
  if (penalties.includes("edit_version")) {
    return { version_hint: "edit", is_alternate_version: true, version_penalties: penalties };
  }
  if (penalties.includes("live_version")) {
    return { version_hint: "live", is_alternate_version: true, version_penalties: penalties };
  }
  if (penalties.includes("remaster_version")) {
    return { version_hint: "remaster", is_alternate_version: true, version_penalties: penalties };
  }
  if (penalties.includes("cover_version")) {
    return { version_hint: "cover", is_alternate_version: true, version_penalties: penalties };
  }
  if (penalties.length > 0) {
    return { version_hint: "alternate", is_alternate_version: true, version_penalties: penalties };
  }
  return { version_hint: "studio", is_alternate_version: false, version_penalties: [] };
}

export function mediaRelevanceScore(result: MediaResult, query: string): number {
  const normalizedQuery = normalize(query);
  const title = normalize(result.title);
  const subtitle = normalize(result.subtitle || "");
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  let score = 0;

  if (result.media_type === "artist" && title === normalizedQuery) score += 2500;
  if (subtitle === normalizedQuery) score += 1800;
  if (title === normalizedQuery) score += 1600;
  if (subtitle.startsWith(`${normalizedQuery},`) || subtitle.startsWith(`${normalizedQuery} /`)) {
    score += 1300;
  } else if (subtitle.includes(normalizedQuery)) {
    score += 900;
  }
  if (title.includes(normalizedQuery) && title !== normalizedQuery) score += 700;
  score += queryTokens.filter((token) => title.includes(token)).length * 80;
  score += queryTokens.filter((token) => subtitle.includes(token)).length * 100;
  return score;
}

function mediaResultScore(
  result: MediaResult,
  preference: SourcePreference,
  query: string
): number {
  return (
    mediaRelevanceScore(result, query) * 1000000 +
    qualityScore(result.quality) * 100 +
    sourceScore(result.source, preference)
  );
}

export function scoreSearchResult(
  result: MediaResult,
  request: {
    query: string;
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    sourcePreference?: SourcePreference;
    strategy?: SearchStrategyOptions;
  }
): { score: number; confidence: "high" | "medium" | "low"; reasons: string[]; penalties: string[] } {
  const preference = request.sourcePreference || "highest_quality";
  const strategy = request.strategy || {};
  const query = normalize(request.query);
  const title = request.title ? normalize(request.title) : "";
  const artist = request.artist ? normalize(request.artist) : "";
  const album = request.album ? normalize(request.album) : "";
  const resultTitle = normalize(result.title);
  const resultSubtitle = normalize(result.subtitle || "");
  const resultAlbum = normalize(result.album || "");
  const reasons: string[] = [];
  const penalties: string[] = [];
  let score = 0;

  if (result.playable) {
    score += 8;
    reasons.push("playable");
  }

  if (title) {
    if (resultTitle === title) {
      score += 34;
      reasons.push("exact_title", "exact title");
    } else if (resultTitle.includes(title) || title.includes(resultTitle)) {
      score += 8;
      reasons.push("partial_title", "partial title");
      penalties.push("title_partial");
    }
  }

  if (artist) {
    if (resultSubtitle === artist || resultSubtitle.includes(artist)) {
      score += 20;
      reasons.push("artist_match", "artist match");
    } else {
      const artistTokens = artist.split(" ").filter((token) => token.length > 2);
      const matched = artistTokens.filter((token) => resultSubtitle.includes(token)).length;
      if (matched > 0) {
        score += Math.min(10, matched * 3);
        reasons.push("artist_token_match");
      } else {
        score -= 15;
        penalties.push("artist_mismatch");
      }
    }
  }

  if (album) {
    if (resultAlbum === album) {
      score += 10;
      reasons.push("album_match");
    } else if (resultAlbum && (resultAlbum.includes(album) || album.includes(resultAlbum))) {
      score += 5;
      reasons.push("album_partial");
      penalties.push("album_partial");
    } else {
      score -= 8;
      penalties.push("album_missing_or_mismatch");
    }
  }

  if (query) {
    const relevance = mediaRelevanceScore(result, query);
    const normalizedRelevance = Math.min(18, Math.round(relevance / 180));
    score += normalizedRelevance;
    if (relevance > 0) reasons.push("query_relevance");
    const queryTokens = query.split(" ").filter((token) => token.length > 2);
    const titleMatches = queryTokens.filter((token) => resultTitle.includes(token)).length;
    const subtitleMatches = queryTokens.filter((token) => resultSubtitle.includes(token)).length;
    const tokenScore = Math.min(30, titleMatches * 6 + subtitleMatches * 5);
    if (tokenScore > 0) {
      score += tokenScore;
      reasons.push("query_token_match");
    }
    const titleTokens = resultTitle.split(" ").filter((token) => token.length > 2);
    const subtitleTokens = resultSubtitle.split(" ").filter((token) => token.length > 2);
    const titleCovered = titleTokens.length > 0 && titleTokens.every((token) => query.includes(token));
    const artistCovered = subtitleTokens.length > 0 && subtitleTokens.some((token) => query.includes(token));
    if (titleCovered && artistCovered) {
      score += 25;
      reasons.push("query_title_artist_match");
    }
    const candidateTerms = new Set(resultTitle.split(" ").filter((token) => token.length > 2));
    const extraTerms = [...candidateTerms].filter((token) => !query.includes(token));
    if (extraTerms.length > 0 && titleCovered) {
      score -= Math.min(12, extraTerms.length * 3);
      penalties.push("extra_title_terms");
    }
  }

  const quality = qualityScore(result.quality);
  if (quality > 0) {
    score += Math.min(6, Math.round(quality / 500));
    reasons.push("quality_metadata");
  }

  const source = sourceScore(result.source, preference);
  if (source > 0) {
    score += Math.min(5, Math.max(1, Math.round(source / 6)));
    reasons.push(`${result.source}_source`);
  }

  if (!result.playable) {
    score -= 30;
    penalties.push("not_playable");
  }

  const uniqueVersionPenalties = Array.from(new Set(result.version_penalties || []));
  const wantsAlternate = requestedAlternateVersion(request);
  if (!wantsAlternate && uniqueVersionPenalties.length > 0) {
    const severe = uniqueVersionPenalties.filter((penalty) =>
      penalty !== "edit_version" && penalty !== "remaster_version"
    ).length;
    const mild = uniqueVersionPenalties.length - severe;
    score -= severe * 22 + mild * 10;
    penalties.push(...uniqueVersionPenalties);
  }
  if (
    !wantsAlternate &&
    result.version_hint === "studio" &&
    ((title && resultTitle === title) || (!title && query.includes(resultTitle)))
  ) {
    score += 10;
    reasons.push("clean_studio_version");
  }

  if (result.source === "unknown") {
    score -= 5;
    penalties.push("source_unknown");
  }
  if (!result.quality && result.source === "unknown") {
    score -= 3;
    penalties.push("quality_unknown");
  }
  if (result.is_library === null) {
    score -= 2;
    penalties.push("library_status_unknown");
  }

  if (strategy.avoid_live && result.version_hint === "live") {
    score -= 18;
    penalties.push("live_version");
  }
  if (strategy.avoid_remix && result.version_hint === "remix") {
    score -= 18;
    penalties.push("remix_version");
  }
  if (strategy.avoid_cover && result.version_hint === "cover") {
    score -= 18;
    penalties.push("cover_version");
  }
  if (strategy.prefer_original_album && result.version_hint !== "studio") {
    score -= 12;
    penalties.push("not_original_studio_version");
  }

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  const confidence =
    !result.roon_item_key || penalties.includes("artist_mismatch") || penalties.includes("not_playable")
      ? (bounded >= 75 ? "medium" : confidenceFromScore(bounded))
      : confidenceFromScore(bounded);
  return {
    score: bounded,
    confidence,
    reasons,
    penalties
  };
}

function titleMatchesCategory(title: string, type: MediaType): boolean {
  const normalized = normalize(title);
  return CATEGORY_TITLE[type].some((candidate) => normalize(candidate) === normalized);
}

function chooseAction(items: BrowseItem[], candidates: string[]): BrowseItem | undefined {
  for (const candidate of candidates) {
    const normalizedCandidate = normalize(candidate);
    const match = items.find((item) => {
      const title = normalize(String(item.title || ""));
      return (
        item.item_key &&
        (title === normalizedCandidate || title.startsWith(`${normalizedCandidate} `))
      );
    });
    if (match) return match;
  }
  return undefined;
}

export function chooseMediaAction(
  items: BrowseItem[],
  mediaType: MediaType,
  mode: MediaActionMode,
  artistMode: "catalog" | "radio" = "catalog"
): BrowseItem | undefined {
  const candidates =
    mode === "replace_queue" && mediaType === "artist"
      ? artistMode === "radio"
        ? RADIO_ACTION_TITLES
        : ARTIST_CATALOG_ACTION_TITLES
      : ACTION_TITLES[mode];
  return chooseAction(items, candidates);
}

function selectableItems(items: BrowseItem[]): BrowseItem[] {
  return items.filter((item) => item.item_key && item.hint !== "header");
}

function itemsWithSourceContext(items: BrowseItem[]): BrowseItem[] {
  let currentSource: MediaSource = "unknown";
  return items.map((item) => {
    const explicit = inferMediaSource(item);
    if (explicit.source !== "unknown") currentSource = explicit.source;

    const normalizedTitle = normalize(String(item.title || ""));
    if (normalizedTitle === "library" || normalizedTitle === "biblioteca") {
      currentSource = "library";
    } else if (normalizedTitle.includes("tidal")) {
      currentSource = "tidal";
    } else if (normalizedTitle.includes("qobuz")) {
      currentSource = "qobuz";
    }

    if (!item.item_key || explicit.source !== "unknown" || currentSource === "unknown") {
      return item;
    }
    return {
      ...item,
      source_context: currentSource
    };
  });
}

function libraryFlag(source: MediaSource): boolean | null {
  if (source === "library") return true;
  if (source === "unknown") return null;
  return false;
}

export class RoonMediaService {
  private readonly references = new Map<string, MediaReference>();

  constructor(
    private readonly roonClient: RoonClient,
    private readonly configuredStreamingSource: "tidal" | "qobuz" | null = null,
    private readonly releaseMetadataService = new ReleaseMetadataService()
  ) {}

  async search(request: SearchMediaRequest): Promise<SearchMediaResponse> {
    const query = request.query.trim().replace(/\s+/g, " ");
    if (!query) throw new ApiError("INVALID_SEARCH_QUERY", "Search query is required");

    const types = request.types?.length ? Array.from(new Set(request.types)) : DEFAULT_TYPES;
    const count = Math.max(1, Math.min(request.count || 10, 25));
    const preference = request.sourcePreference || "highest_quality";
    const results: MediaResult[] = [];
    const directItems: BrowseItem[] = [];
    const warnings: string[] = [];

    this.pruneReferences();

    for (const type of types) {
      try {
        const searchType = await this.searchType(query, type, request.zoneId, count);
        directItems.push(...searchType.directItems);
        for (const [ordinal, item] of searchType.items.entries()) {
          results.push(
            this.registerReference(
              query,
              type,
              item,
              ordinal,
              item.result_hierarchy === "playlists" ? "playlists" : "search",
              preference
            )
          );
        }
      } catch (error) {
        warnings.push(
          `${type}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const uniqueDirect = directItems.filter((item, index, all) => all.findIndex((candidate) =>
      normalize(String(candidate.title || "")) === normalize(String(item.title || "")) &&
      normalize(String(candidate.subtitle || "")) === normalize(String(item.subtitle || "")) &&
      candidate.image_key === item.image_key
    ) === index);
    const scored = results.map((result) => {
      const scoredResult = this.withMatchScoring(result, {
      query,
      sourcePreference: preference,
      strategy: request.strategy
      });
      const directScore = directMatchScore(scoredResult, uniqueDirect);
      return {
        ...scoredResult,
        direct_match: directScore > 0,
        direct_match_score: directScore,
        match_score: Math.min(100, scoredResult.match_score + (directScore > 0 ? 15 : 0))
      };
    });

    const groups = emptyGroups();
    for (const result of scored) groups[groupKey(result)].push(result);
    for (const key of Object.keys(groups) as Array<keyof SearchMediaGroups>) sortGroup(groups[key]);

    const orderedKeys: Array<keyof SearchMediaGroups> = ["artist", "album", "ep", "single_ep", "single", "track", "playlist"];
    const orderedResults = orderedKeys.flatMap((key) => groups[key]);
    const directCandidates = scored.filter((result) => result.direct_match);
    const best = directCandidates.length
      ? directCandidates.sort((a, b) =>
          b.direct_match_score - a.direct_match_score ||
          entityPriority(a) - entityPriority(b) ||
          a.roon_rank - b.roon_rank
        )[0]
      : [...scored].sort((a, b) =>
          b.match_score - a.match_score ||
          (Math.abs(a.match_score - b.match_score) <= 5 ? entityPriority(a) - entityPriority(b) : 0) ||
          a.roon_rank - b.roon_rank
        )[0] || null;
    const second = best
      ? scored.filter((candidate) => candidate.result_id !== best.result_id && entityPriority(candidate) === entityPriority(best))
          .sort((a, b) => b.match_score - a.match_score || a.roon_rank - b.roon_rank)[0] || null
      : null;
    const closeCandidates = Boolean(
      best &&
      second &&
      !best.direct_match &&
      second.match_score >= 60 &&
      Math.abs(best.match_score - second.match_score) <= 12
    );
    const recommendedResultId =
      best && !closeCandidates && best.playable && best.roon_item_key && (best.direct_match || best.match_score >= 55)
        ? best.result_id
        : null;
    const selectionRequired = closeCandidates || !recommendedResultId;
    const linkedResults = orderedResults.map((result) => {
      const artistLinks = (result.artists.length
        ? result.artists
        : result.artist || result.media_type === "artist"
          ? [{ type: "artist" as const, title: result.artist || result.title, artist: null, result_id: null }]
          : [])
        .map((entry) => mediaEntityLink("artist", entry.title, null, scored))
        .filter((entry): entry is MediaEntityLink => Boolean(entry));
      return {
      ...result,
      artists: artistLinks,
      links: {
        artist: artistLinks[0] || null,
        artists: artistLinks,
        album: mediaEntityLink("album", result.album || (result.media_type === "album" ? result.title : null), result.artist || result.subtitle, scored)
      },
      is_best_match: recommendedResultId === result.result_id,
      selection_required: recommendedResultId === result.result_id
        ? selectionRequired
        : Boolean(best && result.match_score >= 60 && Math.abs(best.match_score - result.match_score) <= 12)
    };});
    const linkedById = new Map(linkedResults.map((result) => [result.result_id, result]));
    for (const key of Object.keys(groups) as Array<keyof SearchMediaGroups>) {
      groups[key] = groups[key].map((result) => linkedById.get(result.result_id) || result);
    }
    for (const result of linkedResults) {
      const reference = this.references.get(result.result_id);
      if (reference) {
        reference.is_best_match = result.is_best_match;
        reference.selection_required = result.selection_required;
        reference.match_score = result.match_score;
        reference.confidence = result.confidence;
        reference.match_reasons = result.match_reasons;
        reference.match_penalties = result.match_penalties;
        reference.version_penalties = result.version_penalties;
        reference.warnings = result.warnings;
        reference.direct_match = result.direct_match;
        reference.direct_match_score = result.direct_match_score;
        reference.artists = result.artists;
        reference.links = result.links;
      }
    }

    const publicBest = best ? linkedById.get(best.result_id) || null : null;
    const bestByType: Partial<Record<keyof SearchMediaGroups, MediaResult>> = {};
    for (const key of orderedKeys) if (groups[key][0]) bestByType[key] = groups[key][0];

    return {
      query,
      source_preference: preference,
      results: linkedResults,
      groups,
      best_match: publicBest,
      best_by_type: bestByType,
      ambiguous: closeCandidates,
      ambiguity_reason: closeCandidates ? "multiple_close_candidates" : null,
      recommended_result_id: recommendedResultId,
      selection_required: selectionRequired,
      warnings
    };
  }

  async expandSearch(request: {
    originalQuery: string;
    previousQuery?: string;
    types?: MediaType[];
    strategy?: SearchStrategy;
    count?: number;
    zoneId?: string;
    sourcePreference?: SourcePreference;
  }): Promise<{
    ok: true;
    original_query: string;
    attempts: Array<{ query: string; strategy: SearchStrategy; results_count: number; results: MediaResult[] }>;
    best_candidates: MediaResult[];
  }> {
    const original = request.originalQuery.trim().replace(/\s+/g, " ");
    const strategies: SearchStrategy[] = request.strategy && request.strategy !== "all"
      ? [request.strategy]
      : ["broaden", "remove_context", "title_only", "artist_only", "fuzzy"];
    const queries = new Map<string, SearchStrategy>();
    const add = (query: string, strategy: SearchStrategy) => {
      const normalizedQuery = query.trim().replace(/\s+/g, " ");
      if (normalizedQuery) queries.set(normalizedQuery, strategy);
    };

    for (const strategy of strategies) {
      if (strategy === "broaden") add(request.previousQuery || original, strategy);
      if (strategy === "remove_context") {
        add(original.replace(/\b(peaky blinders|soundtrack|episode|scene|temporada|capitulo|capítulo)\b/gi, " "), strategy);
      }
      if (strategy === "title_only") {
        add(original.replace(/\b(by|de|feat\.?|featuring|peaky blinders|soundtrack)\b.*$/i, " "), strategy);
      }
      if (strategy === "artist_only") {
        const words = original.split(/\s+/);
        if (words.length > 2) add(words.slice(-3).join(" "), strategy);
      }
      if (strategy === "fuzzy") add(original.replace(/[^\p{L}\p{N}\s]/gu, " "), strategy);
    }

    const attempts: Array<{ query: string; strategy: SearchStrategy; results_count: number; results: MediaResult[] }> = [];
    const allResults: MediaResult[] = [];
    for (const [query, strategy] of queries.entries()) {
      const payload = await this.search({
        query,
        types: request.types,
        zoneId: request.zoneId,
        count: request.count || 25,
        sourcePreference: request.sourcePreference
      });
      attempts.push({
        query,
        strategy,
        results_count: payload.results.length,
        results: payload.results
      });
      allResults.push(...payload.results);
    }

    const seen = new Set<string>();
    const bestCandidates = allResults
      .sort((a, b) => b.match_score - a.match_score)
      .filter((result) => {
        const key = result.roon_item_key || `${result.title}|${result.subtitle}|${result.source}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, request.count || 25);

    return {
      ok: true,
      original_query: original,
      attempts,
      best_candidates: bestCandidates
    };
  }

  get(resultId: string): MediaResult {
    this.pruneReferences();
    const reference = this.references.get(resultId);
    if (!reference) {
      throw new ApiError("SEARCH_NO_RESULTS", "Media result not found or expired", {
        result_id: resultId
      });
    }
    return this.publicReference(reference);
  }

  async getArtistDetail(
    resultId: string,
    zoneId?: string,
    count = 50
  ): Promise<ArtistMediaDetail> {
    const artist = this.getReference(resultId);
    if (artist.media_type !== "artist") {
      throw new ApiError("INVALID_SEARCH_QUERY", "result_id must reference an artist", {
        result_id: resultId,
        media_type: artist.media_type
      });
    }

    const warnings: string[] = [];
    let releases: MediaResult[] = [];
    let usedSearchFallback = false;
    try {
      releases = (await this.listArtistReleases(resultId, zoneId, count)).releases;
    } catch (error) {
      warnings.push(`discography: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (releases.length === 0) {
      try {
        const fallback = await this.searchGlobalCategory(
          artist.title,
          "album",
          zoneId,
          Math.max(1, Math.min(count, 200))
        );
        releases = uniqueMedia(fallback.items.map((item, ordinal) =>
          this.registerReference(artist.title, "album", item, ordinal)
        )).filter((release) => mediaBelongsToArtist(release, artist.title));
        usedSearchFallback = true;
        warnings.push("discography_sections_unavailable: strictly matched releases use search classification");
      } catch (error) {
        warnings.push(`album_search: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const releasesPromise = usedSearchFallback && releases.length
      ? this.enrichFallbackReleases(artist, releases, warnings)
      : Promise.resolve(releases);
    const popularTracksPromise = (async (): Promise<MediaResult[]> => {
      try {
        const trackSearch = await this.search({
          query: artist.title,
          types: ["track"],
          zoneId,
          count: Math.min(25, count),
          sourcePreference: "library_first"
        });
        return trackSearch.results
          .filter((result) => mediaBelongsToArtist(result, artist.title))
          .slice(0, 12);
      } catch (error) {
        warnings.push(`popular_tracks: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    })();
    const bioPromise = (async (): Promise<string | null> => {
      try {
        return await this.readArtistBio(artist, zoneId);
      } catch (error) {
        warnings.push(`biography: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    })();
    const [enrichedReleases, popularTracks, bio] = await Promise.all([
      releasesPromise,
      popularTracksPromise,
      bioPromise
    ]);
    releases = enrichedReleases;

    const singlesEps = releases.filter((release) =>
      ["single", "ep", "single_ep"].includes(release.release_type || "")
    );
    const albums = releases.filter((release) => !singlesEps.includes(release));

    return {
      artist: this.publicReference(artist),
      bio,
      popular_tracks: popularTracks,
      albums: albums.slice(0, count),
      singles_eps: singlesEps.slice(0, count),
      warnings
    };
  }

  private async enrichFallbackReleases(
    artist: MediaReference,
    releases: MediaResult[],
    warnings: string[]
  ): Promise<MediaResult[]> {
    let catalog: Awaited<ReturnType<ReleaseMetadataService["listArtistReleases"]>> = [];
    try {
      catalog = await this.releaseMetadataService.listArtistReleases(artist.title);
    } catch (error) {
      warnings.push(`release_metadata: ${error instanceof Error ? error.message : String(error)}`);
    }

    const enriched: MediaResult[] = [];
    for (let offset = 0; offset < releases.length; offset += 4) {
      const batch = releases.slice(offset, offset + 4);
      enriched.push(...await Promise.all(batch.map(async (release) => {
        const reference = this.references.get(release.result_id);
        if (!reference) return release;
        const releaseArtists = release.artists.length
          ? release.artists.map((entry) => entry.title)
          : splitArtistCredit(release.artist || release.subtitle || artist.title);
        const metadata = matchReleaseCatalog(catalog, release.title, releaseArtists);
        const canReplaceClassification = !["roon_metadata", "roon_section"].includes(
          release.release_type_source || ""
        );
        const classifiedType = canReplaceClassification ? metadata?.release_type || null : release.release_type;
        const classifiedSource: ReleaseTypeSource | null = canReplaceClassification && metadata?.release_type
          ? "musicbrainz"
          : release.release_type_source;

        Object.assign(reference, {
          release_year: release.release_year ?? metadata?.release_year ?? null,
          release_type: classifiedType || release.release_type || "album",
          release_type_source: classifiedSource || release.release_type_source || "unknown",
          content_count: release.content_count ?? null
        });
        return this.publicReference(reference);
      })));
    }
    return enriched;
  }

  async getAlbumDetail(
    resultId: string,
    zoneId?: string,
    count = 100
  ): Promise<AlbumMediaDetail> {
    const album = this.getReference(resultId);
    if (album.media_type !== "album") {
      throw new ApiError("INVALID_SEARCH_QUERY", "result_id must reference an album", {
        result_id: resultId,
        media_type: album.media_type
      });
    }

    const warnings: string[] = [];
    let description: string | null = null;
    let tracks: MediaResult[] = [];
    try {
      const browseDetail = await this.readAlbumContents(album, zoneId, count);
      description = browseDetail.description;
      tracks = browseDetail.tracks;
    } catch (error) {
      warnings.push(`album_browse: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (tracks.length <= 1) {
      try {
        const discovered = await this.readAlbumTracksFromSearch(album, zoneId, count);
        if (discovered.length > tracks.length) {
          tracks = discovered;
          warnings.push("tracklist_recovered_from_roon_album_search");
        }
      } catch (error) {
        warnings.push(`track_search: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      album: this.publicReference(album),
      description,
      tracks: uniqueMedia(tracks).slice(0, count),
      warnings
    };
  }

  async play(
    resultId: string,
    zoneId: string,
    mode: MediaActionMode,
    artistMode: "catalog" | "radio" = "catalog"
  ): Promise<Record<string, unknown>> {
    getZoneOrThrow(this.roonClient, zoneId);
    const reference = this.getReference(resultId);
    const result = await this.resolveAndRunAction(reference, zoneId, mode, artistMode);

    return {
      ok: !result.is_error,
      zone_id: zoneId,
      mode,
      artist_mode: reference.media_type === "artist" ? artistMode : null,
      media: this.publicReference(reference),
      action: result.action || "none",
      message: result.message || null,
      is_error: typeof result.is_error === "boolean" ? result.is_error : null
    };
  }

  async startRadio(resultId: string, zoneId: string): Promise<Record<string, unknown>> {
    const reference = this.getReference(resultId);
    if (reference.media_type !== "artist") {
      throw new ApiError("INVALID_SEARCH_QUERY", "Radio currently requires an artist result_id", {
        result_id: resultId,
        media_type: reference.media_type
      });
    }
    return this.play(resultId, zoneId, "replace_queue", "radio");
  }

  async listArtistReleases(
    resultId: string,
    zoneId?: string,
    count = 50
  ): Promise<{ artist: MediaResult; releases: MediaResult[]; list_title: string | null }> {
    const artist = this.getReference(resultId);
    if (artist.media_type !== "artist") {
      throw new ApiError("INVALID_SEARCH_QUERY", "result_id must reference an artist", {
        result_id: resultId,
        media_type: artist.media_type
      });
    }

    const sectionDefinitions: Array<{ names: string[]; context: ReleaseType }> = [
      { names: ["albums", "main albums", "albumes", "albumes principales"], context: "album" },
      { names: ["singles and eps", "singles & eps", "singles / eps", "sencillos y eps"], context: "single_ep" },
      { names: ["singles", "sencillos"], context: "single" },
      { names: ["eps", "extended plays"], context: "ep" }
    ];
    const discographyNames = ["discography", "discografia"];
    let listTitle: string | null = null;
    const collected: Array<{ item: BrowseItem; context: ReleaseType; ordinal: number }> = [];

    for (const definition of sectionDefinitions) {
      const browse = requireBrowse(this.roonClient);
      const sessionKey = this.sessionKey(`releases-${definition.context}`);
      const item = await this.resolveItem(artist, zoneId, sessionKey);
      const first = await browseCall(browse, {
        hierarchy: "search",
        multi_session_key: sessionKey,
        item_key: item.item_key,
        ...(zoneId ? { zone_or_output_id: zoneId } : {})
      });
      if (first.action !== "list") continue;
      const root = await loadCompleteList(browse, "search", sessionKey, Math.max(count, 200));
      listTitle ||= root.list?.title || null;
      let items = root.items;
      let entry = items.find((candidate) => sectionTitleMatches(candidate, definition.names));
      if (!entry?.item_key) {
        const discography = items.find((candidate) => sectionTitleMatches(candidate, discographyNames));
        if (discography?.item_key) {
          const openedDiscography = await browseCall(browse, {
            hierarchy: "search",
            multi_session_key: sessionKey,
            item_key: discography.item_key,
            ...(zoneId ? { zone_or_output_id: zoneId } : {})
          });
          if (openedDiscography.action === "list") {
            const discographyList = await loadCompleteList(browse, "search", sessionKey, Math.max(count, 200));
            items = discographyList.items;
            entry = items.find((candidate) => sectionTitleMatches(candidate, definition.names));
          }
        }
      }
      if (!entry?.item_key) continue;
      const selected = await browseCall(browse, {
        hierarchy: "search",
        multi_session_key: sessionKey,
        item_key: entry.item_key,
        ...(zoneId ? { zone_or_output_id: zoneId } : {})
      });
      if (selected.action !== "list") continue;
      const loaded = await loadCompleteList(browse, "search", sessionKey, count);
      for (const candidate of selectableItems(loaded.items).filter(isMediaContentItem)) {
        collected.push({ item: candidate, context: definition.context, ordinal: collected.length });
      }
    }

    const releases = uniqueMedia(collected.map(({ item: candidate, context, ordinal }) => {
      const rawMedia = objectValue(candidate.media) || {};
      const releaseArtist = pickString(rawMedia, ["artist", "artist_name"]);
      const releaseAlbumArtist = pickString(rawMedia, ["album_artist", "albumartist"]);
      return this.registerReference(artist.title, "album", {
        ...candidate,
        release_type_context: context,
        media: {
          ...rawMedia,
          artist: releaseArtist || releaseAlbumArtist || artist.title,
          album_artist: releaseAlbumArtist || releaseArtist || artist.title
        }
      }, ordinal);
    })).filter((release) => mediaBelongsToArtist(release, artist.title))
      .sort((a, b) => this.releaseYear(b) - this.releaseYear(a) || a.roon_rank - b.roon_rank);

    return {
      artist: this.publicReference(artist),
      releases,
      list_title: listTitle
    };
  }

  private async searchType(
    query: string,
    type: MediaType,
    zoneId: string | undefined,
    count: number
  ): Promise<SearchTypeResult> {
    if (type === "playlist") {
      const globalResults = await this.searchGlobalCategory(query, type, zoneId, count);
      if (globalResults.items.length > 0) return globalResults;

      const playlistBrowse = await browseLibrary(this.roonClient, {
        hierarchy: "playlists",
        zoneOrOutputId: zoneId,
        offset: 0,
        count: 500,
        popAll: true,
        refreshList: false,
        sessionKey: this.sessionKey("playlists")
      });
      const normalizedQuery = normalize(query);
      return { items: selectableItems(itemsWithSourceContext(playlistBrowse.items))
        .filter((item) => normalize(`${item.title} ${item.subtitle || ""}`).includes(normalizedQuery))
        .map((item) => ({ ...item, result_hierarchy: "playlists" }))
        .slice(0, count), directItems: globalResults.directItems };
    }

    return this.searchGlobalCategory(query, type, zoneId, count);
  }

  private async searchGlobalCategory(
    query: string,
    type: MediaType,
    zoneId: string | undefined,
    count: number
  ): Promise<SearchTypeResult> {
    const browse = requireBrowse(this.roonClient);
    const sessionKey = this.sessionKey(`search-${type}`);
    const root = await searchRoon(this.roonClient, {
      query,
      zoneOrOutputId: zoneId,
      offset: 0,
      count: 100,
      sessionKey
    });
    const rootDirectItems = directSearchItems(root.items);
    const category = root.items.find((item) => titleMatchesCategory(String(item.title || ""), type));
    if (!category?.item_key) return { items: [], directItems: rootDirectItems };

    const selected = await browseCall(browse, {
      hierarchy: "search",
      multi_session_key: sessionKey,
      item_key: category.item_key,
      ...(zoneId ? { zone_or_output_id: zoneId } : {})
    });
    if (selected.action !== "list") return { items: [], directItems: rootDirectItems };

    const loaded = await loadCurrentList(browse, "search", sessionKey, 0, count);
    return { items: selectableItems(itemsWithSourceContext(loaded.items)), directItems: rootDirectItems };
  }

  private registerReference(
    query: string,
    type: MediaType,
    item: BrowseItem,
    ordinal: number,
    hierarchy: "search" | "playlists" = "search",
    sourcePreference: SourcePreference = "highest_quality"
  ): MediaResult {
    const resultId = `media_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + REFERENCE_TTL_MS).toISOString();
    const source = inferConfiguredStreamingSource(item, this.configuredStreamingSource);
    const quality = inferMediaQuality(item);
    const rawSubtitle = typeof item.subtitle === "string" ? item.subtitle : null;
    const title = cleanRoonDisplayText(String(item.title || "")) || "";
    const artist = type === "artist"
      ? title
      : cleanRoonDisplayText(pickNestedString(item, ["artist", "artist_name"]) || rawSubtitle);
    const artistNames = type === "artist" ? [title] : artistNamesForItem(item, artist);
    const album = cleanRoonDisplayText(pickNestedString(item, ["album", "album_name"]));
    const albumArtist = cleanRoonDisplayText(
      pickNestedString(item, ["album_artist", "albumartist", "album_artist_name"])
    );
    const subtitle = cleanRoonDisplayText(rawSubtitle);
    const version = inferVersionDetails(title, subtitle);
    const release = type === "album" ? inferReleaseType(item) : null;
    const reference: MediaReference = {
      result_id: resultId,
      type,
      media_type: type,
      title,
      roon_item_key: typeof item.item_key === "string" ? item.item_key : null,
      artist,
      artists: artistNames.map((name) => ({ type: "artist", title: name, artist: null, result_id: null })),
      album,
      album_artist: albumArtist,
      version_hint: version.version_hint,
      subtitle,
      image_key: typeof item.image_key === "string" ? item.image_key : null,
      source: source.source,
      source_confidence: source.confidence,
      quality,
      is_library: libraryFlag(source.source),
      playable: Boolean(item.item_key),
      is_best_match: false,
      selection_required: true,
      match_score: 0,
      confidence: "low",
      match_reasons: [],
      match_penalties: [],
      version_penalties: version.version_penalties,
      warnings: [],
      expires_at: expiresAt,
      release_year: pickNestedNumber(item, ["release_year", "year"]),
      duration_seconds: pickNestedNumber(item, ["duration_seconds", "duration", "length"]),
      track_number: pickNestedNumber(item, ["track_number", "track"]),
      disc_number: pickNestedNumber(item, ["disc_number", "disc"]),
      content_count: type === "artist" ? artistContentCount(subtitle) : type === "album" ? releaseContentCount(item) : null,
      release_type: release?.type || null,
      release_type_source: release?.source || null,
      roon_rank: ordinal,
      direct_match: false,
      direct_match_score: 0,
      links: { artist: null, artists: [], album: null },
      query,
      ordinal,
      hierarchy,
      sourcePreference
    };
    this.references.set(resultId, reference);
    return this.publicReference(reference);
  }

  private withMatchScoring(
    result: MediaResult,
    request: {
      query: string;
      title?: string | null;
      artist?: string | null;
      album?: string | null;
      sourcePreference?: SourcePreference;
      strategy?: SearchStrategyOptions;
    }
  ): MediaResult {
    const scoring = scoreSearchResult(result, request);
    return {
      ...result,
      match_score: scoring.score,
      confidence: scoring.confidence,
      match_reasons: scoring.reasons,
      match_penalties: scoring.penalties,
      version_penalties: Array.from(new Set([
        ...(result.version_penalties || []),
        ...scoring.penalties.filter((penalty) =>
          [
            "alternate_3d",
            "binaural_version",
            "interpretation_version",
            "remix_version",
            "edit_version",
            "live_version",
            "remaster_version",
            "cover_version",
            "alternate_version",
            "mix_version"
          ].includes(penalty)
        )
      ])),
      warnings: [
        ...(result.source === "unknown" ? ["source_unknown"] : []),
        ...(result.quality === null ? ["quality_unknown"] : []),
        ...(result.is_library === null ? ["library_status_unknown"] : [])
      ]
    };
  }

  private getReference(resultId: string): MediaReference {
    this.get(resultId);
    return this.references.get(resultId) as MediaReference;
  }

  private publicReference(reference: MediaReference): MediaResult {
    const {
      query,
      ordinal: _ordinal,
      hierarchy: _hierarchy,
      sourcePreference,
      ...result
    } = reference;
    return this.withMatchScoring(result, {
      query,
      sourcePreference
    });
  }

  private async openReference(
    reference: MediaReference,
    zoneId: string | undefined,
    purpose: string,
    count: number
  ): Promise<{
    browse: any;
    sessionKey: string;
    item: BrowseItem;
    opened: any;
    current: BrowseResponse;
  }> {
    const browse = requireBrowse(this.roonClient);
    const sessionKey = this.sessionKey(purpose);
    const item = await this.resolveItem(reference, zoneId, sessionKey);
    const opened = await browseCall(browse, {
      hierarchy: reference.hierarchy,
      multi_session_key: sessionKey,
      item_key: item.item_key,
      ...(zoneId ? { zone_or_output_id: zoneId } : {})
    });
    if (opened.action !== "list") {
      throw new ApiError("SEARCH_NO_RESULTS", "Media detail is not available", {
        result_id: reference.result_id,
        action: opened.action
      });
    }
    const current = reference.hierarchy === "search"
      ? await loadCompleteList(browse, "search", sessionKey, Math.max(1, Math.min(count, 500)))
      : await loadCurrentList(
          browse,
          reference.hierarchy,
          sessionKey,
          0,
          Math.max(1, Math.min(count, 200))
        );
    return { browse, sessionKey, item, opened, current };
  }

  private async readArtistBio(
    artist: MediaReference,
    zoneId?: string
  ): Promise<string | null> {
    const detail = await this.openReference(artist, zoneId, "artist-detail", 100);
    const direct = descriptiveText(
      detail.item,
      detail.opened,
      detail.current.list,
      detail.current.items
    );
    if (direct) return direct;

    const biography = detail.current.items.find((item) =>
      ["biography", "biografia", "bio", "about", "acerca de"].includes(
        normalize(String(item.title || ""))
      )
    );
    if (!biography?.item_key) return null;

    const response = await browseCall(detail.browse, {
      hierarchy: artist.hierarchy,
      multi_session_key: detail.sessionKey,
      item_key: biography.item_key,
      ...(zoneId ? { zone_or_output_id: zoneId } : {})
    });
    if (typeof response.message === "string" && response.message.trim().length >= 40) {
      return response.message.trim();
    }
    if (response.action !== "list") return descriptiveText(biography, response);
    const loaded = await loadCurrentList(detail.browse, artist.hierarchy, detail.sessionKey, 0, 100);
    return descriptiveText(biography, response, loaded.list, loaded.items);
  }

  private async readAlbumContents(
    album: MediaReference,
    zoneId: string | undefined,
    count: number
  ): Promise<{ description: string | null; tracks: MediaResult[] }> {
    const detail = await this.openReference(album, zoneId, "album-detail", count);
    const overviewSources: unknown[] = [
      detail.item,
      detail.opened,
      detail.current.list,
      detail.current.items
    ];
    let items = detail.current.items;
    const tracksEntry = items.find((item) =>
      sectionTitleMatches(item, ["tracks", "songs", "canciones", "tracklist", "lista de canciones"])
    );
    if (tracksEntry?.item_key) {
      const response = await browseCall(detail.browse, {
        hierarchy: album.hierarchy,
        multi_session_key: detail.sessionKey,
        item_key: tracksEntry.item_key,
        ...(zoneId ? { zone_or_output_id: zoneId } : {})
      });
      overviewSources.push(response);
      if (response.action === "list") {
        const loaded = album.hierarchy === "search"
          ? await loadCompleteList(detail.browse, "search", detail.sessionKey, Math.max(1, Math.min(count, 500)))
          : await loadCurrentList(
              detail.browse,
              album.hierarchy,
              detail.sessionKey,
              0,
              Math.max(1, Math.min(count, 200))
            );
        overviewSources.push(loaded.list, loaded.items);
        items = loaded.items;
      }
    }

    const discEntries = items.filter(isDiscSection);
    if (discEntries.length) {
      const discItems: BrowseItem[] = [];
      for (const disc of discEntries) {
        discItems.push(...await this.readAlbumDiscItems(album, zoneId, count, String(disc.title || "")));
      }
      if (discItems.length) {
        overviewSources.push(discItems);
        items = discItems;
      }
    }

    const tracks = items
      .filter(isMediaContentItem)
      .slice(0, count)
      .map((item, ordinal) => {
        const rawMedia = objectValue(item.media) || {};
        const enriched: BrowseItem = {
          ...item,
          media: {
            ...rawMedia,
            album: pickString(rawMedia, ["album", "album_name"]) || album.title,
            artist:
              pickString(rawMedia, ["artist", "artist_name"]) ||
              (typeof item.subtitle === "string" ? item.subtitle : album.artist || album.subtitle)
          }
        };
        return this.registerReference(
          [item.title, item.subtitle, album.title].filter(Boolean).join(" "),
          "track",
          enriched,
          ordinal
        );
      });

    return {
      description: descriptiveText(...overviewSources),
      tracks
    };
  }

  private async readAlbumTracksFromSearch(
    album: MediaReference,
    zoneId: string | undefined,
    count: number
  ): Promise<MediaResult[]> {
    const requested = Math.max(1, Math.min(count, 200));
    const search = await this.searchGlobalCategory(
      album.title,
      "track",
      zoneId,
      requested
    );
    const candidates = search.items;
    if (!candidates.length) return [];

    const albumArtist = album.album_artist || album.artist || album.subtitle;
    const albumArtists = splitArtistCredit(albumArtist);
    const belongsToArtist = (item: BrowseItem): boolean => {
      if (!albumArtists.length) return true;
      const itemArtists = artistNamesForItem(
        item,
        pickNestedString(item, ["artist", "artist_name"]) ||
          (typeof item.subtitle === "string" ? item.subtitle : null)
      );
      return itemArtists.some((artist) =>
        albumArtists.some((albumArtistName) =>
          artistCreditIncludes(artist, albumArtistName) ||
          artistCreditIncludes(albumArtistName, artist)
        )
      );
    };
    const exactAlbum = candidates.filter((item) =>
      belongsToArtist(item) &&
      normalize(pickNestedString(item, ["album", "album_name"]) || "") === normalize(album.title)
    );
    const albumImage = album.image_key;
    const anchor = candidates.find((item) =>
      belongsToArtist(item) &&
      normalize(String(item.title || "")) === normalize(album.title)
    ) || candidates.find(belongsToArtist);
    const coverKey = albumImage || anchor?.image_key || null;
    const matching = exactAlbum.length
      ? exactAlbum
      : coverKey
        ? candidates.filter((item) => item.image_key === coverKey && belongsToArtist(item))
        : [];
    if (!matching.length) return [];

    return matching.slice(0, requested).map((item, ordinal) => {
      const rawMedia = objectValue(item.media) || {};
      return this.registerReference(
        [album.title, albumArtist].filter(Boolean).join(" "),
        "track",
        {
          ...item,
          media: {
            ...rawMedia,
            album: album.title,
            album_artist: albumArtist,
            artist:
              pickString(rawMedia, ["artist", "artist_name"]) ||
              (typeof item.subtitle === "string" ? item.subtitle : albumArtist),
            source: pickString(rawMedia, ["source", "provider", "service"]) || album.source,
            track_number:
              pickNumber(rawMedia, ["track_number", "track"]) || ordinal + 1
          }
        },
        ordinal
      );
    });
  }

  private async readAlbumDiscItems(
    album: MediaReference,
    zoneId: string | undefined,
    count: number,
    discTitle: string
  ): Promise<BrowseItem[]> {
    const detail = await this.openReference(album, zoneId, "album-disc", count);
    let items = detail.current.items;
    const tracksEntry = items.find((item) =>
      sectionTitleMatches(item, ["tracks", "songs", "canciones", "tracklist", "lista de canciones"])
    );
    if (tracksEntry?.item_key) {
      const openedTracks = await browseCall(detail.browse, {
        hierarchy: album.hierarchy,
        multi_session_key: detail.sessionKey,
        item_key: tracksEntry.item_key,
        ...(zoneId ? { zone_or_output_id: zoneId } : {})
      });
      if (openedTracks.action !== "list") return [];
      items = album.hierarchy === "search"
        ? (await loadCompleteList(detail.browse, "search", detail.sessionKey, Math.max(1, Math.min(count, 500)))).items
        : (await loadCurrentList(detail.browse, album.hierarchy, detail.sessionKey, 0, Math.max(1, Math.min(count, 200)))).items;
    }
    const normalizedDisc = normalize(discTitle);
    const disc = items.find((item) => normalize(String(item.title || "")) === normalizedDisc);
    if (!disc?.item_key) return [];
    const openedDisc = await browseCall(detail.browse, {
      hierarchy: album.hierarchy,
      multi_session_key: detail.sessionKey,
      item_key: disc.item_key,
      ...(zoneId ? { zone_or_output_id: zoneId } : {})
    });
    if (openedDisc.action !== "list") return [];
    return album.hierarchy === "search"
      ? (await loadCompleteList(detail.browse, "search", detail.sessionKey, Math.max(1, Math.min(count, 500)))).items
      : (await loadCurrentList(detail.browse, album.hierarchy, detail.sessionKey, 0, Math.max(1, Math.min(count, 200)))).items;
  }

  private async resolveItem(
    reference: MediaReference,
    zoneId: string | undefined,
    sessionKey: string
  ): Promise<BrowseItem> {
    if (reference.hierarchy === "playlists") {
      const playlistBrowse = await browseLibrary(this.roonClient, {
        hierarchy: "playlists",
        zoneOrOutputId: zoneId,
        offset: 0,
        count: 500,
        popAll: true,
        refreshList: false,
        sessionKey
      });
      const title = normalize(reference.title);
      const subtitle = normalize(reference.subtitle || "");
      const candidates = selectableItems(
        itemsWithSourceContext(playlistBrowse.items)
      );
      const exact = candidates.find(
        (item) =>
          normalize(String(item.title || "")) === title &&
          (!subtitle || normalize(String(item.subtitle || "")) === subtitle)
      );
      const titleOnly = candidates.find(
        (item) => normalize(String(item.title || "")) === title
      );
      const resolved = exact || titleOnly || candidates[reference.ordinal];
      if (!resolved?.item_key) {
        throw new ApiError("SEARCH_NO_RESULTS", "Playlist result could not be resolved again", {
          result_id: reference.result_id,
          title: reference.title
        });
      }
      return resolved;
    }

    const browse = requireBrowse(this.roonClient);
    const root = await searchRoon(this.roonClient, {
      query: reference.query,
      zoneOrOutputId: zoneId,
      offset: 0,
      count: 100,
      sessionKey
    });
    const category = root.items.find((item) =>
      titleMatchesCategory(String(item.title || ""), reference.media_type)
    );
    if (!category?.item_key) {
      throw new ApiError("SEARCH_NO_RESULTS", "Media category is no longer available", {
        result_id: reference.result_id,
        media_type: reference.media_type
      });
    }

    const selected = await browseCall(browse, {
      hierarchy: "search",
      multi_session_key: sessionKey,
      item_key: category.item_key,
      ...(zoneId ? { zone_or_output_id: zoneId } : {})
    });
    if (selected.action !== "list") {
      throw new ApiError("SEARCH_NO_RESULTS", "Media category could not be opened", {
        result_id: reference.result_id
      });
    }

    const loaded = await loadCurrentList(browse, "search", sessionKey, 0, 100);
    const title = normalize(reference.title);
    const subtitle = normalize(reference.subtitle || "");
    const candidates = selectableItems(itemsWithSourceContext(loaded.items));
    const sourceMatches = (item: BrowseItem): boolean => {
      if (reference.source === "unknown") return true;
      return inferConfiguredStreamingSource(item, this.configuredStreamingSource).source === reference.source;
    };
    const exact = candidates.find(
      (item) =>
        normalize(String(item.title || "")) === title &&
        (!subtitle || normalize(String(item.subtitle || "")) === subtitle) &&
        sourceMatches(item)
    );
    const titleOnly = candidates.find(
      (item) =>
        normalize(String(item.title || "")) === title &&
        sourceMatches(item)
    );
    const ordinal = candidates[reference.ordinal];
    const resolved = exact || titleOnly || ordinal;

    if (!resolved?.item_key) {
      throw new ApiError("SEARCH_NO_RESULTS", "Media result could not be resolved again", {
        result_id: reference.result_id,
        title: reference.title
      });
    }
    return resolved;
  }

  private async resolveAndRunAction(
    reference: MediaReference,
    zoneId: string,
    mode: MediaActionMode,
    artistMode: "catalog" | "radio"
  ): Promise<any> {
    const browse = requireBrowse(this.roonClient);
    const sessionKey = this.sessionKey(`action-${mode}`);
    const hierarchy = reference.hierarchy;
    let selected = await this.resolveItem(reference, zoneId, sessionKey);
    let lastItems: BrowseItem[] = [];

    for (let depth = 0; depth < 5; depth += 1) {
      const response = await browseCall(browse, {
        hierarchy,
        multi_session_key: sessionKey,
        item_key: selected.item_key,
        zone_or_output_id: zoneId
      });
      if (response.action !== "list") return response;

      const loaded: BrowseResponse = await loadCurrentList(
        browse,
        hierarchy,
        sessionKey,
        0,
        100
      );
      lastItems = loaded.items;
      const action = chooseMediaAction(
        loaded.items,
        reference.media_type,
        mode,
        artistMode
      );
      if (action?.item_key) {
        if (action.hint === "action") {
          return browseCall(browse, {
            hierarchy,
            multi_session_key: sessionKey,
            item_key: action.item_key,
            zone_or_output_id: zoneId
          });
        }
        selected = action;
        continue;
      }

      const actionLists = loaded.items.filter(
        (item) => item.item_key && item.hint === "action_list"
      );
      const sameTitleList = loaded.items.find(
        (item) =>
          item.item_key &&
          item.hint === "list" &&
          normalize(String(item.title || "")) === normalize(reference.title)
      );
      const soleNestedItem =
        selectableItems(loaded.items).length === 1
          ? selectableItems(loaded.items)[0]
          : undefined;
      const actionList =
        actionLists.find((item) =>
          normalize(String(item.title || "")).startsWith("play")
        ) ||
        actionLists[0] ||
        sameTitleList ||
        soleNestedItem;
      if (!actionList?.item_key) break;
      selected = actionList;
    }

    throw new ApiError(
      mode === "replace_queue" ? "PLAYBACK_ACTION_NOT_FOUND" : "QUEUE_ACTION_NOT_FOUND",
      "Requested media action is not available",
      {
        result_id: reference.result_id,
        mode,
        available_actions: lastItems.map((item) => ({
          title: item.title,
          hint: item.hint
        }))
      }
    );
  }

  private releaseYear(result: MediaResult): number {
    const match = `${result.title} ${result.subtitle || ""}`.match(/\b(19|20)\d{2}\b/);
    return match ? Number.parseInt(match[0], 10) : 0;
  }

  private sessionKey(suffix: string): string {
    return `roon-ai-bridge-media-${suffix}-${crypto.randomBytes(6).toString("hex")}`;
  }

  private pruneReferences(): void {
    const now = Date.now();
    for (const [id, reference] of this.references) {
      if (Date.parse(reference.expires_at) <= now) this.references.delete(id);
    }
    while (this.references.size > MAX_REFERENCES) {
      const oldest = this.references.keys().next().value as string | undefined;
      if (!oldest) break;
      this.references.delete(oldest);
    }
  }
}
