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
import { getZoneOrThrow } from "./roonZoneService";

export type MediaType = "track" | "album" | "artist" | "playlist";
export type MediaSource = "tidal" | "qobuz" | "library" | "unknown";
export type MediaActionMode = "replace_queue" | "play_next" | "append";
export type SourcePreference = "highest_quality" | "streaming_first" | "library_first";

export type MediaQuality = {
  label: string;
  bit_depth: number | null;
  sample_rate_hz: number | null;
  format: string | null;
};

export type MediaResult = {
  result_id: string;
  media_type: MediaType;
  title: string;
  subtitle: string | null;
  image_key: string | null;
  source: MediaSource;
  source_confidence: "high" | "medium" | "low";
  quality: MediaQuality | null;
  playable: boolean;
  expires_at: string;
};

type MediaReference = MediaResult & {
  query: string;
  ordinal: number;
};

export type SearchMediaRequest = {
  query: string;
  types?: MediaType[];
  zoneId?: string;
  count?: number;
  sourcePreference?: SourcePreference;
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

const DEFAULT_TYPES: MediaType[] = ["track", "album", "artist", "playlist"];
const REFERENCE_TTL_MS = 20 * 60 * 1000;
const MAX_REFERENCES = 2000;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function itemText(item: BrowseItem): string {
  return JSON.stringify(item).toLowerCase();
}

export function inferMediaSource(item: BrowseItem): {
  source: MediaSource;
  confidence: "high" | "medium" | "low";
} {
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
  return { source: "unknown", confidence: "low" };
}

export function inferMediaQuality(item: BrowseItem): MediaQuality | null {
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
  return (quality.bit_depth || 0) * 1000000 + (quality.sample_rate_hz || 0);
}

function sourceScore(source: MediaSource, preference: SourcePreference): number {
  if (preference === "library_first") return source === "library" ? 30 : source === "tidal" ? 20 : 0;
  if (preference === "streaming_first") {
    return source === "tidal" ? 30 : source === "qobuz" ? 25 : source === "library" ? 10 : 0;
  }
  return source === "tidal" ? 20 : source === "qobuz" ? 15 : source === "library" ? 10 : 0;
}

function mediaResultScore(result: MediaResult, preference: SourcePreference): number {
  return qualityScore(result.quality) + sourceScore(result.source, preference);
}

function titleMatchesCategory(title: string, type: MediaType): boolean {
  const normalized = normalize(title);
  return CATEGORY_TITLE[type].some((candidate) => normalize(candidate) === normalized);
}

function titleMatchesAction(title: string, mode: MediaActionMode): boolean {
  const normalized = normalize(title);
  return ACTION_TITLES[mode].some((candidate) => {
    const normalizedCandidate = normalize(candidate);
    return normalized === normalizedCandidate || normalized.startsWith(`${normalizedCandidate} `);
  });
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

export class RoonMediaService {
  private readonly references = new Map<string, MediaReference>();

  constructor(private readonly roonClient: RoonClient) {}

  async search(request: SearchMediaRequest): Promise<{
    query: string;
    source_preference: SourcePreference;
    results: MediaResult[];
    warnings: string[];
  }> {
    const query = request.query.trim().replace(/\s+/g, " ");
    if (!query) throw new ApiError("INVALID_SEARCH_QUERY", "Search query is required");

    const types = request.types?.length ? Array.from(new Set(request.types)) : DEFAULT_TYPES;
    const count = Math.max(1, Math.min(request.count || 10, 25));
    const preference = request.sourcePreference || "highest_quality";
    const results: MediaResult[] = [];
    const warnings: string[] = [];

    this.pruneReferences();

    for (const type of types) {
      try {
        const items = await this.searchType(query, type, request.zoneId, count);
        for (const [ordinal, item] of items.entries()) {
          results.push(this.registerReference(query, type, item, ordinal));
        }
      } catch (error) {
        warnings.push(
          `${type}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    results.sort((a, b) => mediaResultScore(b, preference) - mediaResultScore(a, preference));

    return {
      query,
      source_preference: preference,
      results,
      warnings
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

  async play(
    resultId: string,
    zoneId: string,
    mode: MediaActionMode
  ): Promise<Record<string, unknown>> {
    getZoneOrThrow(this.roonClient, zoneId);
    const reference = this.getReference(resultId);
    const result = await this.resolveAndRunAction(reference, zoneId, mode);

    return {
      ok: !result.is_error,
      zone_id: zoneId,
      mode,
      media: this.publicReference(reference),
      action: result.action || "none",
      message: result.message || null,
      is_error: typeof result.is_error === "boolean" ? result.is_error : null
    };
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

    const browse = requireBrowse(this.roonClient);
    const sessionKey = this.sessionKey("releases");
    const item = await this.resolveItem(artist, zoneId, sessionKey);
    const first = await browseCall(browse, {
      hierarchy: "search",
      multi_session_key: sessionKey,
      item_key: item.item_key,
      ...(zoneId ? { zone_or_output_id: zoneId } : {})
    });

    if (first.action !== "list") {
      throw new ApiError("SEARCH_NO_RESULTS", "Artist releases are not available", {
        result_id: resultId,
        action: first.action
      });
    }

    let current = await loadCurrentList(browse, "search", sessionKey, 0, count);
    const albumsEntry = current.items.find((candidate) =>
      ["albums", "discography", "main albums", "albumes", "discografia"].includes(
        normalize(String(candidate.title || ""))
      )
    );

    if (albumsEntry?.item_key) {
      const next = await browseCall(browse, {
        hierarchy: "search",
        multi_session_key: sessionKey,
        item_key: albumsEntry.item_key,
        ...(zoneId ? { zone_or_output_id: zoneId } : {})
      });
      if (next.action === "list") {
        current = await loadCurrentList(browse, "search", sessionKey, 0, count);
      }
    }

    const releases = selectableItems(current.items)
      .filter((candidate) => !String(candidate.title || "").toLowerCase().startsWith("play "))
      .map((candidate, ordinal) => this.registerReference(artist.title, "album", candidate, ordinal))
      .sort((a, b) => this.releaseYear(b) - this.releaseYear(a));

    return {
      artist: this.publicReference(artist),
      releases,
      list_title: current.list?.title || null
    };
  }

  private async searchType(
    query: string,
    type: MediaType,
    zoneId: string | undefined,
    count: number
  ): Promise<BrowseItem[]> {
    if (type === "playlist") {
      const globalResults = await this.searchGlobalCategory(query, type, zoneId, count);
      if (globalResults.length > 0) return globalResults;

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
      return selectableItems(itemsWithSourceContext(playlistBrowse.items))
        .filter((item) => normalize(`${item.title} ${item.subtitle || ""}`).includes(normalizedQuery))
        .slice(0, count);
    }

    return this.searchGlobalCategory(query, type, zoneId, count);
  }

  private async searchGlobalCategory(
    query: string,
    type: MediaType,
    zoneId: string | undefined,
    count: number
  ): Promise<BrowseItem[]> {
    const browse = requireBrowse(this.roonClient);
    const sessionKey = this.sessionKey(`search-${type}`);
    const root = await searchRoon(this.roonClient, {
      query,
      zoneOrOutputId: zoneId,
      offset: 0,
      count: 100,
      sessionKey
    });
    const category = root.items.find((item) => titleMatchesCategory(String(item.title || ""), type));
    if (!category?.item_key) return [];

    const selected = await browseCall(browse, {
      hierarchy: "search",
      multi_session_key: sessionKey,
      item_key: category.item_key,
      ...(zoneId ? { zone_or_output_id: zoneId } : {})
    });
    if (selected.action !== "list") return [];

    const loaded = await loadCurrentList(browse, "search", sessionKey, 0, count);
    return selectableItems(itemsWithSourceContext(loaded.items));
  }

  private registerReference(
    query: string,
    type: MediaType,
    item: BrowseItem,
    ordinal: number
  ): MediaResult {
    const resultId = `media_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + REFERENCE_TTL_MS).toISOString();
    const source = inferMediaSource(item);
    const reference: MediaReference = {
      result_id: resultId,
      media_type: type,
      title: String(item.title || ""),
      subtitle: typeof item.subtitle === "string" ? item.subtitle : null,
      image_key: typeof item.image_key === "string" ? item.image_key : null,
      source: source.source,
      source_confidence: source.confidence,
      quality: inferMediaQuality(item),
      playable: Boolean(item.item_key),
      expires_at: expiresAt,
      query,
      ordinal
    };
    this.references.set(resultId, reference);
    return this.publicReference(reference);
  }

  private getReference(resultId: string): MediaReference {
    this.get(resultId);
    return this.references.get(resultId) as MediaReference;
  }

  private publicReference(reference: MediaReference): MediaResult {
    const { query: _query, ordinal: _ordinal, ...result } = reference;
    return result;
  }

  private async resolveItem(
    reference: MediaReference,
    zoneId: string | undefined,
    sessionKey: string
  ): Promise<BrowseItem> {
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
      return inferMediaSource(item).source === reference.source;
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
    mode: MediaActionMode
  ): Promise<any> {
    const browse = requireBrowse(this.roonClient);
    const sessionKey = this.sessionKey(`action-${mode}`);
    let selected = await this.resolveItem(reference, zoneId, sessionKey);
    let lastItems: BrowseItem[] = [];

    for (let depth = 0; depth < 5; depth += 1) {
      const response = await browseCall(browse, {
        hierarchy: "search",
        multi_session_key: sessionKey,
        item_key: selected.item_key,
        zone_or_output_id: zoneId
      });
      if (response.action !== "list") return response;

      const loaded: BrowseResponse = await loadCurrentList(
        browse,
        "search",
        sessionKey,
        0,
        100
      );
      lastItems = loaded.items;
      const action = loaded.items.find(
        (item) => item.item_key && titleMatchesAction(String(item.title || ""), mode)
      );
      if (action?.item_key) {
        return browseCall(browse, {
          hierarchy: "search",
          multi_session_key: sessionKey,
          item_key: action.item_key,
          zone_or_output_id: zoneId
        });
      }

      const actionLists = loaded.items.filter(
        (item) => item.item_key && item.hint === "action_list"
      );
      const actionList =
        actionLists.find((item) =>
          normalize(String(item.title || "")).startsWith("play")
        ) || actionLists[0];
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
