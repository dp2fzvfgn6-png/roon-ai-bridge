import { ApiError } from "../utils/errors";
import { getQueueSnapshot, playQueueItemFromHere } from "./roonQueueService";
import { RoonClient } from "./roonClient";
import { RoonOutput, RoonZone } from "./roonTypes";
import { requireTransport } from "./roonTransportService";
import { getZoneOrThrow } from "./roonZoneService";

type TransportSettings = {
  shuffle?: boolean;
  auto_radio?: boolean;
  loop?: "loop" | "loop_one" | "disabled" | "next";
};

function transportCall(
  invoke: (callback: (error: string | false) => void) => void,
  operation: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    invoke((error) => {
      if (error) {
        reject(new ApiError("INTERNAL_ERROR", `${operation} failed`, { error }));
        return;
      }
      resolve();
    });
  });
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

export function listOutputs(roonClient: RoonClient): RoonOutput[] {
  requireTransport(roonClient);
  return roonClient.getOutputs();
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
  return { ok: true, zone_id: zoneId, mode, seconds };
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
  return { ok: true, output_id: outputId, action: how };
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
  await transportCall(
    (callback) => transport.change_volume(output, mode, value, callback),
    "change output volume"
  );
  return { ok: true, output_id: outputId, mode, value };
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
  return { ok: true, action: how };
}

export async function pauseAll(
  roonClient: RoonClient
): Promise<Record<string, unknown>> {
  const transport = requireTransport(roonClient);
  await transportCall((callback) => transport.pause_all(callback), "pause_all");
  return { ok: true, action: "pause_all" };
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
    (callback) => transport[action](output, options, callback),
    action
  );
  return { ok: true, output_id: outputId, action, control_key: controlKey || null };
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
  return { ok: true, zone_id: zoneId, settings: accepted };
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
