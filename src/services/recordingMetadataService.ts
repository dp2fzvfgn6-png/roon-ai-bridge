import { APP_VERSION } from "../config/version";

export type RecordingCatalogMetadata = {
  recording_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  disambiguation: string | null;
  duration_seconds: number | null;
  release_year: number | null;
  original_release_year: number | null;
  isrc: string | null;
  isrcs: string[];
  composers: string[];
  lyricists: string[];
  genres: string[];
  confidence: "high" | "medium";
};

export type RecordingCatalogCandidate = {
  recording_id: string;
  title: string;
  disambiguation: string | null;
  duration_seconds: number | null;
  isrcs: string[];
  releases: string[];
};

export type RecordingCatalogResolution = {
  status: "exact" | "conflict" | "not_found";
  reason: string;
  metadata: RecordingCatalogMetadata | null;
  candidates: RecordingCatalogCandidate[];
};

type FetchLike = typeof fetch;
type JsonRecord = Record<string, unknown>;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 1100;

function objectValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(objectValue).filter((item): item is JsonRecord => Boolean(item)) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function normalize(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function lucene(value: string): string {
  return value.replace(/[\\"]/g, "\\$&");
}

function year(value: unknown): number | null {
  const match = String(value || "").match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  return match ? Number(match[1]) : null;
}

function durationSeconds(value: unknown): number | null {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds >= 30_000 && milliseconds <= 30 * 60_000
    ? Math.round(milliseconds / 1000)
    : null;
}

function artistNames(value: unknown): string[] {
  return records(value).flatMap((credit) => {
    const artist = objectValue(credit.artist);
    const name = typeof credit.name === "string"
      ? credit.name
      : typeof artist?.name === "string"
        ? artist.name
        : null;
    return name ? [name] : [];
  });
}

function baseRecordingTitle(value: unknown): string {
  return normalize(value)
    .replace(/\b(?:remaster(?:ed)?|stereo mix|mono mix|mix|lp version|album version|single version|radio edit|single edit)\b(?:\s+(?:19|20)\d{2})?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function releaseKey(value: unknown): string {
  return normalize(value)
    .replace(/\b(?:super deluxe(?: edition)?|deluxe edition|expanded edition)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function releaseSearchAlias(value: string): string {
  return value
    .replace(/\s*\((?:super\s+)?deluxe(?:\s+edition)?\)\s*/gi, " ")
    .replace(/\s*:\s*/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
}

type VariantProfile = {
  live: boolean;
  remix: boolean;
  edit: boolean;
  atmosphere: boolean;
  demo: boolean;
  alternate: boolean;
  albumVersion: boolean;
  original: boolean;
  remaster: boolean;
  year: number | null;
};

function variantProfile(value: unknown, hint?: string | null): VariantProfile {
  const text = normalize([value, hint].filter(Boolean).join(" "));
  return {
    live: /\b(?:live|concert|en vivo|directo)\b/.test(text),
    remix: /\bremix\b/.test(text),
    edit: /\b(?:single edit|radio edit|edit)\b/.test(text),
    atmosphere: /\b(?:atmos|dolby atmos|5 1|binaural|3d)\b/.test(text),
    demo: /\b(?:demo|session|take)\b/.test(text),
    alternate: /\b(?:alternate|alternative)\b/.test(text),
    albumVersion: /\b(?:lp version|album version)\b/.test(text),
    original: /\boriginal (?:studio|album|stereo|mono)? ?(?:mix|version)?\b/.test(text),
    remaster: /\bremaster(?:ed)?\b/.test(text),
    year: year(text)
  };
}

function variantStrength(requested: VariantProfile, candidateText: string): number | null {
  const candidate = variantProfile(candidateText);
  if (requested.year && candidate.year !== requested.year) return null;
  if (requested.live !== candidate.live && (requested.live || candidate.live)) return null;
  if (requested.remix !== candidate.remix && (requested.remix || candidate.remix)) return null;
  if (requested.edit !== candidate.edit && (requested.edit || candidate.edit)) return null;
  if (requested.demo !== candidate.demo && (requested.demo || candidate.demo)) return null;
  if (requested.atmosphere !== candidate.atmosphere && (requested.atmosphere || candidate.atmosphere)) return null;
  if (!requested.alternate && candidate.alternate) return null;
  if (requested.albumVersion) return candidate.original ? 8 : candidateText.trim() ? 3 : 4;
  if (requested.year) return 8;
  if (requested.remaster && !candidate.remaster && !candidate.year) return null;
  if (requested.original) return candidate.original ? 8 : null;
  if (requested.live || requested.remix || requested.edit || requested.demo || requested.atmosphere || requested.alternate) return 7;
  if (candidate.original) return 6;
  return candidateText.trim() ? 3 : 5;
}

function releaseTitles(recording: JsonRecord): string[] {
  return records(recording.releases)
    .map((release) => typeof release.title === "string" ? release.title : "")
    .filter(Boolean);
}

function compatibleReleases(recording: JsonRecord, album?: string | null): JsonRecord[] {
  const releases = records(recording.releases);
  if (!album) return releases;
  const expected = releaseKey(album);
  return releases.filter((release) => releaseKey(release.title) === expected);
}

function candidateSnapshot(recording: JsonRecord): RecordingCatalogCandidate {
  return {
    recording_id: String(recording.id || ""),
    title: String(recording.title || ""),
    disambiguation: typeof recording.disambiguation === "string" && recording.disambiguation.trim()
      ? recording.disambiguation
      : null,
    duration_seconds: durationSeconds(recording.length),
    isrcs: strings(recording.isrcs),
    releases: Array.from(new Set(releaseTitles(recording))).slice(0, 12)
  };
}

export class RecordingMetadataService {
  private readonly cache = new Map<string, { expiresAt: number; value: RecordingCatalogResolution }>();
  private requestChain: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  private async requestJson(url: URL): Promise<JsonRecord> {
    let releaseRequest: () => void = () => undefined;
    const previous = this.requestChain;
    this.requestChain = new Promise<void>((resolve) => { releaseRequest = resolve; });
    await previous;
    try {
      const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt));
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await this.fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": `RoonAI-Bridge/${APP_VERSION} (https://github.com/dp2fzvfgn6-png/roon-ai-bridge)`
          },
          signal: controller.signal
        });
        this.lastRequestAt = Date.now();
        if (!response.ok) throw new Error(`MusicBrainz returned HTTP ${response.status}`);
        return await response.json() as JsonRecord;
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      releaseRequest();
    }
  }

  private async search(title: string, artist: string, album?: string | null): Promise<JsonRecord[]> {
    const terms = [
      `recording:"${lucene(title)}"`,
      `artist:"${lucene(artist)}"`,
      album ? `release:"${lucene(album)}"` : ""
    ].filter(Boolean);
    const url = new URL("https://musicbrainz.org/ws/2/recording");
    url.searchParams.set("query", terms.join(" AND "));
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "100");
    const response = await this.requestJson(url);
    return records(response.recordings);
  }

  async lookup(input: {
    title: string;
    artist: string;
    album?: string | null;
    version_hint?: string | null;
    isrc?: string | null;
    duration_seconds?: number | null;
  }): Promise<RecordingCatalogResolution> {
    const cacheKey = [
      normalize(input.title), normalize(input.artist), releaseKey(input.album),
      normalize(input.version_hint), normalize(input.isrc), input.duration_seconds || ""
    ].join("|");
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const searchTitle = baseRecordingTitle(input.title) || input.title;
    const releaseAlias = input.album ? releaseSearchAlias(input.album) : null;
    let recordings = await this.search(searchTitle, input.artist, releaseAlias);
    if (!recordings.length && releaseAlias) recordings = await this.search(searchTitle, input.artist);

    const expectedTitle = baseRecordingTitle(input.title);
    const expectedArtist = normalize(input.artist);
    const requestedVariant = variantProfile(input.title, input.version_hint);
    const expectedIsrc = normalize(input.isrc);
    const ranked = recordings.flatMap((recording) => {
      if (typeof recording.id !== "string" || typeof recording.title !== "string") return [];
      if (baseRecordingTitle(recording.title) !== expectedTitle) return [];
      const artists = artistNames(recording["artist-credit"]);
      if (artists.length && !artists.some((artist) => {
        const candidate = normalize(artist);
        return candidate === expectedArtist || candidate.includes(expectedArtist) || expectedArtist.includes(candidate);
      })) return [];
      const releases = compatibleReleases(recording, input.album);
      if (input.album && !releases.length) return [];
      const isrcs = strings(recording.isrcs);
      if (expectedIsrc && !isrcs.some((isrc) => normalize(isrc) === expectedIsrc)) return [];
      const duration = durationSeconds(recording.length);
      if (input.duration_seconds && duration && Math.abs(duration - input.duration_seconds) > 2) return [];
      const disambiguation = typeof recording.disambiguation === "string" ? recording.disambiguation : "";
      const strength = variantStrength(requestedVariant, `${recording.title} ${disambiguation}`);
      if (strength === null) return [];
      return [{ recording, releases, strength, searchScore: Number(recording.score) || 0 }];
    }).sort((left, right) => right.strength - left.strength || right.searchScore - left.searchScore);

    const snapshots = ranked.slice(0, 8).map(({ recording }) => candidateSnapshot(recording));
    if (!ranked.length) {
      const value: RecordingCatalogResolution = {
        status: "not_found",
        reason: "no_compatible_recording",
        metadata: null,
        candidates: []
      };
      this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
      return value;
    }

    const strongest = ranked.filter((candidate) => candidate.strength === ranked[0].strength);
    if (strongest.length !== 1) {
      const value: RecordingCatalogResolution = {
        status: "conflict",
        reason: "multiple_compatible_recordings",
        metadata: null,
        candidates: snapshots
      };
      this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
      return value;
    }

    const selected = strongest[0];
    const detailUrl = new URL(`https://musicbrainz.org/ws/2/recording/${selected.recording.id}`);
    detailUrl.searchParams.set("inc", "artist-credits+isrcs+releases+work-rels+genres+tags");
    detailUrl.searchParams.set("fmt", "json");
    const detail = await this.requestJson(detailUrl);
    const workRelation = records(detail.relations).find((relation) => objectValue(relation.work));
    const work = objectValue(workRelation?.work);
    let workDetail: JsonRecord | null = null;
    if (typeof work?.id === "string") {
      const workUrl = new URL(`https://musicbrainz.org/ws/2/work/${work.id}`);
      workUrl.searchParams.set("inc", "artist-rels+genres+tags");
      workUrl.searchParams.set("fmt", "json");
      workDetail = await this.requestJson(workUrl);
    }

    const relations = records(workDetail?.relations);
    const namesFor = (types: string[]) => Array.from(new Set(relations.flatMap((relation) => {
      if (!types.includes(String(relation.type || ""))) return [];
      const artist = objectValue(relation.artist);
      return typeof artist?.name === "string" ? [artist.name] : [];
    })));
    const recordingGenres = records(detail.genres);
    const workGenres = records(workDetail?.genres);
    const genres = Array.from(new Set([...recordingGenres, ...workGenres]
      .filter((genre) => Number(genre.count) > 0 && typeof genre.name === "string")
      .sort((left, right) => Number(right.count) - Number(left.count))
      .map((genre) => String(genre.name)))).slice(0, 8);
    const detailedReleases = compatibleReleases(detail, input.album);
    const releaseYears = detailedReleases
      .filter((release) => normalize(release.status) === "official" || !release.status)
      .map((release) => year(release.date))
      .filter((value): value is number => value !== null);
    const allReleaseYears = records(detail.releases)
      .filter((release) => normalize(release.status) === "official" || !release.status)
      .map((release) => year(release.date))
      .filter((value): value is number => value !== null);
    const disambiguation = typeof detail.disambiguation === "string" && detail.disambiguation.trim()
      ? detail.disambiguation
      : null;
    const isrcs = strings(detail.isrcs);
    const composers = namesFor(["composer", "writer"]);
    const lyricists = namesFor(["lyricist"]);
    const metadata: RecordingCatalogMetadata = {
      recording_id: String(detail.id || selected.recording.id),
      title: String(detail.title || selected.recording.title),
      artist: artistNames(detail["artist-credit"])[0] || input.artist || null,
      album: input.album || (typeof detailedReleases[0]?.title === "string" ? detailedReleases[0].title : null),
      disambiguation,
      duration_seconds: durationSeconds(detail.length),
      release_year: releaseYears.length ? Math.min(...releaseYears) : null,
      original_release_year: allReleaseYears.length ? Math.min(...allReleaseYears) : null,
      isrc: isrcs[0] || null,
      isrcs,
      composers,
      lyricists,
      genres,
      confidence: input.album || expectedIsrc ? "high" : "medium"
    };
    const value: RecordingCatalogResolution = {
      status: "exact",
      reason: "unique_compatible_recording",
      metadata,
      candidates: [candidateSnapshot(detail)]
    };
    this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  }
}
