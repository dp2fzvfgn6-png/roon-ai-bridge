import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";

export function requireTransport(roonClient: RoonClient): any {
  if (!roonClient.isCoreConnected()) {
    throw new ApiError("ROON_NOT_CONNECTED", "Roon Core is not connected");
  }

  if (!roonClient.isTransportReady() || !roonClient.getTransport()) {
    throw new ApiError("TRANSPORT_NOT_READY", "Roon transport is not ready");
  }

  return roonClient.getTransport();
}
