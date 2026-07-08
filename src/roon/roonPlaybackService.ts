import { PlaybackCommand } from "../utils/validation";
import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";
import { RoonZone } from "./roonTypes";
import { getZoneOrThrow } from "./roonZoneService";
import { requireTransport } from "./roonTransportService";

export type PlaybackControlResult = {
  ok: true;
  zone_id: string;
  zone_name: string;
  command: PlaybackCommand;
  status: "changed" | "already_playing" | "already_paused" | "already_stopped" | "accepted";
  previous_state: string;
  state: string;
  state_verified: boolean;
};

function commandAllowed(zone: RoonZone, command: PlaybackCommand): boolean {
  if (command === "playpause" || command === "stop") return true;
  const flag = `is_${command}_allowed`;
  return zone[flag] !== false;
}

export async function controlPlayback(
  roonClient: RoonClient,
  zoneId: string,
  command: PlaybackCommand
): Promise<PlaybackControlResult> {
  const transport = requireTransport(roonClient);
  const zone = getZoneOrThrow(roonClient, zoneId);
  const previousState = zone.state;

  if (command === "pause" && previousState === "paused") {
    return {
      ok: true,
      zone_id: zone.zone_id,
      zone_name: zone.display_name,
      command,
      status: "already_paused",
      previous_state: previousState,
      state: previousState,
      state_verified: true
    };
  }

  if (command === "play" && previousState === "playing") {
    return {
      ok: true,
      zone_id: zone.zone_id,
      zone_name: zone.display_name,
      command,
      status: "already_playing",
      previous_state: previousState,
      state: previousState,
      state_verified: true
    };
  }

  if (command === "stop" && previousState === "stopped") {
    return {
      ok: true,
      zone_id: zone.zone_id,
      zone_name: zone.display_name,
      command,
      status: "already_stopped",
      previous_state: previousState,
      state: previousState,
      state_verified: true
    };
  }

  if (!commandAllowed(zone, command)) {
    throw new ApiError("UNSUPPORTED_COMMAND", "Command is not allowed for this zone", {
      zone_id: zoneId,
      command
    });
  }

  await new Promise<void>((resolve, reject) => {
    transport.control(zone, command, (error: unknown) => {
      if (error) {
        reject(new ApiError("INTERNAL_ERROR", String(error), { command }));
        return;
      }
      resolve();
    });
  });

  const expectedState =
    command === "play"
      ? "playing"
      : command === "pause"
        ? "paused"
        : command === "stop"
          ? "stopped"
          : command === "playpause"
            ? previousState === "playing"
              ? "paused"
              : "playing"
            : null;

  if (expectedState) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const current = roonClient.getZone(zoneId);
      if (current?.state === expectedState) {
        return {
          ok: true,
          zone_id: zone.zone_id,
          zone_name: zone.display_name,
          command,
          status: current.state === previousState ? "accepted" : "changed",
          previous_state: previousState,
          state: current.state,
          state_verified: true
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const actualState = roonClient.getZone(zoneId)?.state || "unknown";
    throw new ApiError(
      "PLAYBACK_STATE_NOT_CHANGED",
      "Roon accepted the command but the zone state did not change as expected",
      {
        zone_id: zoneId,
        zone_name: zone.display_name,
        command,
        previous_state: previousState,
        expected_state: expectedState,
        actual_state: actualState
      }
    );
  }

  return {
    ok: true,
    zone_id: zone.zone_id,
    zone_name: zone.display_name,
    command,
    status: "accepted",
    previous_state: previousState,
    state: roonClient.getZone(zoneId)?.state || zone.state,
    state_verified: false
  };
}
