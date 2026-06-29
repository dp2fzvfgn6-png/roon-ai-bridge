import { ApiError } from "../utils/errors";
import { PublicZone, RoonZone } from "./roonTypes";
import { RoonClient } from "./roonClient";
import { requireTransport } from "./roonTransportService";

export function formatZone(zone: RoonZone): PublicZone {
  const nowPlaying = zone.now_playing?.three_line || {};

  return {
    zone_id: zone.zone_id,
    display_name: zone.display_name,
    state: zone.state,
    now_playing: {
      line1: nowPlaying.line1 || null,
      line2: nowPlaying.line2 || null,
      line3: nowPlaying.line3 || null,
      image_key: zone.now_playing?.image_key || null,
      seek_position:
        typeof zone.now_playing?.seek_position === "number"
          ? zone.now_playing.seek_position
          : null,
      length:
        typeof zone.now_playing?.length === "number"
          ? zone.now_playing.length
          : null
    },
    outputs: zone.outputs || [],
    playback_settings: {
      shuffle:
        typeof zone.settings?.shuffle === "boolean"
          ? zone.settings.shuffle
          : null,
      auto_radio:
        typeof zone.settings?.auto_radio === "boolean"
          ? zone.settings.auto_radio
          : null,
      loop: zone.settings?.loop || null
    }
  };
}

export function listZones(roonClient: RoonClient): PublicZone[] {
  requireTransport(roonClient);
  return roonClient.getZones().map(formatZone);
}

export function getZoneOrThrow(roonClient: RoonClient, zoneId: string): RoonZone {
  requireTransport(roonClient);
  const zone = roonClient.getZone(zoneId);
  if (!zone) {
    throw new ApiError("ZONE_NOT_FOUND", "Zone not found", { zone_id: zoneId });
  }
  return zone;
}
