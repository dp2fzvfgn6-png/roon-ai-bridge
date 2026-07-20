import { loadConfig } from "./config/env";
import { createServer } from "./api/server";
import { createPortalServer } from "./portal/server";
import { createApplication } from "./app/createApplication";

const config = loadConfig();
const { context } = createApplication(config);
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

app.listen(config.port, "0.0.0.0", () => {
  logger.info("HTTP server listening", { port: config.port });
});

if (config.enablePortal) {
  const portal = createPortalServer(context);
  portal.listen(config.portalPort, "0.0.0.0", () => {
    logger.info("Administration portal listening", {
      port: config.portalPort,
      authenticationConfigured: Boolean(config.portalAdminToken)
    });
  });
}

systemManagementService.startAutomaticChecks();
