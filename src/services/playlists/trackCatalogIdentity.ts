import type { RecordingCatalogResolution } from "../recordingMetadataService";
import type { CatalogReleaseResolution } from "../catalogReleaseMetadataService";
import type { VirtualPlaylistTrack } from "./playlistContracts";

export type CatalogCredit = {
  name: string;
  role: "primary" | "featured" | "performer" | "composer" | "lyricist" | "unclassified";
  source: "intent" | "musicbrainz" | "roon_display";
};

export type TrackCatalogIntent = {
  title: string;
  primary_artists: string[];
  featured_artists: string[];
  album_hint: string | null;
  release_year_hint: number | null;
  recording_intent: string;
  source: "llm_hints" | "stored_query" | "verified_recording" | "stored_artist" | "unknown";
};

export type TrackCatalogIdentityV2 = {
  version: 2;
  shadow: true;
  status: "exact_recording" | "candidate_recording" | "ambiguous_recording" | "not_found" | "insufficient_input" | "provider_error";
  intent: TrackCatalogIntent;
  recording: {
    musicbrainz_id: string;
    title: string;
    primary_artists: string[];
    credited_artists: string[];
    artist_credit: Array<{
      musicbrainz_id: string | null;
      name: string;
      join_phrase: string;
    }>;
    disambiguation: string | null;
    duration_seconds: number | null;
    isrcs: string[];
  } | null;
  release: {
    musicbrainz_id: string | null;
    release_group_id: string | null;
    title: string;
    album_artist: string | null;
    release_year: number | null;
    original_release_year: number | null;
    medium_position: number | null;
    track_position: number | null;
    match_status: CatalogReleaseResolution["status"] | "roon_observation";
    duration: CatalogReleaseResolution["duration"] | null;
    cover_art: CatalogReleaseResolution["cover_art"] | null;
  } | null;
  credits: {
    primary_artists: CatalogCredit[];
    featured_artists: CatalogCredit[];
    composers: CatalogCredit[];
    lyricists: CatalogCredit[];
    performers: CatalogCredit[];
    roon_unclassified: CatalogCredit[];
  };
  roon_selection: {
    result_id: string | null;
    item_key: string | null;
    selection_origin: string | null;
    locked: boolean;
  };
  evidence: {
    recording: "musicbrainz" | null;
    release: "musicbrainz_release" | "musicbrainz_release_group" | "roon_observation" | null;
    credits: Array<"intent" | "musicbrainz" | "roon_display">;
  };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : null;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Map(values.filter((value): value is string => Boolean(value?.trim()))
    .map((value) => [value.toLocaleLowerCase(), value.trim()])).values());
}

function versionlessTitle(value: string): string {
  return value
    .replace(/\s*[([](?:remaster(?:ed)?|live|mono|stereo|mix|version|edit)[^\])]*[\])]\s*$/iu, "")
    .trim();
}

function artistFromStoredQuery(track: VirtualPlaylistTrack, titles: string[]): string | null {
  const query = track.query.trim();
  for (const candidate of unique(titles.flatMap((title) => [title, versionlessTitle(title)]))) {
    if (!candidate || query.length <= candidate.length) continue;
    if (query.slice(0, candidate.length).toLocaleLowerCase() !== candidate.toLocaleLowerCase()) continue;
    const remainder = query.slice(candidate.length).trim().replace(/^[-–—·:]+\s*/u, "");
    if (remainder) return remainder;
  }
  return null;
}

function requiredCredits(track: VirtualPlaylistTrack): Array<{ name: string; role: string }> {
  const hints = record(track.user_metadata?.llm_hints);
  return Array.isArray(hints?.required_credits)
    ? hints.required_credits.flatMap((entry) => {
        const credit = record(entry);
        const name = text(credit?.name);
        return name ? [{ name, role: text(credit?.role) || "primary" }] : [];
      })
    : [];
}

function selectedCandidate(track: VirtualPlaylistTrack): Record<string, unknown> | null {
  return record(track.resolution?.selected_candidate);
}

function recordingObservation(track: VirtualPlaylistTrack): Record<string, unknown> | null {
  const audio = record(track.audio_metadata);
  const enrichment = record(track.resolution?.metadata_enrichment);
  return record(audio?.recording) || record(enrichment?.recording);
}

function releaseObservation(track: VirtualPlaylistTrack): Record<string, unknown> | null {
  const audio = record(track.audio_metadata);
  const enrichment = record(track.resolution?.metadata_enrichment);
  return record(audio?.release) || record(enrichment?.release);
}

function roonDisplayCredits(track: VirtualPlaylistTrack): string[] {
  const selected = selectedCandidate(track);
  const structured = Array.isArray(selected?.artists)
    ? selected.artists.flatMap((entry) => {
        const artist = record(entry);
        return text(artist?.title) ? [text(artist?.title)!] : [];
      })
    : [];
  if (structured.length) return unique(structured);
  const display = text(selected?.artist) || text(selected?.subtitle) || track.artist;
  return unique((display || "").split(/\s*(?:,|;|·)\s*/u));
}

export function catalogIntentForTrack(track: VirtualPlaylistTrack): TrackCatalogIntent {
  const audio = record(track.audio_metadata);
  const recording = recordingObservation(track);
  const selected = selectedCandidate(track);
  const hints = record(track.user_metadata?.llm_hints);
  const credits = requiredCredits(track);
  const proposedPrimary = credits.filter((credit) => credit.role === "primary").map((credit) => credit.name);
  const proposedFeatured = credits.filter((credit) => credit.role === "featured").map((credit) => credit.name);
  const title = text(recording?.title) || text(track.title) || text(audio?.title) || track.query;
  const fromQuery = artistFromStoredQuery(track, unique([
    text(track.title), text(audio?.title), text(recording?.title), text(selected?.title)
  ]));
  const storedArtist = text(track.artist) || text(audio?.artist) || text(selected?.artist);
  const singleStoredArtist = storedArtist && !/[,;·]/u.test(storedArtist) ? storedArtist : null;
  const verifiedArtist = text(recording?.artist);
  const primaryArtists = proposedPrimary.length
    ? proposedPrimary
    : fromQuery
      ? [fromQuery]
      : verifiedArtist
        ? [verifiedArtist]
        : singleStoredArtist
          ? [singleStoredArtist]
          : [];
  const source: TrackCatalogIntent["source"] = proposedPrimary.length
    ? "llm_hints"
    : fromQuery
      ? "stored_query"
      : verifiedArtist
        ? "verified_recording"
        : singleStoredArtist
          ? "stored_artist"
          : "unknown";
  const hintedAlbum = text(hints?.album);
  return {
    title,
    primary_artists: unique(primaryArtists),
    featured_artists: unique(proposedFeatured),
    album_hint: hintedAlbum,
    release_year_hint: integer(hints?.release_year),
    recording_intent: text(hints?.recording_intent) || text(track.identity?.version_hint) || "standard",
    source
  };
}

function credits(names: string[], role: CatalogCredit["role"], source: CatalogCredit["source"]): CatalogCredit[] {
  return unique(names).map((name) => ({ name, role, source }));
}

export function trackCatalogIdentityV2(
  track: VirtualPlaylistTrack,
  intent: TrackCatalogIntent,
  result: RecordingCatalogResolution | null,
  providerError = false,
  releaseResult: CatalogReleaseResolution | null = null
): TrackCatalogIdentityV2 {
  const metadata = result?.status === "exact" ? result.metadata : null;
  const roonRelease = releaseObservation(track);
  const catalogRelease = releaseResult?.release;
  const catalogGroup = releaseResult?.release_group;
  const status: TrackCatalogIdentityV2["status"] = providerError
    ? "provider_error"
    : !intent.primary_artists.length
      ? "insufficient_input"
      : result?.status === "exact"
        ? result.metadata?.confidence === "high" ? "exact_recording" : "candidate_recording"
        : result?.status === "conflict"
          ? "ambiguous_recording"
          : "not_found";
  const origin = text(track.resolution?.selection_origin);
  const sources = new Set<"intent" | "musicbrainz" | "roon_display">(["roon_display"]);
  if (intent.primary_artists.length) sources.add("intent");
  if (metadata) sources.add("musicbrainz");
  return {
    version: 2,
    shadow: true,
    status,
    intent,
    recording: metadata ? {
      musicbrainz_id: metadata.recording_id,
      title: metadata.title,
      primary_artists: unique(metadata.artists?.length ? metadata.artists : [metadata.artist]),
      credited_artists: unique(metadata.artists?.length ? metadata.artists : [metadata.artist]),
      artist_credit: metadata.artist_credit || [],
      disambiguation: metadata.disambiguation,
      duration_seconds: metadata.duration_seconds,
      isrcs: metadata.isrcs
    } : null,
    release: catalogRelease || catalogGroup ? {
      musicbrainz_id: catalogRelease?.release_id || null,
      release_group_id: catalogRelease?.release_group_id || catalogGroup?.musicbrainz_id || null,
      title: catalogRelease?.title || catalogGroup?.title || "",
      album_artist: catalogRelease?.album_artist || null,
      release_year: catalogRelease?.release_year || null,
      original_release_year: metadata?.original_release_year || null,
      medium_position: catalogRelease?.medium_position || null,
      track_position: catalogRelease?.track_position || null,
      match_status: releaseResult!.status,
      duration: releaseResult!.duration,
      cover_art: releaseResult!.cover_art
    } : roonRelease && text(roonRelease.title) ? {
      musicbrainz_id: null,
      release_group_id: null,
      title: text(roonRelease.title)!,
      album_artist: text(roonRelease.album_artist),
      release_year: integer(roonRelease.release_year),
      original_release_year: integer(roonRelease.original_release_year),
      medium_position: integer(roonRelease.disc_number),
      track_position: integer(roonRelease.track_number),
      match_status: "roon_observation",
      duration: null,
      cover_art: null
    } : null,
    credits: {
      primary_artists: credits(intent.primary_artists, "primary", "intent"),
      featured_artists: credits(intent.featured_artists, "featured", "intent"),
      composers: credits(metadata?.composers || [], "composer", "musicbrainz"),
      lyricists: credits(metadata?.lyricists || [], "lyricist", "musicbrainz"),
      performers: [],
      roon_unclassified: credits(roonDisplayCredits(track), "unclassified", "roon_display")
    },
    roon_selection: {
      result_id: text(track.resolution?.selected_result_id),
      item_key: track.roon_binding?.item_key || null,
      selection_origin: origin,
      locked: origin === "portal_user" || origin === "model" || track.resolution?.status === "manual"
    },
    evidence: {
      recording: metadata ? "musicbrainz" : null,
      release: catalogRelease
        ? "musicbrainz_release"
        : catalogGroup
          ? "musicbrainz_release_group"
          : roonRelease
            ? "roon_observation"
            : null,
      credits: Array.from(sources)
    }
  };
}
