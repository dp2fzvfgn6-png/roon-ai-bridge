import { ApiError, ErrorCode } from "../utils/errors";
import { RoonOutput, RoonZone } from "./roonTypes";

export const ROON_REQUEST_TIMEOUT_MS = 8000;

export type RoonSubscription = {
  unsubscribe(callback?: (message?: unknown) => void): void;
};

export type RoonSdkMessage = {
  name?: string;
  [key: string]: unknown;
};

type ResultCallback = (error: string | false) => void;

export interface RoonTransportApi {
  subscribe_zones(callback: (event: string | false, data: any) => void): RoonSubscription;
  subscribe_outputs(callback: (event: string | false, data: any) => void): RoonSubscription;
  subscribe_queue(
    zone: RoonZone,
    maxItemCount: number,
    callback: (event: string | false, data: unknown) => void
  ): RoonSubscription;
  get_outputs(callback: (error: string | false, body: { outputs?: RoonOutput[] }) => void): void;
  control(zone: RoonZone, command: string, callback: ResultCallback): void;
  transfer_zone(source: RoonZone, target: RoonZone, callback: ResultCallback): void;
  group_outputs(outputs: RoonOutput[], callback: ResultCallback): void;
  ungroup_outputs(outputs: RoonOutput[], callback: ResultCallback): void;
  change_volume(output: RoonOutput, mode: string, value: number, callback: ResultCallback): void;
  mute(output: RoonOutput, how: string, callback: ResultCallback): void;
  mute_all(how: string, callback: ResultCallback): void;
  pause_all(callback: ResultCallback): void;
  seek(zone: RoonZone, mode: string, seconds: number, callback: ResultCallback): void;
  standby(output: RoonOutput, options: Record<string, unknown>, callback: ResultCallback): void;
  toggle_standby(output: RoonOutput, options: Record<string, unknown>, callback: ResultCallback): void;
  convenience_switch(output: RoonOutput, options: Record<string, unknown>, callback: ResultCallback): void;
  change_settings(zone: RoonZone, settings: Record<string, unknown>, callback: ResultCallback): void;
  play_from_here(
    zone: RoonZone,
    queueItemId: string | number,
    callback: (message: RoonSdkMessage | null, body: unknown) => void
  ): void;
}

export interface RoonBrowseApi {
  browse(
    options: Record<string, unknown>,
    callback: (error: string | false, body: any) => void
  ): void;
  load(
    options: Record<string, unknown>,
    callback: (error: string | false, body: any) => void
  ): void;
}

export interface RoonImageApi {
  get_image(
    imageKey: string,
    options: Record<string, unknown>,
    callback: (error: string | false, contentType: string, bytes: Buffer) => void
  ): void;
}

export function roonSdkCall<T>(
  operation: string,
  invoke: (callback: (error: unknown, value?: T) => void) => void,
  details: Record<string, unknown> = {},
  options: { timeoutMs?: number; errorCode?: ErrorCode } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? ROON_REQUEST_TIMEOUT_MS;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ApiError("ROON_REQUEST_TIMEOUT", `${operation} timed out`, {
        operation,
        timeout_ms: timeoutMs,
        ...details
      }));
    }, timeoutMs);

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    try {
      invoke((error, value) => {
        if (error) {
          finish(() => reject(new ApiError(
            options.errorCode || "INTERNAL_ERROR",
            `${operation} failed: ${String(error)}`,
            { operation, error: String(error), ...details }
          )));
          return;
        }
        finish(() => resolve(value as T));
      });
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export async function waitForRoonState<T>(
  read: () => T | null,
  matches: (value: T) => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<T | null> {
  const deadline = Date.now() + (options.timeoutMs ?? ROON_REQUEST_TIMEOUT_MS);
  const intervalMs = options.intervalMs ?? 200;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== null && matches(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const finalValue = read();
  return finalValue !== null && matches(finalValue) ? finalValue : null;
}
