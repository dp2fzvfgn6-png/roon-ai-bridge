import { AppConfig } from "../config/env";
import { RoonClient } from "../roon/roonClient";
import { PlaylistService } from "../services/playlistService";
import { OAuthService } from "../services/oauthService";
import { RoonMediaService } from "../roon/roonMediaService";
import { Logger } from "../utils/logger";
import { ZonePresetService } from "../services/zonePresetService";
import { VolumeLimitService } from "../services/volumeLimitService";

export type McpContext = {
  config: AppConfig;
  logger: Logger;
  roonClient: RoonClient;
  playlistService: PlaylistService;
  oauthService: OAuthService;
  mediaService: RoonMediaService;
  zonePresetService: ZonePresetService;
  volumeLimitService: VolumeLimitService;
};
