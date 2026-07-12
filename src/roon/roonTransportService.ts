import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";
import { RoonTransportApi } from "./roonSdk";

export function requireTransport(roonClient: RoonClient): RoonTransportApi {
  if (!roonClient.isCoreConnected()) {
    throw new ApiError("ROON_NOT_CONNECTED", "Roon Core is not connected");
  }

  const transport = roonClient.getTransport();
  if (!roonClient.isTransportReady() || !transport) {
    throw new ApiError("TRANSPORT_NOT_READY", "Roon transport is not ready");
  }

  return transport;
}
