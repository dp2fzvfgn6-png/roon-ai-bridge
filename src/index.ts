import { loadConfig } from "./config/env";
import { createServer } from "./api/server";
import { createRoonClient } from "./roon/roonClient";
import { PlaylistService } from "./services/playlistService";
import { OAuthService } from "./services/oauthService";
import { RoonMediaService } from "./roon/roonMediaService";
import { createLogger } from "./utils/logger";
import { createDatabase } from "./db/database";
import { ApiKeyService } from "./services/apiKeyService";
import { createPortalServer } from "./portal/server";
import { PortalAuthService } from "./services/portalAuthService";
import { SystemManagementService } from "./services/systemManagementService";
import { ZonePresetService } from "./services/zonePresetService";
import { OutputVolumeSettingsService } from "./services/outputVolumeSettingsService";
import { VolumeLimitService } from "./services/volumeLimitService";
import { ActionLogService } from "./services/actionLogService";
import { TechnicalLogService, createObservedLogger } from "./services/technicalLogService";
import { ExtensionManagerService } from "./services/extensionManagerService";
import { DiagnosticsService } from "./services/diagnosticsService";
import { ToolAccessService } from "./services/toolAccessService";
import { HomeHistoryService } from "./services/homeHistoryService";

const config = loadConfig();
const baseLogger = createLogger(config.logLevel);
const database = createDatabase(config);
const technicalLogService = new TechnicalLogService(database);
const logger = createObservedLogger(baseLogger, technicalLogService);

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

const systemManagementService = new SystemManagementService(config, logger);
const roonClient = createRoonClient(config, logger, systemManagementService);
const playlistService = new PlaylistService(config, database);
const oauthService = new OAuthService(config);
const mediaService = new RoonMediaService(roonClient, config.roonStreamingSource);
const apiKeyService = new ApiKeyService(config, database);
const toolAccessService = new ToolAccessService(database);
const portalAuthService = new PortalAuthService(config, database);
const zonePresetService = new ZonePresetService(config, database);
const outputVolumeSettingsService = new OutputVolumeSettingsService(
  config,
  database
);
const volumeLimitService = new VolumeLimitService(config, database);
const actionLogService = new ActionLogService(database);
const homeHistoryService = new HomeHistoryService(database);
const extensionManagerService = new ExtensionManagerService(config, technicalLogService);
const context = {
  config,
  logger,
  roonClient,
  playlistService,
  oauthService,
  mediaService,
  apiKeyService,
  portalAuthService,
  systemManagementService,
  zonePresetService,
  outputVolumeSettingsService,
  volumeLimitService,
  actionLogService,
  homeHistoryService,
  technicalLogService,
  extensionManagerService,
  toolAccessService
};
const diagnosticsService = new DiagnosticsService(
  config,
  database,
  roonClient,
  actionLogService,
  technicalLogService,
  extensionManagerService,
  context
);
(context as any).diagnosticsService = diagnosticsService;
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
