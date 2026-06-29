import { loadConfig } from "../config/env";
import { createRoonClient } from "../roon/roonClient";
import { PlaylistService } from "../services/playlistService";
import { OAuthService } from "../services/oauthService";
import { RoonMediaService } from "../roon/roonMediaService";
import { createStderrLogger } from "../utils/logger";
import { startMcpServer } from "./server";
import { createDatabase } from "../db/database";

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

const roonClient = createRoonClient(config, logger);
const database = createDatabase(config);
const playlistService = new PlaylistService(config, database);
const oauthService = new OAuthService(config);
const mediaService = new RoonMediaService(roonClient, config.roonStreamingSource);

roonClient.start();

startMcpServer({
  config,
  logger,
  roonClient,
  playlistService,
  oauthService,
  mediaService
}).catch((error) => {
  logger.error("MCP server failed", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exitCode = 1;
});
