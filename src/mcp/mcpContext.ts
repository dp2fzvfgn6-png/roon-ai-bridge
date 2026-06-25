import { AppConfig } from "../config/env";
import { RoonClient } from "../roon/roonClient";
import { PlaylistService } from "../services/playlistService";
import { Logger } from "../utils/logger";

export type McpContext = {
  config: AppConfig;
  logger: Logger;
  roonClient: RoonClient;
  playlistService: PlaylistService;
};
