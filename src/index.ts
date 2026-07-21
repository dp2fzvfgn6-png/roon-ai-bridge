import { loadConfig } from "./config/env";
import { createServer } from "./api/server";
import { createPortalServer } from "./portal/server";
import { createApplication } from "./app/createApplication";
import { closeHttpServer } from "./app/shutdown";

const config = loadConfig();
const runtime = createApplication(config);
const { context } = runtime;
const { logger, roonClient, systemManagementService } = context;

logger.info("Configuration loaded", {
  port: config.port,
  portalPort: config.portalPort,
  portalEnabled: config.enablePortal,
  nodeEnv: config.nodeEnv,
  dataDir: config.dataDir,
  browseEnabled: config.enableBrowse,
  mcpEnabled: config.enableMcp,
  authEnabled: config.enableAuth,
  automaticUpdateChecks: config.automaticUpdateChecks,
  debugMode: config.debugMode,
  apiTokenConfigured: Boolean(config.apiToken),
  roonStreamingSource: config.roonStreamingSource
});

const app = createServer(context);

logger.info("Starting service", {
  service: "roon-ai-bridge",
  extensionName: config.roonExtensionName
});

roonClient.start();

const apiServer = app.listen(config.port, "0.0.0.0", () => {
  logger.info("HTTP server listening", { port: config.port });
});

let portalServer: ReturnType<ReturnType<typeof createPortalServer>["listen"]> | null = null;
if (config.enablePortal) {
  const portal = createPortalServer(context);
  portalServer = portal.listen(config.portalPort, "0.0.0.0", () => {
    logger.info("Administration portal listening", {
      port: config.portalPort,
      authenticationConfigured: Boolean(config.portalAdminToken)
    });
  });
}

systemManagementService.startAutomaticChecks();

let shutdownPromise: Promise<void> | null = null;
function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    logger.warn("Graceful shutdown requested", { signal });
    systemManagementService.stopAutomaticChecks();
    const results = await Promise.all([
      closeHttpServer(apiServer),
      closeHttpServer(portalServer)
    ]);
    logger.info("HTTP listeners closed", {
      api: results[0],
      portal: results[1]
    });
    runtime.shutdown();
  })().catch((error) => {
    process.exitCode = 1;
    try {
      logger.error("Graceful shutdown failed", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    } finally {
      apiServer.closeAllConnections?.();
      portalServer?.closeAllConnections?.();
      runtime.shutdown();
    }
  });
  return shutdownPromise;
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
