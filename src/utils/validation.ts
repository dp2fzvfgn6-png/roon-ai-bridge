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

export function parseVolumeMode(
  value: unknown
): "relative" | "absolute" | "relative_step" {
  if (
    value === "relative" ||
    value === "absolute" ||
    value === "relative_step"
  ) {
    return value;
  }

  throw new ApiError("INVALID_VOLUME_MODE", "Unsupported volume mode", {
    allowed: ["relative", "absolute", "relative_step"]
  });
}

export function parseVolumeValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  throw new ApiError("INVALID_VOLUME_VALUE", "Volume value must be a finite number");
}
