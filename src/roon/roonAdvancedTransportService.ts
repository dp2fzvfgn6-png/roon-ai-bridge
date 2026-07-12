import { ApiError } from "../utils/errors";
import { getQueueSnapshot, playQueueItemFromHere } from "./roonQueueService";
import { RoonClient } from "./roonClient";
import { RoonOutput, RoonZone } from "./roonTypes";
import { requireTransport } from "./roonTransportService";
import { getZoneOrThrow } from "./roonZoneService";
import { roonSdkCall } from "./roonSdk";

type TransportSettings = {
  shuffle?: boolean;
  auto_radio?: boolean;
  loop?: "loop" | "loop_one" | "disabled" | "next";
};

function transportCall(
  invoke: (callback: (error: string | false) => void) => void,
  operation: string
): Promise<void> {
  return roonSdkCall<void>(operation, invoke);
}

function validateOutputVolumeCommand(
  output: RoonOutput,
  mode: "absolute" | "relative" | "relative_step",
  value: number
): void {
  if (!output.volume) {
    throw new ApiError("VOLUME_NOT_SUPPORTED", "Volume is not supported by this output", {
      output_id: output.output_id
    });
  }
  if (output.volume.type === "incremental" && (mode !== "relative" || Math.abs(value) !== 1)) {
    throw new ApiError(
      "INVALID_VOLUME_VALUE",
      "Incremental outputs require relative volume with a value of -1 or 1",
      { output_id: output.output_id, mode, value }
    );
  }
}

function getOutputOrThrow(roonClient: RoonClient, outputId: string): RoonOutput {
  const output = roonClient.getOutput(outputId);
  if (!output) {
    throw new ApiError("OUTPUT_NOT_FOUND", "Output not found", {
      output_id: outputId
    });
  }
  return output;
}

export function listOutputs(
  roonClient: RoonClient,
  options: { includeUnavailable?: boolean } = {}
): Array<RoonOutput & Record<string, unknown>> {
  requireTransport(roonClient);
  const currentIds = new Set(roonClient.getOutputs().map((output) => output.output_id));
  const knownOutputs = typeof roonClient.getKnownOutputs === "function"
    ? roonClient.getKnownOutputs()
    : roonClient.getOutputs();
  return knownOutputs
    .map((output) => {
      const currentlyAvailable = typeof output.currently_available === "boolean"
        ? output.currently_available
        : currentIds.has(output.output_id);
      return {
        ...output,
        currently_available: currentlyAvailable,
        last_seen: output.last_seen ?? null,
        last_known_zone_id: output.zone_id ?? null,
        can_control_volume: Boolean(output.volume),
        volume_type: output.volume?.type || null,
        last_known_volume_type: output.volume?.type || null,
        can_group_with_output_ids: output.can_group_with_output_ids || [],
        source_controls: output.source_controls ?? output.source_control_status ?? null,
        source_control_status: output.source_control_status ?? null,
        device_type: output.device_type ?? output.protocol ?? null
      };
    })
    .filter((output) => options.includeUnavailable !== false || output.currently_available);
}

export async function seekZone(
  roonClient: RoonClient,
  zoneId: string,
  mode: "absolute" | "relative",
  seconds: number
): Promise<Record<string, unknown>> {
  const transport = requireTransport(roonClient);
  const zone = getZoneOrThrow(roonClient, zoneId);
  if (mode !== "absolute" && mode !== "relative") {
    throw new ApiError("INVALID_SEEK", "Seek mode must be absolute or relative");
  }
  if (!Number.isFinite(seconds) || (mode === "absolute" && seconds < 0)) {
    throw new ApiError("INVALID_SEEK", "Seek seconds are invalid");
  }
  await transportCall(
    (callback) => transport.seek(zone, mode, seconds, callback),
    "seek"
  );
  return { ok: true, zone_id: zoneId, mode, seconds, state_verified: false };
}

export async function muteOutput(
  roonClient: RoonClient,
  outputId: string,
  how: "mute" | "unmute"
): Promise<Record<string, unknown>> {
  const transport = requireTransport(roonClient);
  const output = getOutputOrThrow(roonClient, outputId);
  if (how !== "mute" && how !== "unmute") {
    throw new ApiError("INVALID_MUTE_ACTION", "Mute action must be mute or unmute");
  }
  await transportCall(
    (callback) => transport.mute(output, how, callback),
    "mute"
  );
  return { ok: true, output_id: outputId, action: how, state_verified: false };
}

export async function changeOutputVolume(
  roonClient: RoonClient,
  outputId: string,
  mode: "absolute" | "relative" | "relative_step",
  value: number
): Promise<Record<string, unknown>> {
  const transport = requireTransport(roonClient);
  const output = getOutputOrThrow(roonClient, outputId);
  if (!["absolute", "relative", "relative_step"].includes(mode)) {
    throw new ApiError("INVALID_VOLUME_MODE", "Unsupported output volume mode");
  }
  if (!Number.isFinite(value)) {
    throw new ApiError("INVALID_VOLUME_VALUE", "Volume value must be numeric");
  }
  validateOutputVolumeCommand(output, mode, value);
  await transportCall(
    (callback) => transport.change_volume(output, mode, value, callback),
    "change output volume"
  );
  return { ok: true, output_id: outputId, mode, value, state_verified: false };
}

export async function muteAll(
  roonClient: RoonClient,
  how: "mute" | "unmute"
): Promise<Record<string, unknown>> {
  const transport = requireTransport(roonClient);
  if (how !== "mute" && how !== "unmute") {
    throw new ApiError("INVALID_MUTE_ACTION", "Mute action must be mute or unmute");
  }
  await transportCall((callback) => transport.mute_all(how, callback), "mute_all");
  return { ok: true, action: how, state_verified: false };
}

export async function pauseAll(
  roonClient: RoonClient
): Promise<Record<string, unknown>> {
  const transport = requireTransport(roonClient);
  await transportCall((callback) => transport.pause_all(callback), "pause_all");
  return { ok: true, action: "pause_all", state_verified: false };
}

export async function outputPowerAction(
  roonClient: RoonClient,
  outputId: string,
  action: "standby" | "toggle_standby" | "convenience_switch",
  controlKey?: string
): Promise<Record<string, unknown>> {
  const transport = requireTransport(roonClient);
  const output = getOutputOrThrow(roonClient, outputId);
  const options = controlKey ? { control_key: controlKey } : {};
  if (!["standby", "toggle_standby", "convenience_switch"].includes(action)) {
    throw new ApiError("UNSUPPORTED_COMMAND", "Unsupported output power action");
  }
  await transportCall(
    (callback) => {
      if (action === "standby") transport.standby(output, options, callback);
      else if (action === "toggle_standby") transport.toggle_standby(output, options, callback);
      else transport.convenience_switch(output, options, callback);
    },
    action
  );
  return {
    ok: true,
    output_id: outputId,
    action,
    control_key: controlKey || null,
    state_verified: false
  };
}

export async function changeZoneSettings(
  roonClient: RoonClient,
  zoneId: string,
  settings: TransportSettings
): Promise<Record<string, unknown>> {
  const transport = requireTransport(roonClient);
  const zone = getZoneOrThrow(roonClient, zoneId);
  const accepted: TransportSettings = {};
  if (typeof settings.shuffle === "boolean") accepted.shuffle = settings.shuffle;
  if (typeof settings.auto_radio === "boolean") {
    accepted.auto_radio = settings.auto_radio;
  }
  if (
    settings.loop === "loop" ||
    settings.loop === "loop_one" ||
    settings.loop === "disabled" ||
    settings.loop === "next"
  ) {
    accepted.loop = settings.loop;
  }
  if (Object.keys(accepted).length === 0) {
    throw new ApiError(
      "UNSUPPORTED_COMMAND",
      "At least one of shuffle, auto_radio or loop is required"
    );
  }
  await transportCall(
    (callback) => transport.change_settings(zone, accepted, callback),
    "change_settings"
  );
  return { ok: true, zone_id: zoneId, settings: accepted, state_verified: false };
}

export async function restartQueuePlayback(
  roonClient: RoonClient,
  zoneId: string
): Promise<Record<string, unknown>> {
  const snapshot = await getQueueSnapshot(roonClient, zoneId, 500);
  const first = snapshot.items[0];
  if (!first || first.queue_item_id === undefined) {
    throw new ApiError("QUEUE_NOT_READY", "The queue is empty", { zone_id: zoneId });
  }
  await playQueueItemFromHere(roonClient, zoneId, first.queue_item_id);
  return {
    ok: true,
    zone_id: zoneId,
    action: "restart_queue_playback",
    queue_item_id: first.queue_item_id
  };
}
