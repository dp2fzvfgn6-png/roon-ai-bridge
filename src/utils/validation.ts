import { ApiError } from "./errors";

export const VALID_PLAYBACK_COMMANDS = [
  "play",
  "pause",
  "playpause",
  "stop",
  "next",
  "previous"
] as const;

export type PlaybackCommand = (typeof VALID_PLAYBACK_COMMANDS)[number];

export function parsePlaybackCommand(value: unknown): PlaybackCommand {
  if (
    typeof value === "string" &&
    (VALID_PLAYBACK_COMMANDS as readonly string[]).includes(value)
  ) {
    return value as PlaybackCommand;
  }

  throw new ApiError("UNSUPPORTED_COMMAND", "Unsupported playback command", {
    allowed: VALID_PLAYBACK_COMMANDS
  });
}

export function parseVolumeMode(value: unknown): "relative" | "absolute" {
  if (value === "relative" || value === "absolute") return value;

  throw new ApiError("INVALID_VOLUME_MODE", "Volume mode must be relative or absolute", {
    allowed: ["relative", "absolute"]
  });
}

export function parseVolumeValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  throw new ApiError("INVALID_VOLUME_VALUE", "Volume value must be a finite number");
}
