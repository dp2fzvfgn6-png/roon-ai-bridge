import { APP_VERSION } from "../config/version";

export type RecordingCatalogMetadata = {
  recording_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration_seconds: number | null;
  release_year: number | null;
  isrc: string | null;
  confidence: "high" | "medium";
};

type FetchLike = typeof fetch;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 1100;

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
  const match = String(value || "").match(/^(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function artistNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((credit) => {
    if (!credit || typeof credit !== "object") return [];
    const record = credit as Record<string, unknown>;
    const artist = record.artist && typeof record.artist === "object"
      ? record.artist as Record<string, unknown>
      : null;
    const name = typeof record.name === "string"
      ? record.name
      : typeof artist?.name === "string"
        ? artist.name
        : null;
    return name ? [name] : [];
  });
}

export class RecordingMetadataService {
  private readonly cache = new Map<string, { expiresAt: number; value: RecordingCatalogMetadata | null }>();
  private requestChain: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async lookup(input: { title: string; artist: string; album?: string | null }): Promise<RecordingCatalogMetadata | null> {
    const cacheKey = [normalize(input.title), normalize(input.artist), normalize(input.album)].join("|");
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let releaseRequest: () => void = () => undefined;
    const previous = this.requestChain;
    this.requestChain = new Promise<void>((resolve) => { releaseRequest = resolve; });
    await previous;
    try {
      const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt));
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const terms = [
          `recording:"${lucene(input.title)}"`,
          `artist:"${lucene(input.artist)}"`,
          input.album ? `release:"${lucene(input.album)}"` : ""
        ].filter(Boolean);
        const url = new URL("https://musicbrainz.org/ws/2/recording");
        url.searchParams.set("query", terms.join(" AND "));
        url.searchParams.set("fmt", "json");
        url.searchParams.set("limit", "100");
        const response = await this.fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": `RoonAI-Bridge/${APP_VERSION} (https://github.com/dp2fzvfgn6-png/roon-ai-bridge)`
          },
          signal: controller.signal
        });
        this.lastRequestAt = Date.now();
        if (!response.ok) throw new Error(`MusicBrainz returned HTTP ${response.status}`);
        const body = await response.json() as Record<string, unknown>;
        const recordings = Array.isArray(body.recordings) ? body.recordings : [];
        const expectedTitle = normalize(input.title);
        const expectedArtist = normalize(input.artist);
        const expectedAlbum = normalize(input.album);
        const ranked = recordings.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const recording = entry as Record<string, unknown>;
          if (typeof recording.id !== "string" || typeof recording.title !== "string") return [];
          if (normalize(recording.title) !== expectedTitle) return [];
          const artists = artistNames(recording["artist-credit"]);
          if (artists.length && !artists.some((artist) => {
            const candidate = normalize(artist);
            return candidate === expectedArtist || candidate.includes(expectedArtist) || expectedArtist.includes(candidate);
          })) return [];
          const releases = Array.isArray(recording.releases)
            ? recording.releases.filter((release): release is Record<string, unknown> => Boolean(release && typeof release === "object"))
            : [];
          const exactReleases = expectedAlbum
            ? releases.filter((release) => normalize(release.title) === expectedAlbum)
            : releases;
          if (expectedAlbum && !exactReleases.length) return [];
          const durationMs = Number(recording.length);
          const durationSeconds = Number.isFinite(durationMs) && durationMs >= 30_000 && durationMs <= 30 * 60_000
            ? Math.round(durationMs / 1000)
            : null;
          const official = exactReleases.filter((release) => normalize(release.status) === "official").length;
          const releaseYears = exactReleases.map((release) => year(release.date)).filter((value): value is number => value !== null);
          const score = Number(recording.score) || 0;
          const rank = score + Math.min(releases.length, 30) + Math.min(official, 5) * 4 + (durationSeconds ? 10 : 0);
          const isrcs = Array.isArray(recording.isrcs)
            ? recording.isrcs.filter((value): value is string => typeof value === "string" && value.trim() !== "")
            : [];
          return [{
            rank,
            value: {
              recording_id: recording.id,
              title: recording.title,
              artist: artists[0] || input.artist || null,
              album: input.album || (typeof exactReleases[0]?.title === "string" ? exactReleases[0].title : null),
              duration_seconds: durationSeconds,
              release_year: releaseYears.length ? Math.min(...releaseYears) : null,
              isrc: isrcs[0] || null,
              confidence: expectedAlbum && exactReleases.length && durationSeconds ? "high" as const : "medium" as const
            }
          }];
        }).sort((left, right) => right.rank - left.rank);
        const value = ranked[0]?.value || null;
        this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
        return value;
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      releaseRequest();
    }
  }
}
