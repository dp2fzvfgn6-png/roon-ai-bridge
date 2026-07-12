import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";
import { RoonOutput, RoonZone } from "./roonTypes";
import { getZoneOrThrow } from "./roonZoneService";
import { requireTransport } from "./roonTransportService";
import { roonSdkCall, waitForRoonState } from "./roonSdk";

type GroupingMember = {
  output_id: string;
  display_name: string;
};

export type GroupZonesResult = {
  ok: true;
  primary_zone_id: string;
  primary_zone_name: string;
  grouped_zone_id: string;
  grouped_zone_name: string;
  members: GroupingMember[];
  state_verified: true;
};

export type UngroupZoneResult = {
  ok: true;
  previous_zone_id: string;
  previous_zone_name: string;
  separated_outputs: GroupingMember[];
  state_verified: true;
};

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function zoneOutputs(zone: RoonZone): RoonOutput[] {
  const outputs = zone.outputs || [];
  if (outputs.length === 0) {
    throw new ApiError("OUTPUT_NOT_FOUND", "Zone has no outputs", {
      zone_id: zone.zone_id,
      zone_name: zone.display_name
    });
  }
  return outputs;
}

function deduplicateOutputs(outputs: RoonOutput[]): RoonOutput[] {
  const byId = new Map<string, RoonOutput>();
  for (const output of outputs) {
    if (!byId.has(output.output_id)) byId.set(output.output_id, output);
  }
  return Array.from(byId.values());
}

export function validateGroupCompatibility(outputs: RoonOutput[]): void {
  const selectedIds = outputs.map((output) => output.output_id);
  const incompatible: Array<{ output_id: string; incompatible_with: string[] }> = [];

  for (const output of outputs) {
    const compatibleIds = output.can_group_with_output_ids;
    if (!Array.isArray(compatibleIds)) continue;
    const blocked = selectedIds.filter(
      (candidate) =>
        candidate !== output.output_id && !compatibleIds.includes(candidate)
    );
    if (blocked.length > 0) {
      incompatible.push({
        output_id: output.output_id,
        incompatible_with: blocked
      });
    }
  }

  if (incompatible.length > 0) {
    throw new ApiError("OUTPUTS_NOT_GROUPABLE", "Selected outputs cannot be grouped", {
      incompatible
    });
  }
}

async function waitForZoneContaining(
  roonClient: RoonClient,
  outputIds: string[]
): Promise<RoonZone | null> {
  return waitForRoonState(
    () => roonClient.getZones().find((zone) => {
      const members = new Set((zone.outputs || []).map((output) => output.output_id));
      return outputIds.every((outputId) => members.has(outputId));
    }) || null,
    () => true
  );
}

async function waitForSeparatedOutputs(
  roonClient: RoonClient,
  outputIds: string[]
): Promise<boolean> {
  const result = await waitForRoonState(
    () => outputIds.every((outputId) =>
      roonClient
        .getZones()
        .some(
          (zone) =>
            (zone.outputs || []).length === 1 &&
            zone.outputs?.[0]?.output_id === outputId
        )
    ) ? true : null,
    (separated) => separated
  );
  return result === true;
}

export async function groupZones(
  roonClient: RoonClient,
  primaryZoneId: string,
  additionalZoneIds: string[]
): Promise<GroupZonesResult> {
  const transport = requireTransport(roonClient);
  const primaryZone = getZoneOrThrow(roonClient, primaryZoneId);
  const additionalIds = uniqueStrings(additionalZoneIds).filter(
    (zoneId) => zoneId !== primaryZoneId
  );

  if (additionalIds.length === 0) {
    throw new ApiError(
      "INVALID_ZONE_GROUP",
      "At least one different additional zone is required",
      { primary_zone_id: primaryZoneId }
    );
  }

  const additionalZones = additionalIds.map((zoneId) =>
    getZoneOrThrow(roonClient, zoneId)
  );
  const outputs = deduplicateOutputs([
    ...zoneOutputs(primaryZone),
    ...additionalZones.flatMap(zoneOutputs)
  ]);

  if (outputs.length < 2) {
    throw new ApiError("INVALID_ZONE_GROUP", "At least two outputs are required");
  }
  validateGroupCompatibility(outputs);

  await roonSdkCall<void>(
    "Roon output grouping",
    (callback) => transport.group_outputs(outputs, callback),
    { primary_zone_id: primaryZoneId, additional_zone_ids: additionalIds },
    { errorCode: "OUTPUTS_NOT_GROUPABLE" }
  );

  const outputIds = outputs.map((output) => output.output_id);
  const groupedZone = await waitForZoneContaining(roonClient, outputIds);
  if (!groupedZone) {
    throw new ApiError(
      "ZONE_GROUP_STATE_NOT_CHANGED",
      "Roon accepted grouping but the outputs did not form one zone",
      { output_ids: outputIds }
    );
  }

  return {
    ok: true,
    primary_zone_id: primaryZone.zone_id,
    primary_zone_name: primaryZone.display_name,
    grouped_zone_id: groupedZone.zone_id,
    grouped_zone_name: groupedZone.display_name,
    members: outputs.map((output) => ({
      output_id: output.output_id,
      display_name: output.display_name
    })),
    state_verified: true
  };
}

export async function ungroupZone(
  roonClient: RoonClient,
  zoneId: string
): Promise<UngroupZoneResult> {
  const transport = requireTransport(roonClient);
  const zone = getZoneOrThrow(roonClient, zoneId);
  const outputs = zoneOutputs(zone);

  if (outputs.length < 2) {
    throw new ApiError("ZONE_NOT_GROUPED", "Zone is not grouped", {
      zone_id: zoneId,
      zone_name: zone.display_name
    });
  }

  await roonSdkCall<void>(
    "Roon output ungrouping",
    (callback) => transport.ungroup_outputs(outputs, callback),
    { zone_id: zoneId }
  );

  const outputIds = outputs.map((output) => output.output_id);
  if (!(await waitForSeparatedOutputs(roonClient, outputIds))) {
    throw new ApiError(
      "ZONE_GROUP_STATE_NOT_CHANGED",
      "Roon accepted ungrouping but the outputs did not separate",
      { zone_id: zoneId, output_ids: outputIds }
    );
  }

  return {
    ok: true,
    previous_zone_id: zone.zone_id,
    previous_zone_name: zone.display_name,
    separated_outputs: outputs.map((output) => ({
      output_id: output.output_id,
      display_name: output.display_name
    })),
    state_verified: true
  };
}
