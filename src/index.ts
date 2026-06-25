import { loadConfig } from "./config/env";
import { createServer } from "./api/server";
import { createRoonClient } from "./roon/roonClient";
import { PlaylistService } from "./services/playlistService";
import { OAuthService } from "./services/oauthService";
import { createLogger } from "./utils/logger";

const config = loadConfig();
const logger = createLogger(config.logLevel);

logger.info("Configuration loaded", {
  port: config.port,
  nodeEnv: config.nodeEnv,
  dataDir: config.dataDir,
  browseEnabled: config.enableBrowse,
  mcpEnabled: config.enableMcp,
  authEnabled: config.enableAuth,
  apiTokenConfigured: Boolean(config.apiToken)
});

const roonClient = createRoonClient(config, logger);
const playlistService = new PlaylistService(config);
const oauthService = new OAuthService(config);
const app = createServer({
  config,
  logger,
  roonClient,
  playlistService,
  oauthService
});

logger.info("Starting service", {
  service: "roon-ai-bridge",
  extensionName: config.roonExtensionName
});

roonClient.start();

app.listen(config.port, "0.0.0.0", () => {
  logger.info("HTTP server listening", { port: config.port });
});
