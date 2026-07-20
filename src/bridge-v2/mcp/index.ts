import { loadConfig } from "../../config/env";
import { createRoonClient } from "../../roon/roonClient";
import { PlaylistService } from "../../services/playlistService";
import { RoonMediaService } from "../../roon/roonMediaService";
import { createStderrLogger } from "../../utils/logger";
import { createDatabase } from "../../db/database";
import { SystemManagementService } from "../../services/systemManagementService";
import { ZonePresetService } from "../../services/zonePresetService";
import { VolumeLimitService } from "../../services/volumeLimitService";
import { startBridgeV2McpServer } from "./server";

const config = {
  ...loadConfig(),
  enableBrowse: true,
  enableMcp: true
};
const logger = createStderrLogger(config.logLevel);

logger.info("MCP configuration loaded", {
  dataDir: config.dataDir,
  browseEnabled: config.enableBrowse,
  mcpEnabled: config.enableMcp
});

const systemManagementService = new SystemManagementService(config, logger);
const roonClient = createRoonClient(config, logger, systemManagementService);
const database = createDatabase(config);
const playlistService = new PlaylistService(config, database);
const mediaService = new RoonMediaService(roonClient, config.roonStreamingSource);
const zonePresetService = new ZonePresetService(config, database);
const volumeLimitService = new VolumeLimitService(config, database);

roonClient.start();

startBridgeV2McpServer({
  config,
  logger,
  roonClient,
  playlistService,
  mediaService,
  systemManagementService,
  zonePresetService,
  volumeLimitService
}).catch((error) => {
  logger.error("MCP server failed", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exitCode = 1;
});
