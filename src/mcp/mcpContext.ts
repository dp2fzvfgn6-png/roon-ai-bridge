import { AppConfig } from "../config/env";
import { RoonClient } from "../roon/roonClient";
import { PlaylistService } from "../services/playlistService";
import { OAuthService } from "../services/oauthService";
import { Logger } from "../utils/logger";

export type McpContext = {
  config: AppConfig;
  logger: Logger;
  roonClient: RoonClient;
  playlistService: PlaylistService;
  oauthService: OAuthService;
};
