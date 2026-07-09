import crypto from "crypto";
import { AppConfig } from "../config/env";
import { createDatabase, SqliteDatabase } from "../db/database";
import { RoonClient } from "../roon/roonClient";
import { RoonOutput, RoonZone } from "../roon/roonTypes";
import { ApiError } from "../utils/errors";
import { VolumeSafetyLimit } from "../safety/volumeSafety";

export type TargetRefType = "output_id" | "zone_id" | "output_name" | "zone_name" | "global";

export type TargetRef = {
  type: TargetRefType;
  value: string;
};

export type VolumeLimitSchedule = {
  timezone: string;
  days: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
  from: string;
  to: string;
};

export type VolumeLimit = {
  limit_id: string;
  target_ref: TargetRef;
  name: string;
  safe_max: number;
  schedule: VolumeLimitSchedule | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type VolumeLimitRow = {
  limit_id: string;
  target_type: TargetRefType;
  target_value: string;
  name: string;
  safe_max: number;
  schedule_json: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
};

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const VALID_DAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeName(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("INVALID_VOLUME_LIMIT", `${field} is required`);
  }
  return value.trim();
}

function parseSafeMax(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError("INVALID_VOLUME_LIMIT", "safe_max must be a positive number");
  }
  return parsed;
}

function parseTime(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    throw new ApiError("INVALID_VOLUME_LIMIT", `${field} must use HH:mm format`);
  }
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59) {
    throw new ApiError("INVALID_VOLUME_LIMIT", `${field} must use HH:mm format`);
  }
  return hours * 60 + minutes;
}

function parseSchedule(value: unknown): VolumeLimitSchedule | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("INVALID_VOLUME_LIMIT", "schedule must be an object or null");
  }
  const raw = value as Record<string, unknown>;
  const timezone = requiredString(raw.timezone, "schedule.timezone");
  const days = Array.isArray(raw.days) ? raw.days : [];
  if (days.length === 0) {
    throw new ApiError("INVALID_VOLUME_LIMIT", "schedule.days cannot be empty");
  }
  const parsedDays = days.map((day) => String(day).toLowerCase());
  if (parsedDays.some((day) => !VALID_DAYS.has(day))) {
    throw new ApiError("INVALID_VOLUME_LIMIT", "schedule.days contains an invalid day");
  }
  const from = requiredString(raw.from, "schedule.from");
  const to = requiredString(raw.to, "schedule.to");
  if (parseTime(from, "schedule.from") === parseTime(to, "schedule.to")) {
    throw new ApiError("INVALID_VOLUME_LIMIT", "schedule.from and schedule.to cannot be equal");
  }
  return {
    timezone,
    days: [...new Set(parsedDays)] as VolumeLimitSchedule["days"],
    from,
    to
  };
}

function parseTargetRef(value: unknown): TargetRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError("INVALID_VOLUME_LIMIT", "target_ref is required");
  }
  const raw = value as Record<string, unknown>;
  const type = requiredString(raw.type, "target_ref.type") as TargetRefType;
  if (!["output_id", "zone_id", "output_name", "zone_name", "global"].includes(type)) {
    throw new ApiError("INVALID_VOLUME_LIMIT", "target_ref.type is invalid");
  }
  const targetValue = type === "global" ? "global" : requiredString(raw.value, "target_ref.value");
  return { type, value: targetValue };
}

function intervalsFor(schedule: VolumeLimitSchedule): Array<{ day: string; start: number; end: number }> {
  const from = parseTime(schedule.from, "schedule.from");
  const to = parseTime(schedule.to, "schedule.to");
  const result: Array<{ day: string; start: number; end: number }> = [];
  for (const day of schedule.days) {
    if (from < to) {
      result.push({ day, start: from, end: to });
    } else {
      const nextDay = DAYS[(DAYS.indexOf(day as any) + 1) % 7];
      result.push({ day, start: from, end: 1440 });
      result.push({ day: nextDay, start: 0, end: to });
    }
  }
  return result;
}

function schedulesOverlap(a: VolumeLimitSchedule, b: VolumeLimitSchedule): boolean {
  const left = intervalsFor(a);
  const right = intervalsFor(b);
  return left.some((l) =>
    right.some((r) => l.day === r.day && l.start < r.end && r.start < l.end)
  );
}

function hardMax(output: RoonOutput | null): number | null {
  if (!output?.volume) return null;
  const hard = (output.volume as Record<string, unknown>).hard_limit_max;
  if (typeof hard === "number" && Number.isFinite(hard)) return hard;
  return typeof output.volume.max === "number" && Number.isFinite(output.volume.max)
    ? output.volume.max
    : null;
}

export class VolumeLimitService {
  private readonly database: SqliteDatabase;

  constructor(config: AppConfig, database?: SqliteDatabase) {
    this.database = database || createDatabase(config);
    this.seedDefaults();
  }

  list(): VolumeLimit[] {
    return (this.database.db
      .prepare(
        `SELECT limit_id, target_type, target_value, name, safe_max, schedule_json,
                enabled, created_at, updated_at
         FROM volume_limits ORDER BY target_type, target_value, schedule_json IS NOT NULL, name`
      )
      .all() as VolumeLimitRow[]).map((row) => this.mapRow(row));
  }

  get(limitId: string): VolumeLimit {
    const row = this.database.db
      .prepare(
        `SELECT limit_id, target_type, target_value, name, safe_max, schedule_json,
                enabled, created_at, updated_at
         FROM volume_limits WHERE limit_id = ?`
      )
      .get(limitId) as VolumeLimitRow | undefined;
    if (!row) throw new ApiError("VOLUME_LIMIT_NOT_FOUND", "Volume limit not found");
    return this.mapRow(row);
  }

  create(input: Record<string, unknown>): VolumeLimit {
    const target = parseTargetRef(input.target_ref);
    const name = requiredString(input.name ?? "General", "name").slice(0, 80);
    const safeMax = parseSafeMax(input.safe_max);
    const schedule = parseSchedule(input.schedule);
    const enabled = input.enabled !== false;
    const limitId = typeof input.limit_id === "string" && input.limit_id.trim()
      ? input.limit_id.trim()
      : crypto.randomUUID();
    this.assertNoOverlap(limitId, target, schedule);
    const now = nowIso();
    this.database.db
      .prepare(
        `INSERT INTO volume_limits (
          limit_id, target_type, target_value, name, safe_max, schedule_json, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        limitId,
        target.type,
        target.value,
        name,
        safeMax,
        schedule ? JSON.stringify(schedule) : null,
        enabled ? 1 : 0,
        now,
        now
      );
    return this.get(limitId);
  }

  update(limitId: string, input: Record<string, unknown>): VolumeLimit {
    const current = this.get(limitId);
    const target = input.target_ref === undefined ? current.target_ref : parseTargetRef(input.target_ref);
    const name = input.name === undefined ? current.name : requiredString(input.name, "name").slice(0, 80);
    const safeMax = input.safe_max === undefined ? current.safe_max : parseSafeMax(input.safe_max);
    const schedule = input.schedule === undefined ? current.schedule : parseSchedule(input.schedule);
    const enabled = input.enabled === undefined ? current.enabled : input.enabled !== false;
    this.assertNoOverlap(limitId, target, schedule);
    this.database.db
      .prepare(
        `UPDATE volume_limits
         SET target_type = ?, target_value = ?, name = ?, safe_max = ?,
             schedule_json = ?, enabled = ?, updated_at = ?
         WHERE limit_id = ?`
      )
      .run(
        target.type,
        target.value,
        name,
        safeMax,
        schedule ? JSON.stringify(schedule) : null,
        enabled ? 1 : 0,
        nowIso(),
        limitId
      );
    return this.get(limitId);
  }

  delete(limitId: string): void {
    const result = this.database.db
      .prepare("DELETE FROM volume_limits WHERE limit_id = ?")
      .run(limitId) as { changes?: number };
    if (!result.changes) throw new ApiError("VOLUME_LIMIT_NOT_FOUND", "Volume limit not found");
  }

  evaluate(
    roonClient: RoonClient,
    input: { target_ref: TargetRef; requested_volume: number; at?: string }
  ): Record<string, unknown> {
    const target = this.resolveTarget(roonClient, input.target_ref);
    const active = this.findActiveLimit(target.zone, target.output, input.at);
    const deviceHardLimit = hardMax(target.output);
    const requested = parseSafeMax(input.requested_volume);
    const aboveHard = deviceHardLimit !== null && requested > deviceHardLimit;
    const aboveSafe = active && requested > active.safe_max;
    return {
      ok: true,
      target_ref: input.target_ref,
      resolved_target: {
        output_id: target.output?.output_id ?? null,
        output_name: target.output?.display_name ?? null,
        zone_id: target.zone?.zone_id ?? null,
        zone_name: target.zone?.display_name ?? null
      },
      requested_volume: requested,
      device_hard_limit: deviceHardLimit,
      active_limit: active
        ? { limit_id: active.limit_id, name: active.name, safe_max: active.safe_max }
        : null,
      safe_limit: active?.safe_max ?? null,
      safe_limit_source: active?.target_ref.type ?? null,
      policy_result: aboveHard ? "above_hard_limit" : aboveSafe ? "above_safe_limit" : "allowed",
      requires_confirmation: Boolean(aboveSafe && !aboveHard),
      reason: active?.schedule ? "scheduled_limit_active" : active ? "general_limit_active" : "no_safe_limit"
    };
  }

  findActiveLimit(
    zone: RoonZone | null,
    output: RoonOutput | null,
    at?: string
  ): VolumeLimit | null {
    const limits = this.list().filter((limit) => limit.enabled);
    const candidates = [
      ...this.matching(limits, "output_id", output?.output_id),
      ...this.matching(limits, "zone_id", zone?.zone_id || output?.zone_id),
      ...this.matching(limits, "output_name", output?.display_name),
      ...this.matching(limits, "zone_name", zone?.display_name),
      ...this.matching(limits, "global", "global")
    ];
    for (const targetType of ["output_id", "zone_id", "output_name", "zone_name", "global"] as TargetRefType[]) {
      const scoped = candidates.filter((limit) => limit.target_ref.type === targetType);
      const scheduled = scoped.find((limit) => limit.schedule && this.scheduleApplies(limit.schedule, at));
      if (scheduled) return scheduled;
      const general = scoped.find((limit) => !limit.schedule);
      if (general) return general;
    }
    return null;
  }

  activeSafetyLimits(at?: string): VolumeSafetyLimit[] {
    const enabled = this.list().filter((limit) => limit.enabled);
    const scheduled = enabled.filter((limit) => limit.schedule && this.scheduleApplies(limit.schedule, at));
    const general = enabled.filter((limit) => !limit.schedule);
    return [...scheduled, ...general].map((limit) => ({
      output_id: limit.target_ref.type === "output_id" ? limit.target_ref.value : null,
      zone_id: limit.target_ref.type === "zone_id" ? limit.target_ref.value : null,
      output_name: limit.target_ref.type === "output_name" ? limit.target_ref.value : null,
      zone_name: limit.target_ref.type === "zone_name" ? limit.target_ref.value : null,
      safe_max: limit.safe_max,
      limit_id: limit.limit_id,
      source_type: limit.target_ref.type,
      limits: [{
        name: limit.name,
        from: limit.schedule?.from || null,
        to: limit.schedule?.to || null,
        safe_max: limit.safe_max
      }]
    }));
  }

  private matching(limits: VolumeLimit[], type: TargetRefType, value: string | null | undefined): VolumeLimit[] {
    if (!value) return [];
    const normalized = normalizeName(value);
    return limits.filter((limit) =>
      limit.target_ref.type === type &&
      (type.endsWith("_name")
        ? normalizeName(limit.target_ref.value) === normalized
        : limit.target_ref.value === value)
    );
  }

  private scheduleApplies(schedule: VolumeLimitSchedule, at?: string): boolean {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: schedule.timezone || "Europe/Madrid",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    const parts = formatter.formatToParts(at ? new Date(at) : new Date());
    const weekday = parts.find((part) => part.type === "weekday")?.value.slice(0, 3).toLowerCase();
    const dayMap: Record<string, string> = { mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat", sun: "sun" };
    const day = dayMap[weekday || ""];
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!day || !Number.isFinite(hour) || !Number.isFinite(minute)) return false;
    const value = hour * 60 + minute;
    return intervalsFor(schedule).some((interval) =>
      interval.day === day && value >= interval.start && value < interval.end
    );
  }

  private assertNoOverlap(limitId: string, target: TargetRef, schedule: VolumeLimitSchedule | null): void {
    if (!schedule) return;
    const overlapping = this.list().find((limit) =>
      limit.limit_id !== limitId &&
      limit.enabled &&
      limit.schedule &&
      limit.target_ref.type === target.type &&
      normalizeName(limit.target_ref.value) === normalizeName(target.value) &&
      schedulesOverlap(schedule, limit.schedule)
    );
    if (overlapping) {
      throw new ApiError("VOLUME_LIMIT_OVERLAP", "This limit overlaps another configured limit.", {
        limit_id: overlapping.limit_id
      });
    }
  }

  private resolveTarget(roonClient: RoonClient, target: TargetRef): { zone: RoonZone | null; output: RoonOutput | null } {
    const zones = roonClient.getZones();
    const outputs = roonClient.getOutputs();
    if (target.type === "output_id") {
      const output = roonClient.getOutput(target.value);
      return { output, zone: zones.find((zone) => (zone.outputs || []).some((item) => item.output_id === output?.output_id)) || null };
    }
    if (target.type === "zone_id") {
      const zone = roonClient.getZone(target.value);
      return { zone, output: zone?.outputs?.[0] || null };
    }
    if (target.type === "output_name") {
      const output = outputs.find((item) => normalizeName(item.display_name) === normalizeName(target.value)) || null;
      return { output, zone: zones.find((zone) => (zone.outputs || []).some((item) => item.output_id === output?.output_id)) || null };
    }
    if (target.type === "zone_name") {
      const zone = zones.find((item) => normalizeName(item.display_name) === normalizeName(target.value)) || null;
      return { zone, output: zone?.outputs?.[0] || null };
    }
    return { zone: null, output: null };
  }

  private mapRow(row: VolumeLimitRow): VolumeLimit {
    return {
      limit_id: row.limit_id,
      target_ref: { type: row.target_type, value: row.target_value },
      name: row.name,
      safe_max: Number(row.safe_max),
      schedule: row.schedule_json ? JSON.parse(row.schedule_json) : null,
      enabled: Boolean(row.enabled),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private seedDefaults(): void {
    const count = this.database.db.prepare("SELECT COUNT(*) AS count FROM volume_limits").get() as { count?: number };
    if ((count.count || 0) > 0) return;
    for (const [limitId, name, safeMax] of [
      ["salon_general", "Salón", 35],
      ["despacho_general", "Despacho", 35],
      ["cocina_general", "Cocina", 19]
    ] as const) {
      this.create({
        limit_id: limitId,
        target_ref: { type: "output_name", value: name },
        name: "General",
        safe_max: safeMax,
        schedule: null,
        enabled: true
      });
    }
  }
}
