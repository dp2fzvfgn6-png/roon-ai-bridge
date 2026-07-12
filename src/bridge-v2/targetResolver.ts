import { RoonClient } from "../roon/roonClient";
import { RoonOutput, RoonZone } from "../roon/roonTypes";
import { ApiError } from "../utils/errors";
import { TargetReference } from "./contracts";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function requireReference(ref: TargetReference, kind: "zone" | "output"): void {
  if (!ref || (!ref.id && !ref.name)) {
    throw new ApiError("VALIDATION_ERROR", `${kind} requires id or name`);
  }
}

export class TargetResolver {
  constructor(private readonly roonClient: RoonClient) {}

  zone(ref: TargetReference): RoonZone {
    requireReference(ref, "zone");
    if (ref.id) {
      const byId = this.roonClient.getZone(ref.id);
      if (byId) return byId;
    }
    const wanted = normalize(ref.name || "");
    const matches = this.roonClient
      .getZones()
      .filter((zone) => normalize(zone.display_name) === wanted);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new ApiError("AMBIGUOUS_MATCH", "Several zones have the requested name", {
        requested: ref,
        candidates: matches.map((zone) => ({ id: zone.zone_id, name: zone.display_name }))
      });
    }
    throw new ApiError("ZONE_NOT_FOUND", "Roon zone not found", { requested: ref });
  }

  output(ref: TargetReference): RoonOutput {
    requireReference(ref, "output");
    if (ref.id) {
      const byId = this.roonClient.getOutput(ref.id);
      if (byId) return byId;
    }
    const wanted = normalize(ref.name || "");
    const matches = this.roonClient
      .getOutputs()
      .filter((output) => normalize(output.display_name) === wanted);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new ApiError("AMBIGUOUS_MATCH", "Several outputs have the requested name", {
        requested: ref,
        candidates: matches.map((output) => ({ id: output.output_id, name: output.display_name }))
      });
    }
    throw new ApiError("OUTPUT_NOT_FOUND", "Roon output not found", { requested: ref });
  }
}
