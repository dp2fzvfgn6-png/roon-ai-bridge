import { Server } from "http";

export type ServerCloseResult = "not_running" | "graceful" | "forced";

export function closeHttpServer(
  server: Server | null,
  timeoutMs = 10_000
): Promise<ServerCloseResult> {
  if (!server?.listening) return Promise.resolve("not_running");

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: ServerCloseResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      finish("forced");
    }, Math.max(1, timeoutMs));
    timer.unref();

    server.close((error) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      finish("graceful");
    });
    server.closeIdleConnections?.();
  });
}
