import { cleanRoonDisplayText } from "../roonText";
import type {
  MediaQuality,
  MediaResult,
  MediaSource,
  SearchStrategyOptions,
  SourcePreference,
  VersionHint
} from "./mediaContracts";

export function normalizeMediaText(value: string): string {
  return (cleanRoonDisplayText(value) || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
const normalize = normalizeMediaText;

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

export function inferVersionDetails(title: string, subtitle: string | null): {
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
