import { PlaybackCommand } from "../utils/validation";
import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";
import { RoonZone } from "./roonTypes";
import { getZoneOrThrow } from "./roonZoneService";
import { requireTransport } from "./roonTransportService";

function commandAllowed(zone: RoonZone, command: PlaybackCommand): boolean {
  if (command === "playpause" || command === "stop") return true;
  const flag = `is_${command}_allowed`;
  return zone[flag] !== false;
}

export async function controlPlayback(
  roonClient: RoonClient,
  zoneId: string,
  command: PlaybackCommand
): Promise<void> {
  const transport = requireTransport(roonClient);
  const zone = getZoneOrThrow(roonClient, zoneId);

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
}
