import { RoonZone } from "./roonTypes";

export function applyZoneEvent(
  current: Map<string, RoonZone>,
  event: string | false,
  data: any
): Map<string, RoonZone> {
  if (event === "Subscribed" && Array.isArray(data?.zones)) {
    return new Map(data.zones.map((zone: RoonZone) => [zone.zone_id, zone]));
  }
  if (event === "Unsubscribed") return new Map();

  const next = new Map(current);
  for (const zoneId of data?.zones_removed || []) next.delete(zoneId);
  for (const zone of data?.zones_added || []) next.set(zone.zone_id, zone);
  for (const zone of data?.zones_changed || []) next.set(zone.zone_id, zone);
  for (const seek of data?.zones_seek_changed || []) {
    const zone = next.get(seek.zone_id);
    if (!zone) continue;
    next.set(seek.zone_id, {
      ...zone,
      queue_time_remaining: seek.queue_time_remaining,
      now_playing: zone.now_playing
        ? { ...zone.now_playing, seek_position: seek.seek_position }
        : zone.now_playing
    });
  }
  return next;
}
