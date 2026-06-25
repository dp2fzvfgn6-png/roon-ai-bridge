import { loadConfig } from "../config/env";
import { createRoonClient } from "../roon/roonClient";
import { PlaylistService } from "../services/playlistService";
import { OAuthService } from "../services/oauthService";
import { createStderrLogger } from "../utils/logger";
import { startMcpServer } from "./server";

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
const playlistService = new PlaylistService(config);
const oauthService = new OAuthService(config);

roonClient.start();

startMcpServer({
  config,
  logger,
  roonClient,
  playlistService,
  oauthService
}).catch((error) => {
  logger.error("MCP server failed", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exitCode = 1;
});
