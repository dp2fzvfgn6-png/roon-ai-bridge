import fs from "fs";
import path from "path";
import RoonApi = require("node-roon-api");
import RoonApiBrowse = require("node-roon-api-browse");
import RoonApiTransport = require("node-roon-api-transport");
import { AppConfig } from "../config/env";
import { APP_VERSION } from "../config/version";
import { Logger } from "../utils/logger";
import { RoonZone } from "./roonTypes";

export type RoonClient = {
  start(): void;
  getCoreName(): string | null;
  isCoreConnected(): boolean;
  isTransportReady(): boolean;
  isBrowseReady(): boolean;
  getTransport(): any | null;
  getBrowse(): any | null;
  getZones(): RoonZone[];
  getZone(zoneId: string): RoonZone | null;
};

export function createRoonClient(config: AppConfig, logger: Logger): RoonClient {
  const stateFile = path.join(config.dataDir, "roonstate.json");
  let currentCore: any | null = null;
  let transport: any | null = null;
  let browse: any | null = null;
  let transportReady = false;
  let browseReady = false;
  let zonesById = new Map<string, RoonZone>();

  function ensureDataDir(): void {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }

  function readRoonState(): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      return {};
    }
  }

  function writeRoonState(state: Record<string, unknown>): void {
    ensureDataDir();
    fs.writeFileSync(stateFile, JSON.stringify(state || {}, null, 2));
  }

  function refreshZonesFromTransport(): void {
    if (!transport || !transport._zones) {
      zonesById = new Map();
      return;
    }

    zonesById = new Map(
      Object.values(transport._zones).map((zone: any) => [zone.zone_id, zone])
    );
  }

  ensureDataDir();

  const roon = new RoonApi({
    extension_id: config.roonExtensionId,
    display_name: config.roonExtensionName,
    display_version: APP_VERSION,
    publisher: "Local",
    email: "local@localhost",
    website: "http://localhost",
    log_level: process.env.ROON_LOG_LEVEL || "none",
    force_server: true,
    get_persisted_state: readRoonState,
    set_persisted_state: writeRoonState,
    moo_onerror: (moo: any) => {
      logger.error("Roon API connection error", {
        coreId: moo?.core?.core_id || null
      });
    },
    core_paired: (core: any) => {
      currentCore = core;
      transport = core.services.RoonApiTransport;
      browse = core.services.RoonApiBrowse || null;
      transportReady = Boolean(transport);
      browseReady = Boolean(browse);

      logger.info("Authorization completed and core connected", {
        coreId: core.core_id,
        coreName: core.display_name,
        transportReady,
        browseReady
      });

      if (!transport) {
        logger.error("Roon transport service is not available");
        return;
      }

      transport.subscribe_zones((event: string, data: any) => {
        refreshZonesFromTransport();
        logger.info("Zones changed", {
          event,
          zonesCount: zonesById.size,
          added: data?.zones_added?.length,
          changed: data?.zones_changed?.length,
          removed: data?.zones_removed?.length
        });
      });
    },
    core_unpaired: (core: any) => {
      logger.warn("Core disconnected or unpaired", {
        coreId: core.core_id,
        coreName: core.display_name
      });
      currentCore = null;
      transport = null;
      browse = null;
      transportReady = false;
      browseReady = false;
      zonesById = new Map();
    }
  });

  const requiredServices = config.enableBrowse
    ? [RoonApiTransport, RoonApiBrowse]
    : [RoonApiTransport];

  roon.init_services({
    required_services: requiredServices
  });

  return {
    start() {
      logger.info("Starting Roon Core discovery");
      logger.info(
        "Authorization pending: enable the extension in Roon Settings > Setup > Extensions"
      );
      roon.start_discovery();
    },
    getCoreName() {
      return currentCore ? currentCore.display_name : null;
    },
    isCoreConnected() {
      return Boolean(currentCore);
    },
    isTransportReady() {
      return transportReady;
    },
    isBrowseReady() {
      return browseReady;
    },
    getTransport() {
      return transport;
    },
    getBrowse() {
      return browse;
    },
    getZones() {
      return Array.from(zonesById.values());
    },
    getZone(zoneId: string) {
      return zonesById.get(zoneId) || null;
    }
  };
}
