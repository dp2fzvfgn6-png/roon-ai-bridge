import { formatZone } from "../../roon/roonZoneService";
import { controlPlayback } from "../../roon/roonPlaybackService";
import { changeZoneVolume } from "../../roon/roonVolumeService";
import { groupZones, ungroupZone } from "../../roon/roonGroupingService";
import { transferZonePlayback } from "../../roon/roonTransferService";
import {
  changeZoneSettings,
  changeOutputVolume,
  muteAll,
  muteOutput,
  outputPowerAction,
  pauseAll,
  seekZone
} from "../../roon/roonAdvancedTransportService";
import { ApiError } from "../../utils/errors";
import { BridgeV2Context } from "../context";
import { completed, normalizeServiceResult, OperationResult, TargetReference } from "../contracts";
import { TargetResolver } from "../targetResolver";

export class TransportIntentHandler {
  readonly targets: TargetResolver;

  constructor(readonly context: BridgeV2Context) {
    this.targets = new TargetResolver(context.roonClient);
  }

  getState(input: {
    scope?: "system" | "zones" | "zone" | "outputs";
    zone?: TargetReference;
    include_unavailable_outputs?: boolean;
  }): OperationResult {
    const scope = input.scope || "system";
    const status = {
      core_connected: this.context.roonClient.isCoreConnected(),
      core_name: this.context.roonClient.getCoreName(),
      transport_ready: this.context.roonClient.isTransportReady(),
      browse_ready: this.context.roonClient.isBrowseReady(),
      image_ready: this.context.roonClient.isImageReady()
    };
    let data: unknown;
    const zones = this.context.roonClient.getZones().map(formatZone);
    if (scope === "zones") data = { ...status, zones };
    else if (scope === "zone") {
      if (!input.zone) throw new ApiError("VALIDATION_ERROR", "zone is required for zone scope");
      const zone = this.targets.zone(input.zone);
      data = { ...status, zone: zones.find((item) => item.zone_id === zone.zone_id) };
    } else if (scope === "outputs") {
      const currentIds = new Set(this.context.roonClient.getOutputs().map((output) => output.output_id));
      const known = this.context.roonClient.getKnownOutputs?.() || this.context.roonClient.getOutputs();
      data = {
        ...status,
        outputs: known
          .map((output) => ({
            ...output,
            currently_available: output.currently_available ?? currentIds.has(output.output_id)
          }))
          .filter((output) => input.include_unavailable_outputs !== false || output.currently_available)
      };
    } else {
      data = {
        ...status,
        zones_count: this.context.roonClient.getZones().length,
        outputs_count: this.context.roonClient.getOutputs().length
      };
    }
    return completed("roon_get_state", `Roon ${scope} state returned.`, data, { verified: true });
  }

  async controlPlayback(input: {
    target?: "zone" | "all";
    zone?: TargetReference;
    action: "play" | "pause" | "toggle" | "stop" | "next" | "previous" | "seek";
    seek?: { mode: "absolute" | "relative"; seconds: number };
  }): Promise<OperationResult> {
    if (input.target === "all") {
      if (input.action !== "pause") {
        throw new ApiError("UNSUPPORTED_COMMAND", "Only pause is supported for all zones");
      }
      return normalizeServiceResult("roon_control_playback", "All zones paused.", await pauseAll(this.context.roonClient), true);
    }
    if (!input.zone) throw new ApiError("VALIDATION_ERROR", "zone is required");
    const zone = this.targets.zone(input.zone);
    if (input.action === "seek") {
      if (!input.seek) throw new ApiError("INVALID_SEEK", "seek parameters are required");
      return normalizeServiceResult(
        "roon_control_playback",
        `Seek applied to ${zone.display_name}.`,
        await seekZone(this.context.roonClient, zone.zone_id, input.seek.mode, input.seek.seconds)
      );
    }
    const command = input.action === "toggle" ? "playpause" : input.action;
    const result = await controlPlayback(this.context.roonClient, zone.zone_id, command);
    return normalizeServiceResult(
      "roon_control_playback",
      `${input.action} applied to ${zone.display_name}.`,
      result,
      result.state_verified
    );
  }

  async setVolume(input: {
    target?: "zone" | "output" | "all";
    zone?: TargetReference;
    output?: TargetReference;
    mode: "absolute" | "relative" | "relative_step" | "mute" | "unmute";
    value?: number;
    confirm?: boolean;
  }): Promise<OperationResult> {
    if (input.target === "all") {
      if (input.mode !== "mute" && input.mode !== "unmute") {
        throw new ApiError("UNSUPPORTED_COMMAND", "All-zone volume only supports mute or unmute");
      }
      return normalizeServiceResult("roon_set_volume", `All outputs ${input.mode}d.`, await muteAll(this.context.roonClient, input.mode), true);
    }
    if (input.target === "output") {
      if (!input.output) throw new ApiError("VALIDATION_ERROR", "output is required");
      const output = this.targets.output(input.output);
      const result = input.mode === "mute" || input.mode === "unmute"
        ? await muteOutput(this.context.roonClient, output.output_id, input.mode)
        : await changeOutputVolume(
            this.context.roonClient,
            output.output_id,
            input.mode,
            typeof input.value === "number" ? input.value : Number.NaN
          );
      return normalizeServiceResult("roon_set_volume", `Volume action applied to ${output.display_name}.`, result, true);
    }
    if (!input.zone) throw new ApiError("VALIDATION_ERROR", "zone is required");
    const zone = this.targets.zone(input.zone);
    if (input.mode === "mute" || input.mode === "unmute") {
      const outputs = (zone.outputs || []).filter((output) => output.volume);
      if (!outputs.length) throw new ApiError("VOLUME_NOT_SUPPORTED", "The zone has no volume-capable output");
      const results: Record<string, unknown>[] = [];
      for (const output of outputs) {
        results.push(await muteOutput(this.context.roonClient, output.output_id, input.mode));
      }
      return completed(
        "roon_set_volume",
        `${zone.display_name} ${input.mode}d.`,
        { zone_id: zone.zone_id, outputs: results },
        { verified: results.every((result) => result.state_verified === true) }
      );
    }
    if (typeof input.value !== "number") throw new ApiError("INVALID_VOLUME_VALUE", "value is required");
    const result = await changeZoneVolume(this.context.roonClient, zone.zone_id, input.mode, input.value, {
      confirm: Boolean(input.confirm),
      volumeLimits: this.context.volumeLimitService.activeSafetyLimits()
    });
    return normalizeServiceResult("roon_set_volume", `Volume updated for ${zone.display_name}.`, result, true);
  }

  async controlOutput(input: {
    output: TargetReference;
    action: "standby" | "toggle_standby" | "convenience_switch";
    control_key?: string;
  }): Promise<OperationResult> {
    const output = this.targets.output(input.output);
    const result = await outputPowerAction(this.context.roonClient, output.output_id, input.action, input.control_key);
    return normalizeServiceResult("roon_control_output", `${input.action} accepted for ${output.display_name}.`, result, false);
  }

  async setPlaybackOptions(input: {
    zone: TargetReference;
    shuffle?: boolean;
    auto_radio?: boolean;
    loop?: "loop" | "loop_one" | "disabled" | "next";
  }): Promise<OperationResult> {
    const zone = this.targets.zone(input.zone);
    const result = await changeZoneSettings(this.context.roonClient, zone.zone_id, {
      shuffle: input.shuffle,
      auto_radio: input.auto_radio,
      loop: input.loop
    });
    return normalizeServiceResult("roon_set_playback_options", `Playback options accepted for ${zone.display_name}.`, result, false);
  }

  async setGrouping(input: {
    action: "group" | "ungroup";
    primary_zone: TargetReference;
    additional_zones?: TargetReference[];
  }): Promise<OperationResult> {
    const primary = this.targets.zone(input.primary_zone);
    const result = input.action === "ungroup"
      ? await ungroupZone(this.context.roonClient, primary.zone_id)
      : await groupZones(
          this.context.roonClient,
          primary.zone_id,
          (input.additional_zones || []).map((ref) => this.targets.zone(ref).zone_id)
        );
    return normalizeServiceResult("roon_set_grouping", `Zone grouping ${input.action} completed.`, result, true);
  }

  async transfer(input: { source_zone: TargetReference; target_zone: TargetReference }): Promise<OperationResult> {
    const source = this.targets.zone(input.source_zone);
    const target = this.targets.zone(input.target_zone);
    const result = await transferZonePlayback(this.context.roonClient, source.zone_id, target.zone_id);
    return normalizeServiceResult(
      "roon_transfer_playback",
      `Playback transferred from ${source.display_name} to ${target.display_name}.`,
      result
    );
  }

}
