import { RoonOutput, RoonZone } from "../roon/roonTypes";

export type VolumeSafetyLimitWindow = {
  name: string;
  from: string | null;
  to: string | null;
  safe_max: number;
};

export type VolumeSafetyLimit = {
  output_id: string | null;
  zone_id?: string | null;
  output_name: string | null;
  zone_name: string | null;
  safe_max: number;
  limit_id?: string;
  source_type?: string;
  limits: VolumeSafetyLimitWindow[];
};

export type OutputVolumePolicy = {
  output_id: string;
  output_name: string;
  zone_id: string;
  zone_name: string;
  current_value: number | null;
  requested_value: number;
  projected_value: number | null;
  safe_limit_applied: boolean;
  safe_limit: number | null;
  safe_limit_source: string | null;
  active_limit_id: string | null;
  hard_limit: number | null;
  requires_confirmation: boolean;
  reason:
    | "within_safe_limit"
    | "volume_above_safe_limit"
    | "no_safe_limit_configured"
    | "projected_value_unknown";
};

export type ZoneVolumePolicy = {
  safe_limit_applied: boolean;
  safe_limit: number | null;
  hard_limit: number | null;
  requires_confirmation: boolean;
  reason: OutputVolumePolicy["reason"];
  outputs: OutputVolumePolicy[];
};

const DEFAULT_LIMITS: VolumeSafetyLimit[] = [
  {
    output_id: null,
    output_name: null,
    zone_name: "Salon",
    safe_max: 35,
    limits: [{ name: "default", from: null, to: null, safe_max: 35 }]
  },
  {
    output_id: null,
    output_name: null,
    zone_name: "Salón",
    safe_max: 35,
    limits: [{ name: "default", from: null, to: null, safe_max: 35 }]
  },
  {
    output_id: null,
    output_name: null,
    zone_name: "Despacho",
    safe_max: 35,
    limits: [{ name: "default", from: null, to: null, safe_max: 35 }]
  },
  {
    output_id: null,
    output_name: null,
    zone_name: "Cocina",
    safe_max: 19,
    limits: [{ name: "default", from: null, to: null, safe_max: 19 }]
  }
];

const GLOBAL_FALLBACK_LIMIT: VolumeSafetyLimit = {
  output_id: null,
  output_name: null,
  zone_name: null,
  safe_max: 35,
  limit_id: "__default_global__",
  source_type: "default_global",
  limits: [{ name: "default", from: null, to: null, safe_max: 35 }]
};

function normalizeName(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function getConfiguredVolumeSafetyLimits(): VolumeSafetyLimit[] {
  return [...DEFAULT_LIMITS, GLOBAL_FALLBACK_LIMIT];
}

export function activeSafeMax(limit: VolumeSafetyLimit): number {
  return limit.limits[0]?.safe_max ?? limit.safe_max;
}

export function findVolumeSafetyLimit(
  zone: RoonZone,
  output: RoonOutput,
  limits: VolumeSafetyLimit[] = getConfiguredVolumeSafetyLimits()
): VolumeSafetyLimit | null {
  const outputIdMatch = limits.find(
    (limit) => limit.output_id && limit.output_id === output.output_id
  );
  if (outputIdMatch) return outputIdMatch;

  const zoneIdMatch = limits.find(
    (limit) => limit.zone_id && (limit.zone_id === zone.zone_id || limit.zone_id === output.zone_id)
  );
  if (zoneIdMatch) return zoneIdMatch;

  const outputName = normalizeName(output.display_name);
  const outputNameMatch = limits.find(
    (limit) => limit.output_name && normalizeName(limit.output_name) === outputName
  );
  if (outputNameMatch) return outputNameMatch;

  const zoneName = normalizeName(zone.display_name);
  const zoneNameMatch = limits.find(
    (limit) => limit.zone_name && normalizeName(limit.zone_name) === zoneName
  );
  if (zoneNameMatch) return zoneNameMatch;

  return limits.find((limit) => !limit.output_id && !limit.zone_id && !limit.output_name && !limit.zone_name) || null;
}

function limitSource(limit: VolumeSafetyLimit | null): string | null {
  if (!limit) return null;
  if (limit.source_type) return limit.source_type;
  if (limit.output_id) return "output_id";
  if (limit.zone_id) return "zone_id";
  if (limit.output_name) return "output_name";
  if (limit.zone_name) return "zone_name";
  return "global";
}

export function projectedVolumeValue(
  output: RoonOutput,
  mode: "relative" | "absolute" | "relative_step",
  value: number
): number | null {
  const current = typeof output.volume?.value === "number" ? output.volume.value : null;
  if (mode === "absolute") return value;
  if (current === null) return null;
  if (mode === "relative_step") {
    const step = typeof output.volume?.step === "number" && output.volume.step > 0
      ? output.volume.step
      : 1;
    return current + value * step;
  }
  return current + value;
}

function hardMax(output: RoonOutput): number | null {
  const hard = (output.volume as Record<string, unknown> | undefined)?.hard_limit_max;
  if (typeof hard === "number" && Number.isFinite(hard)) return hard;
  const max = output.volume?.max;
  return typeof max === "number" && Number.isFinite(max) ? max : null;
}

export function evaluateZoneVolumePolicy(
  zone: RoonZone,
  outputs: RoonOutput[],
  mode: "relative" | "absolute" | "relative_step",
  value: number,
  limits = getConfiguredVolumeSafetyLimits()
): ZoneVolumePolicy {
  const outputPolicies = outputs.map((output) => {
    const projected = projectedVolumeValue(output, mode, value);
    const current = typeof output.volume?.value === "number" ? output.volume.value : null;
    const limit = findVolumeSafetyLimit(zone, output, limits);
    const safeLimit = limit ? activeSafeMax(limit) : null;
    const isIncrease = projected !== null && (current === null || projected > current);
    const requiresConfirmation =
      safeLimit !== null && projected !== null && isIncrease && projected > safeLimit;
    const reason: OutputVolumePolicy["reason"] =
      safeLimit === null
        ? "no_safe_limit_configured"
        : projected === null
          ? "projected_value_unknown"
          : requiresConfirmation
            ? "volume_above_safe_limit"
            : "within_safe_limit";

    return {
      output_id: output.output_id,
      output_name: output.display_name,
      zone_id: zone.zone_id,
      zone_name: zone.display_name,
      current_value: current,
      requested_value: value,
      projected_value: projected,
      safe_limit_applied: safeLimit !== null,
      safe_limit: safeLimit,
      safe_limit_source: limitSource(limit),
      active_limit_id: limit?.limit_id || null,
      hard_limit: hardMax(output),
      requires_confirmation: requiresConfirmation,
      reason
    };
  });

  const requiring = outputPolicies.find((policy) => policy.requires_confirmation);
  const applied = outputPolicies.filter((policy) => policy.safe_limit_applied);
  return {
    safe_limit_applied: applied.length > 0,
    safe_limit:
      applied.length > 0
        ? Math.min(...applied.map((policy) => policy.safe_limit as number))
        : null,
    hard_limit:
      outputPolicies
        .map((policy) => policy.hard_limit)
        .filter((value): value is number => typeof value === "number").length > 0
        ? Math.min(
            ...outputPolicies
              .map((policy) => policy.hard_limit)
              .filter((value): value is number => typeof value === "number")
          )
        : null,
    requires_confirmation: Boolean(requiring),
    reason: requiring
      ? "volume_above_safe_limit"
      : applied.length > 0
        ? "within_safe_limit"
        : "no_safe_limit_configured",
    outputs: outputPolicies
  };
}
