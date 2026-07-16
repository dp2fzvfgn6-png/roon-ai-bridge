import crypto from "crypto";
import { SqliteDatabase } from "../db/database";
import { RoonZone } from "../roon/roonTypes";

export type HomeHistoryEvent = {
  event_type: "search" | "play";
  media_type?: string | null;
  result_id?: string | null;
  playlist_id?: string | null;
  title: string;
  subtitle?: string | null;
  image_key?: string | null;
  query?: string | null;
  zone_id?: string | null;
  zone_name?: string | null;
};

export type HomeHistoryListOptions = {
  eventType?: HomeHistoryEvent["event_type"];
  limit?: number;
  offset?: number;
};

type ObservedZonePlayback = {
  fingerprint: string;
  seekPosition: number | null;
  recorded: boolean;
};

export class HomeHistoryService {
  private readonly maxEntries = { search: 100, play: 500 } as const;
  private readonly observedZones = new Map<string, ObservedZonePlayback>();

  constructor(private readonly database: SqliteDatabase) {}

  record(input: HomeHistoryEvent): Record<string, unknown> {
    const event = {
      history_id: `home_${crypto.randomBytes(9).toString("hex")}`,
      event_type: input.event_type,
      media_type: this.text(input.media_type, 40),
      result_id: this.text(input.result_id, 500),
      playlist_id: this.text(input.playlist_id, 200),
      title: this.requiredText(input.title, 300),
      subtitle: this.text(input.subtitle, 500),
      image_key: this.text(input.image_key, 2000),
      query: this.text(input.query, 300),
      zone_id: this.text(input.zone_id, 200),
      zone_name: this.text(input.zone_name, 200),
      created_at: new Date().toISOString()
    };
    this.database.db.prepare(`
      INSERT INTO home_history (
        history_id, event_type, media_type, result_id, playlist_id, title, subtitle,
        image_key, query, zone_id, zone_name, created_at
      ) VALUES (
        :history_id, :event_type, :media_type, :result_id, :playlist_id, :title, :subtitle,
        :image_key, :query, :zone_id, :zone_name, :created_at
      )
    `).run(event);
    this.database.db.prepare(`
      DELETE FROM home_history
      WHERE event_type = :event_type AND history_id NOT IN (
        SELECT history_id FROM home_history
        WHERE event_type = :event_type
        ORDER BY created_at DESC, rowid DESC
        LIMIT :max_entries
      )
    `).run({
      event_type: event.event_type,
      max_entries: this.maxEntries[event.event_type]
    });
    return event;
  }

  list(options: number | HomeHistoryListOptions = 8): Record<string, unknown> {
    const normalized = typeof options === "number" ? { limit: options } : options;
    const eventType = normalized.eventType;
    const maximum = eventType
      ? this.maxEntries[eventType]
      : this.maxEntries.search + this.maxEntries.play;
    const safeLimit = Math.max(1, Math.min(Number(normalized.limit) || 8, maximum));
    const safeOffset = Math.max(0, Math.floor(Number(normalized.offset) || 0));
    const where = eventType ? "WHERE event_type = :event_type" : "";
    const listParameters = eventType
      ? { event_type: eventType, limit: safeLimit, offset: safeOffset }
      : { limit: safeLimit, offset: safeOffset };
    const rows = this.database.db.prepare(`
      SELECT * FROM home_history ${where}
      ORDER BY created_at DESC, rowid DESC
      LIMIT :limit OFFSET :offset
    `).all(listParameters);
    const countStatement = this.database.db.prepare(`
      SELECT COUNT(*) AS count FROM home_history ${where}
    `);
    const total = (eventType
      ? countStatement.get({ event_type: eventType })
      : countStatement.get())?.count || 0;
    return {
      ok: true,
      entries: rows,
      total,
      limit: safeLimit,
      offset: safeOffset,
      event_type: eventType || null,
      max_entries: eventType ? maximum : this.maxEntries
    };
  }

  observeZones(zones: RoonZone[]): number {
    const currentZoneIds = new Set(zones.map((zone) => zone.zone_id));
    for (const zoneId of this.observedZones.keys()) {
      if (!currentZoneIds.has(zoneId)) this.observedZones.delete(zoneId);
    }

    let recorded = 0;
    for (const zone of zones) {
      const nowPlaying = zone.now_playing;
      const title = this.text(nowPlaying?.three_line?.line1, 300);
      if (!title) {
        this.observedZones.delete(zone.zone_id);
        continue;
      }

      const artist = this.text(nowPlaying?.three_line?.line2, 500);
      const album = this.text(nowPlaying?.three_line?.line3, 500);
      const imageKey = this.text(nowPlaying?.image_key, 2000);
      const fingerprint = JSON.stringify([title, artist, album, imageKey]);
      const seekPosition = typeof nowPlaying?.seek_position === "number"
        ? nowPlaying.seek_position
        : null;
      const previous = this.observedZones.get(zone.zone_id);
      const sameTrack = previous?.fingerprint === fingerprint;
      const restarted = Boolean(
        sameTrack &&
        seekPosition !== null &&
        seekPosition <= 5 &&
        previous?.seekPosition !== null &&
        previous?.seekPosition !== undefined &&
        previous.seekPosition - seekPosition > 15
      );
      const shouldRecord = zone.state === "playing" && (
        !sameTrack ||
        previous?.recorded !== true ||
        restarted
      );

      if (shouldRecord) {
        this.record({
          event_type: "play",
          media_type: "track",
          title,
          subtitle: artist || album,
          image_key: imageKey,
          zone_id: zone.zone_id,
          zone_name: zone.display_name
        });
        recorded += 1;
      }

      this.observedZones.set(zone.zone_id, {
        fingerprint,
        seekPosition,
        recorded: shouldRecord || (sameTrack && previous?.recorded === true)
      });
    }
    return recorded;
  }

  private text(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string") return null;
    const text = value.trim().slice(0, maxLength);
    return text || null;
  }

  private requiredText(value: unknown, maxLength: number): string {
    return this.text(value, maxLength) || "Música";
  }
}
