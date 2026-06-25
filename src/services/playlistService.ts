import fs from "fs";
import path from "path";
import { AppConfig } from "../config/env";
import { playByQuery, queueByQuery } from "../roon/roonBrowseService";
import { RoonClient } from "../roon/roonClient";
import { ApiError } from "../utils/errors";

export const playlistServiceImplemented = true;

export type VirtualPlaylistTrack = {
  track_id: string;
  query: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  position: number;
  created_at: string;
};

export type VirtualPlaylist = {
  playlist_id: string;
  name: string;
  description: string | null;
  tracks: VirtualPlaylistTrack[];
  created_at: string;
  updated_at: string;
};

export type PlaylistPlayMode = "add_to_queue" | "add_next" | "play_now";

type PlaylistStore = {
  playlists: VirtualPlaylist[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeTrackPositions(playlist: VirtualPlaylist): VirtualPlaylist {
  playlist.tracks = playlist.tracks
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((track, index) => ({
      ...track,
      position: index + 1
    }));
  return playlist;
}

export class PlaylistService {
  private readonly filePath: string;

  constructor(config: AppConfig) {
    this.filePath = path.join(config.dataDir, "virtual-playlists.json");
  }

  private ensureDataDir(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  private readStore(): PlaylistStore {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (parsed && Array.isArray(parsed.playlists)) {
        return parsed as PlaylistStore;
      }
    } catch {
      // Fall through to an empty store.
    }

    return { playlists: [] };
  }

  private writeStore(store: PlaylistStore): void {
    this.ensureDataDir();
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2));
    fs.renameSync(tempPath, this.filePath);
  }

  private getPlaylistOrThrow(store: PlaylistStore, playlistId: string): VirtualPlaylist {
    const playlist = store.playlists.find((item) => item.playlist_id === playlistId);
    if (!playlist) {
      throw new ApiError("PLAYLIST_NOT_FOUND", "Virtual playlist not found", {
        playlist_id: playlistId
      });
    }
    return normalizeTrackPositions(playlist);
  }

  listPlaylists(): VirtualPlaylist[] {
    return this.readStore().playlists.map(normalizeTrackPositions);
  }

  getPlaylist(playlistId: string): VirtualPlaylist {
    return this.getPlaylistOrThrow(this.readStore(), playlistId);
  }

  createPlaylist(input: {
    playlist_id?: unknown;
    name?: unknown;
    description?: unknown;
    tracks?: unknown;
  }): VirtualPlaylist {
    const name = nonEmptyString(input.name);
    if (!name) {
      throw new ApiError("INVALID_PLAYLIST", "Playlist name is required");
    }

    const store = this.readStore();
    const baseId =
      nonEmptyString(input.playlist_id) || slugify(name) || `playlist-${randomSuffix()}`;
    let playlistId = baseId;
    while (store.playlists.some((item) => item.playlist_id === playlistId)) {
      playlistId = `${baseId}-${randomSuffix()}`;
    }

    const createdAt = nowIso();
    const playlist: VirtualPlaylist = {
      playlist_id: playlistId,
      name,
      description: optionalString(input.description),
      tracks: [],
      created_at: createdAt,
      updated_at: createdAt
    };

    if (Array.isArray(input.tracks)) {
      for (const track of input.tracks) {
        this.addTrackToPlaylistObject(playlist, track);
      }
    }

    store.playlists.push(normalizeTrackPositions(playlist));
    this.writeStore(store);
    return playlist;
  }

  addTrack(playlistId: string, input: unknown): VirtualPlaylist {
    const store = this.readStore();
    const playlist = this.getPlaylistOrThrow(store, playlistId);
    this.addTrackToPlaylistObject(playlist, input);
    playlist.updated_at = nowIso();
    normalizeTrackPositions(playlist);
    this.writeStore(store);
    return playlist;
  }

  removeTrack(playlistId: string, trackId: string): VirtualPlaylist {
    const store = this.readStore();
    const playlist = this.getPlaylistOrThrow(store, playlistId);
    const before = playlist.tracks.length;
    playlist.tracks = playlist.tracks.filter((track) => track.track_id !== trackId);

    if (playlist.tracks.length === before) {
      throw new ApiError("PLAYLIST_TRACK_NOT_FOUND", "Virtual playlist track not found", {
        playlist_id: playlistId,
        track_id: trackId
      });
    }

    playlist.updated_at = nowIso();
    normalizeTrackPositions(playlist);
    this.writeStore(store);
    return playlist;
  }

  deletePlaylist(playlistId: string): { ok: true; playlist_id: string } {
    const store = this.readStore();
    const before = store.playlists.length;
    store.playlists = store.playlists.filter(
      (playlist) => playlist.playlist_id !== playlistId
    );

    if (store.playlists.length === before) {
      throw new ApiError("PLAYLIST_NOT_FOUND", "Virtual playlist not found", {
        playlist_id: playlistId
      });
    }

    this.writeStore(store);
    return { ok: true, playlist_id: playlistId };
  }

  async playPlaylist(
    roonClient: RoonClient,
    playlistId: string,
    input: { zone_id?: unknown; mode?: unknown; limit?: unknown; session_key?: unknown }
  ): Promise<Record<string, unknown>> {
    const playlist = this.getPlaylist(playlistId);
    const zoneId = nonEmptyString(input.zone_id);
    if (!zoneId) {
      throw new ApiError("ZONE_NOT_FOUND", "zone_id is required");
    }

    const mode = this.parsePlayMode(input.mode);
    const limit =
      typeof input.limit === "number" && Number.isFinite(input.limit)
        ? Math.max(1, Math.min(Math.floor(input.limit), playlist.tracks.length))
        : playlist.tracks.length;
    const tracks = playlist.tracks.slice(0, limit);
    const results: Record<string, unknown>[] = [];
    const failures: Record<string, unknown>[] = [];
    const sessionPrefix =
      nonEmptyString(input.session_key) ||
      `roon-ai-bridge-playlist-${playlist.playlist_id}-${Date.now().toString(36)}`;

    if (mode === "play_now" && tracks.length > 0) {
      await this.applyTrack(
        roonClient,
        zoneId,
        tracks[0],
        "play_now",
        `${sessionPrefix}-0`,
        results,
        failures
      );

      for (const [index, track] of tracks.slice(1).entries()) {
        await this.applyTrack(
          roonClient,
          zoneId,
          track,
          "add_to_queue",
          `${sessionPrefix}-${index + 1}`,
          results,
          failures
        );
      }
    } else {
      const orderedTracks = mode === "add_next" ? tracks.slice().reverse() : tracks;
      for (const [index, track] of orderedTracks.entries()) {
        await this.applyTrack(
          roonClient,
          zoneId,
          track,
          mode,
          `${sessionPrefix}-${index}`,
          results,
          failures
        );
      }
    }

    return {
      ok: failures.length === 0,
      playlist_id: playlist.playlist_id,
      zone_id: zoneId,
      mode,
      requested: tracks.length,
      succeeded: results.length,
      failed: failures.length,
      results,
      failures
    };
  }

  private parsePlayMode(value: unknown): PlaylistPlayMode {
    if (value === undefined || value === null || value === "") return "add_to_queue";
    if (value === "add_to_queue" || value === "add_next" || value === "play_now") {
      return value;
    }

    throw new ApiError("INVALID_PLAYLIST_PLAY_MODE", "Unsupported playlist play mode", {
      allowed: ["add_to_queue", "add_next", "play_now"]
    });
  }

  private addTrackToPlaylistObject(playlist: VirtualPlaylist, input: unknown): void {
    if (!input || typeof input !== "object") {
      throw new ApiError("INVALID_PLAYLIST_TRACK", "Track must be an object");
    }

    const payload = input as Record<string, unknown>;
    const query = nonEmptyString(payload.query);
    if (!query) {
      throw new ApiError("INVALID_PLAYLIST_TRACK", "Track query is required");
    }

    const now = nowIso();
    playlist.tracks.push({
      track_id: nonEmptyString(payload.track_id) || `track-${randomSuffix()}`,
      query,
      title: optionalString(payload.title),
      artist: optionalString(payload.artist),
      album: optionalString(payload.album),
      position:
        typeof payload.position === "number" && Number.isFinite(payload.position)
          ? Math.floor(payload.position)
          : playlist.tracks.length + 1,
      created_at: now
    });
  }

  private async applyTrack(
    roonClient: RoonClient,
    zoneId: string,
    track: VirtualPlaylistTrack,
    mode: PlaylistPlayMode,
    sessionKey: string,
    results: Record<string, unknown>[],
    failures: Record<string, unknown>[]
  ): Promise<void> {
    try {
      if (mode === "play_now") {
        const result = await playByQuery(roonClient, {
          zoneId,
          query: track.query,
          sessionKey
        });
        results.push({ track, result });
        return;
      }

      const result = await queueByQuery(roonClient, {
        zoneId,
        query: track.query,
        mode,
        sessionKey
      });
      results.push({ track, result });
    } catch (error) {
      if (error instanceof ApiError) {
        failures.push({
          track,
          error: {
            code: error.code,
            message: error.message,
            details: error.details
          }
        });
        return;
      }

      failures.push({
        track,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }
}
