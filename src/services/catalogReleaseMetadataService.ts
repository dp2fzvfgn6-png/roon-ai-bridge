import type {
  RecordingCatalogReleaseCandidate,
  RecordingCatalogResolution,
  RecordingMetadataService,
  ReleaseTrackCatalogMetadata
} from "./recordingMetadataService";
import type { TrackCatalogIntent } from "./playlists/trackCatalogIdentity";
import type { VirtualPlaylistTrack } from "./playlists/playlistContracts";

export type CatalogReleaseResolution = {
  status: "exact_release" | "release_group_candidate" | "ambiguous_release" | "not_found" | "insufficient_evidence" | "recording_unresolved" | "provider_error";
  reason: string;
  anchor: {
    source: "intent_album_hint" | "roon_observation" | null;
    title: string | null;
    release_year: number | null;
    strength: "explicit" | "observed" | "none";
  };
  release_group: {
    musicbrainz_id: string | null;
    title: string;
    primary_type: string | null;
    secondary_types: string[];
  } | null;
  release: ReleaseTrackCatalogMetadata | null;
  duration: {
    seconds: number | null;
    source: "musicbrainz_release_track" | "musicbrainz_recording_median" | null;
    exact_for_release: boolean;
  };
  cover_art: {
    entity: "release" | "release_group";
    musicbrainz_id: string;
    source: "cover_art_archive";
    front_500_url: string;
    availability: "declared" | "unverified";
  } | null;
  observations: {
    roon_album: string | null;
    roon_release_year: number | null;
    roon_cover_image_key: string | null;
    album_title_coherence: "consistent" | "mismatch" | "unknown";
    cover_coherence: "unverified" | "no_roon_cover";
  };
  candidates: RecordingCatalogReleaseCandidate[];
  warnings: string[];
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

function normalizedRelease(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:super deluxe(?: edition)?|deluxe edition|expanded edition)\b/g, " ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function releaseObservation(track: VirtualPlaylistTrack): Record<string, unknown> | null {
  const audio = record(track.audio_metadata);
  const enrichment = record(track.resolution?.metadata_enrichment);
  return record(audio?.release) || record(enrichment?.release);
}

function observations(track: VirtualPlaylistTrack) {
  const audio = record(track.audio_metadata);
  const release = releaseObservation(track);
  return {
    album: text(release?.title) || text(audio?.album) || text(track.album) || text(track.identity?.album),
    releaseYear: integer(release?.release_year) || integer(audio?.release_year) || integer(track.identity?.release_year),
    coverImageKey: text(track.image_key) || text(audio?.image_key)
  };
}

function official(candidate: RecordingCatalogReleaseCandidate): boolean {
  return !candidate.status || normalizedRelease(candidate.status) === "official";
}

function dedupeCandidates(candidates: RecordingCatalogReleaseCandidate[]): RecordingCatalogReleaseCandidate[] {
  return Array.from(new Map(candidates.map((candidate) => [candidate.release_id, candidate])).values());
}

function emptyResolution(
  status: CatalogReleaseResolution["status"],
  reason: string,
  input: {
    anchorSource: CatalogReleaseResolution["anchor"]["source"];
    anchorTitle: string | null;
    anchorYear: number | null;
    observedAlbum: string | null;
    observedYear: number | null;
    observedCover: string | null;
    candidates: RecordingCatalogReleaseCandidate[];
    warnings?: string[];
  }
): CatalogReleaseResolution {
  return {
    status,
    reason,
    anchor: {
      source: input.anchorSource,
      title: input.anchorTitle,
      release_year: input.anchorYear,
      strength: input.anchorSource === "intent_album_hint" ? "explicit" : input.anchorSource === "roon_observation" ? "observed" : "none"
    },
    release_group: null,
    release: null,
    duration: { seconds: null, source: null, exact_for_release: false },
    cover_art: null,
    observations: {
      roon_album: input.observedAlbum,
      roon_release_year: input.observedYear,
      roon_cover_image_key: input.observedCover,
      album_title_coherence: "unknown",
      cover_coherence: input.observedCover ? "unverified" : "no_roon_cover"
    },
    candidates: input.candidates.slice(0, 12),
    warnings: input.warnings || []
  };
}

export class CatalogReleaseMetadataService {
  constructor(private readonly recordingMetadataService: RecordingMetadataService) {}

  async resolve(
    track: VirtualPlaylistTrack,
    intent: TrackCatalogIntent,
    recordingResult: RecordingCatalogResolution
  ): Promise<CatalogReleaseResolution> {
    const observed = observations(track);
    const explicitTitle = intent.album_hint;
    const anchorTitle = explicitTitle || observed.album;
    const anchorSource: CatalogReleaseResolution["anchor"]["source"] = explicitTitle
      ? "intent_album_hint"
      : observed.album
        ? "roon_observation"
        : null;
    const anchorYear = intent.release_year_hint;
    const recording = recordingResult.status === "exact" ? recordingResult.metadata : null;
    const candidates = dedupeCandidates((recording?.release_candidates || []).filter(official));
    const base = {
      anchorSource,
      anchorTitle,
      anchorYear,
      observedAlbum: observed.album,
      observedYear: observed.releaseYear,
      observedCover: observed.coverImageKey,
      candidates
    };
    if (!recording) return emptyResolution("recording_unresolved", "recording_must_be_resolved_first", base);
    if (!candidates.length) return emptyResolution("not_found", "recording_has_no_official_release_candidates", base);
    if (!anchorTitle) {
      return emptyResolution("insufficient_evidence", "release_title_anchor_is_required", base);
    }

    const titleMatches = candidates.filter((candidate) => normalizedRelease(candidate.title) === normalizedRelease(anchorTitle));
    if (!titleMatches.length) {
      return emptyResolution("not_found", "release_title_not_present_for_recording", {
        ...base,
        warnings: anchorSource === "roon_observation"
          ? ["The Roon album is an observation and did not match a MusicBrainz release for this recording."]
          : []
      });
    }
    const groupKeys = new Set(titleMatches.map((candidate) => candidate.release_group_id || `release:${candidate.release_id}`));
    if (groupKeys.size !== 1) {
      return emptyResolution("ambiguous_release", "album_title_matches_multiple_release_groups", {
        ...base,
        candidates: titleMatches
      });
    }

    const first = titleMatches[0];
    const group = {
      musicbrainz_id: first.release_group_id,
      title: first.title,
      primary_type: first.primary_type,
      secondary_types: first.secondary_types
    };
    let editionCandidates = titleMatches;
    if (intent.release_year_hint !== null) {
      const yearMatches = titleMatches.filter((candidate) => candidate.release_year === intent.release_year_hint);
      if (yearMatches.length) editionCandidates = yearMatches;
    }
    const selectedCandidate = editionCandidates.length === 1 ? editionCandidates[0] : null;
    let release: ReleaseTrackCatalogMetadata | null = null;
    let providerError: string | null = null;
    if (selectedCandidate) {
      try {
        const trackResult = await this.recordingMetadataService.lookupReleaseTrack(
          selectedCandidate.release_id,
          recording.recording_id
        );
        if (trackResult.status === "exact") release = trackResult.metadata;
      } catch (error) {
        providerError = error instanceof Error ? error.message : String(error);
      }
    }

    const exact = Boolean(release);
    const albumCoherence = observed.album
      ? normalizedRelease(observed.album) === normalizedRelease(group.title) ? "consistent" : "mismatch"
      : "unknown";
    const coverArt = release?.cover_art_archive.front
      ? {
          entity: "release" as const,
          musicbrainz_id: release.release_id,
          source: "cover_art_archive" as const,
          front_500_url: `https://coverartarchive.org/release/${release.release_id}/front-500`,
          availability: "declared" as const
        }
      : group.musicbrainz_id
        ? {
            entity: "release_group" as const,
            musicbrainz_id: group.musicbrainz_id,
            source: "cover_art_archive" as const,
            front_500_url: `https://coverartarchive.org/release-group/${group.musicbrainz_id}/front-500`,
            availability: "unverified" as const
          }
        : null;
    const warnings = [
      ...(anchorSource === "roon_observation"
        ? ["The release group is supported by a Roon album observation, not by an explicit playlist intent."]
        : []),
      ...(!exact
        ? ["No specific edition was selected; recording duration is a MusicBrainz median, not an edition track length."]
        : []),
      ...(observed.coverImageKey
        ? ["The Roon image key cannot yet be compared automatically with Cover Art Archive artwork."]
        : []),
      ...(providerError ? [`MusicBrainz release lookup failed: ${providerError}`] : [])
    ];
    return {
      status: providerError ? "provider_error" : exact ? "exact_release" : "release_group_candidate",
      reason: providerError
        ? "release_detail_provider_error"
        : exact
          ? "unique_release_and_track"
          : "release_group_identified_but_edition_is_ambiguous",
      anchor: {
        source: anchorSource,
        title: anchorTitle,
        release_year: anchorYear,
        strength: anchorSource === "intent_album_hint" ? "explicit" : "observed"
      },
      release_group: group,
      release,
      duration: release
        ? { seconds: release.duration_seconds, source: "musicbrainz_release_track", exact_for_release: true }
        : { seconds: recording.duration_seconds, source: "musicbrainz_recording_median", exact_for_release: false },
      cover_art: coverArt,
      observations: {
        roon_album: observed.album,
        roon_release_year: observed.releaseYear,
        roon_cover_image_key: observed.coverImageKey,
        album_title_coherence: albumCoherence,
        cover_coherence: observed.coverImageKey ? "unverified" : "no_roon_cover"
      },
      candidates: titleMatches.slice(0, 12),
      warnings
    };
  }
}
