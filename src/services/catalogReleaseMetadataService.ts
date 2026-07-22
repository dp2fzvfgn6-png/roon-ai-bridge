import type {
  RecordingCatalogReleaseCandidate,
  RecordingCatalogResolution,
  RecordingMetadataService,
  CatalogProviderTrace,
  ReleaseTrackCatalogMetadata
} from "./recordingMetadataService";
import type { TrackCatalogIntent } from "./playlists/trackCatalogIdentity";
import type { VirtualPlaylistTrack } from "./playlists/playlistContracts";

export type CatalogReleaseResolution = {
  status: "exact_release" | "release_group_candidate" | "ambiguous_release" | "anchor_conflict" | "not_found" | "insufficient_evidence" | "recording_unresolved" | "provider_error";
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
  candidate_provider_trace: CatalogProviderTrace | null;
  provider_trace: CatalogProviderTrace | null;
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
    .replace(/\s*[([](?:19|20)\d{2}[\])]\s*$/u, " ")
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
  const firstInteger = (...values: unknown[]) => values
    .map(integer)
    .find((value): value is number => value !== null) ?? null;
  return {
    album: text(release?.title) || text(audio?.album) || text(track.album) || text(track.identity?.album),
    albumArtist: text(release?.album_artist) || text(audio?.album_artist) || text(track.identity?.album_artist),
    releaseYear: firstInteger(release?.release_year, audio?.release_year, track.identity?.release_year),
    mediumPosition: firstInteger(release?.disc_number, audio?.disc_number, track.identity?.disc_number),
    trackPosition: firstInteger(release?.track_number, audio?.track_number, track.identity?.track_number),
    coverImageKey: text(track.image_key) || text(audio?.image_key)
  };
}

function artistEquivalent(left: unknown, right: unknown): boolean {
  const withoutArticle = (value: unknown) => normalizedRelease(value).replace(/^the\s+/, "");
  const normalizedLeft = withoutArticle(left);
  const normalizedRight = withoutArticle(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function mergeProviderTraces(traces: CatalogProviderTrace[]): CatalogProviderTrace | null {
  if (!traces.length) return null;
  if (traces.length === 1) return traces[0];
  const layers = new Set(traces.map((trace) => trace.cache_layer));
  return {
    cache_hit: traces.every((trace) => trace.cache_hit),
    cache_layer: traces.every((trace) => trace.cache_hit) && layers.size === 1
      ? traces[0].cache_layer
      : null,
    elapsed_ms: traces.reduce((total, trace) => total + trace.elapsed_ms, 0),
    provider_requests: traces.reduce((total, trace) => total + trace.provider_requests, 0),
    search_attempts: traces.flatMap((trace) => trace.search_attempts),
    candidate_counts: {
      returned: traces.reduce((total, trace) => total + trace.candidate_counts.returned, 0),
      accepted: traces.reduce((total, trace) => total + trace.candidate_counts.accepted, 0),
      rejected: traces.reduce((total, trace) => total + trace.candidate_counts.rejected, 0)
    },
    rejected_candidates: traces.flatMap((trace) => trace.rejected_candidates).slice(0, 12),
    accepted_warnings: Array.from(new Set(traces.flatMap((trace) => trace.accepted_warnings)))
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
    candidateTrace?: CatalogProviderTrace | null;
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
    candidate_provider_trace: input.candidateTrace || null,
    provider_trace: null,
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
    const observedEditionMatchesAnchor = Boolean(
      observed.album && anchorTitle
      && normalizedRelease(observed.album) === normalizedRelease(anchorTitle)
    );
    const observedEditionYear = observedEditionMatchesAnchor ? observed.releaseYear : null;
    const anchorYear = intent.release_year_hint ?? observedEditionYear;
    const recording = recordingResult.status === "exact" ? recordingResult.metadata : null;
    let candidates = dedupeCandidates((recording?.release_candidates || []).filter(official));
    let candidateTrace: CatalogProviderTrace | null = null;
    const candidateTraces: CatalogProviderTrace[] = [];
    const base = () => ({
      anchorSource,
      anchorTitle,
      anchorYear,
      observedAlbum: observed.album,
      observedYear: observed.releaseYear,
      observedCover: observed.coverImageKey,
      candidates,
      candidateTrace
    });
    if (!recording) return emptyResolution("recording_unresolved", "recording_must_be_resolved_first", base());
    if (!anchorTitle) {
      return emptyResolution("insufficient_evidence", "release_title_anchor_is_required", base());
    }

    let titleMatches = candidates.filter((candidate) => normalizedRelease(candidate.title) === normalizedRelease(anchorTitle));
    if (!titleMatches.length) {
      try {
        const targeted = await this.recordingMetadataService.findRecordingReleasesByTitle(
          recording.recording_id,
          anchorTitle
        );
        candidateTraces.push(targeted.trace);
        candidateTrace = mergeProviderTraces(candidateTraces);
        candidates = dedupeCandidates([...candidates, ...targeted.releases.filter(official)]);
        titleMatches = candidates.filter((candidate) => normalizedRelease(candidate.title) === normalizedRelease(anchorTitle));
      } catch (error) {
        return emptyResolution("provider_error", "release_anchor_provider_error", {
          ...base(),
          warnings: [error instanceof Error ? error.message : String(error)]
        });
      }
    }
    if (!titleMatches.length) {
      try {
        const complete = await this.recordingMetadataService.listRecordingReleases(recording.recording_id);
        candidateTraces.push(complete.trace);
        candidateTrace = mergeProviderTraces(candidateTraces);
        candidates = dedupeCandidates([...candidates, ...complete.releases.filter(official)]);
        titleMatches = candidates.filter((candidate) => normalizedRelease(candidate.title) === normalizedRelease(anchorTitle));
        if (!titleMatches.length && complete.truncated) {
          return emptyResolution("insufficient_evidence", "release_catalog_truncated_before_anchor", {
            ...base(),
            warnings: ["The bounded MusicBrainz release browse ended before the observed album could be verified."]
          });
        }
      } catch (error) {
        return emptyResolution("provider_error", "release_candidates_provider_error", {
          ...base(),
          warnings: [error instanceof Error ? error.message : String(error)]
        });
      }
    }
    candidateTrace = mergeProviderTraces(candidateTraces);
    if (!candidates.length) {
      return emptyResolution("not_found", "recording_has_no_official_release_candidates", base());
    }
    if (!titleMatches.length) {
      return emptyResolution(
        anchorSource === "roon_observation" ? "anchor_conflict" : "not_found",
        anchorSource === "roon_observation"
          ? "roon_observation_not_a_release_of_recording"
          : "release_title_not_present_for_recording",
        {
        ...base(),
        warnings: anchorSource === "roon_observation"
          ? ["The complete MusicBrainz release list does not contain the observed Roon album for this recording."]
          : []
      });
    }
    const groupKeys = new Set(titleMatches.map((candidate) => candidate.release_group_id || `release:${candidate.release_id}`));
    if (groupKeys.size !== 1) {
      return emptyResolution("ambiguous_release", "album_title_matches_multiple_release_groups", {
        ...base(),
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
    let editionEvidenceConflict = false;
    const editionWarnings: string[] = [];
    const narrowEdition = (
      value: number | null,
      predicate: (candidate: RecordingCatalogReleaseCandidate, value: number) => boolean,
      warning: string
    ) => {
      if (value === null) return;
      const matches = editionCandidates.filter((candidate) => predicate(candidate, value));
      if (matches.length) editionCandidates = matches;
      else {
        editionEvidenceConflict = true;
        editionWarnings.push(warning);
      }
    };
    narrowEdition(
      intent.release_year_hint ?? observedEditionYear,
      (candidate, value) => candidate.release_year === value,
      "The observed release year does not match any MusicBrainz edition in the resolved release group."
    );
    narrowEdition(
      observedEditionMatchesAnchor ? observed.mediumPosition : null,
      (candidate, value) => candidate.medium_position === value,
      "The observed disc number does not match any MusicBrainz edition candidate."
    );
    narrowEdition(
      observedEditionMatchesAnchor ? observed.trackPosition : null,
      (candidate, value) => candidate.track_position === value,
      "The observed track number does not match any MusicBrainz edition candidate."
    );
    if (observedEditionMatchesAnchor && observed.albumArtist) {
      const artistMatches = editionCandidates.filter((candidate) =>
        candidate.album_artist && artistEquivalent(candidate.album_artist, observed.albumArtist)
      );
      if (artistMatches.length) editionCandidates = artistMatches;
    }
    const selectedCandidate = !editionEvidenceConflict && editionCandidates.length === 1
      ? editionCandidates[0]
      : null;
    let release: ReleaseTrackCatalogMetadata | null = null;
    let releaseTrace: CatalogProviderTrace | null = null;
    let providerError: string | null = null;
    if (selectedCandidate) {
      try {
        const trackResult = await this.recordingMetadataService.lookupReleaseTrack(
          selectedCandidate.release_id,
          recording.recording_id
        );
        releaseTrace = trackResult.trace;
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
      ...editionWarnings,
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
      candidate_provider_trace: candidateTrace,
      provider_trace: releaseTrace,
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
