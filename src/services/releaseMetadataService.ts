import { APP_VERSION } from "../config/version";
import type { ReleaseType } from "../roon/roonMediaService";

export type ReleaseCatalogEntry = {
  title: string;
  artists: string[];
  release_type: ReleaseType | null;
  release_year: number | null;
  score: number;
};

type FetchLike = typeof fetch;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 1100;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function releaseType(value: unknown): ReleaseType | null {
  const normalized = normalize(String(value || ""));
  if (normalized === "album") return "album";
  if (normalized === "ep") return "ep";
  if (normalized === "single") return "single";
  return null;
}

function releaseYear(value: unknown): number | null {
  const match = String(value || "").match(/^(19|20)\d{2}/);
  if (!match) return null;
  const year = Number(match[0]);
  return year <= new Date().getFullYear() + 1 ? year : null;
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

export function matchReleaseCatalog(
  entries: ReleaseCatalogEntry[],
  title: string,
  artists: string[]
): ReleaseCatalogEntry | null {
  const normalizedTitle = normalize(title);
  const normalizedArtists = artists.map(normalize).filter(Boolean);
  const titleMatches = entries.filter((entry) => normalize(entry.title) === normalizedTitle);
  const exact = normalizedArtists.length
    ? titleMatches.filter((entry) => entry.artists.length === 0 || entry.artists.some((artist) =>
      normalizedArtists.includes(normalize(artist))
    ))
    : titleMatches;
  if (!exact.length) return null;
  return exact.sort((a, b) => {
    const artistScore = (entry: ReleaseCatalogEntry) => entry.artists.some((artist) => {
      const candidate = normalize(artist);
      return normalizedArtists.includes(candidate);
    }) ? 1000 : 0;
    return artistScore(b) + b.score - artistScore(a) - a.score;
  })[0];
}

export class ReleaseMetadataService {
  private readonly cache = new Map<string, { expiresAt: number; entries: ReleaseCatalogEntry[] }>();
  private requestChain: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async listArtistReleases(artist: string): Promise<ReleaseCatalogEntry[]> {
    const cacheKey = normalize(artist);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.entries;

    let releaseRequest: () => void = () => undefined;
    const previous = this.requestChain;
    this.requestChain = new Promise<void>((resolve) => { releaseRequest = resolve; });
    await previous;
    try {
      const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt));
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const query = `artist:\"${artist.replace(/[\\\"]/g, "\\$&")}\"`;
        const url = new URL("https://musicbrainz.org/ws/2/release-group");
        url.searchParams.set("query", query);
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
        const groups = Array.isArray(body["release-groups"]) ? body["release-groups"] : [];
        const entries = groups.flatMap((group): ReleaseCatalogEntry[] => {
          if (!group || typeof group !== "object") return [];
          const record = group as Record<string, unknown>;
          if (typeof record.title !== "string") return [];
          return [{
            title: record.title,
            artists: artistNames(record["artist-credit"]),
            release_type: releaseType(record["primary-type"]),
            release_year: releaseYear(record["first-release-date"]),
            score: Number(record.score) || 0
          }];
        });
        this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, entries });
        return entries;
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      releaseRequest();
    }
  }
}
