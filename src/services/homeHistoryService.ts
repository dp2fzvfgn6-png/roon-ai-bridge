import crypto from "crypto";
import { SqliteDatabase } from "../db/database";

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

export class HomeHistoryService {
  private readonly maxEntries = 100;

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
      DELETE FROM home_history WHERE history_id NOT IN (
        SELECT history_id FROM home_history ORDER BY created_at DESC LIMIT :max_entries
      )
    `).run({ max_entries: this.maxEntries });
    return event;
  }

  list(limit = 8): Record<string, unknown> {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 8, this.maxEntries));
    const rows = this.database.db.prepare(`
      SELECT * FROM home_history ORDER BY created_at DESC LIMIT :limit
    `).all({ limit: safeLimit });
    const total = this.database.db.prepare("SELECT COUNT(*) AS count FROM home_history").get()?.count || 0;
    return { ok: true, entries: rows, total, limit: safeLimit, max_entries: this.maxEntries };
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
