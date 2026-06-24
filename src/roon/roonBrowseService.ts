import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";

export type BrowseHierarchy =
  | "browse"
  | "internet_radio"
  | "albums"
  | "artists"
  | "genres"
  | "composers";

export type BrowseRequest = {
  hierarchy: BrowseHierarchy;
  itemKey?: string;
  zoneOrOutputId?: string;
  offset: number;
  count: number;
  popAll: boolean;
  popLevels?: number;
  refreshList: boolean;
  sessionKey?: string;
};

export type BrowseResponse = {
  action: string;
  hierarchy: BrowseHierarchy;
  list: Record<string, unknown> | null;
  items: Record<string, unknown>[];
  offset: number;
  count: number;
  message: string | null;
  is_error: boolean | null;
};

export const browseImplemented = true;

function requireBrowse(roonClient: RoonClient): any {
  if (!roonClient.isCoreConnected()) {
    throw new ApiError("ROON_NOT_CONNECTED", "Roon Core is not connected");
  }

  if (!roonClient.isBrowseReady() || !roonClient.getBrowse()) {
    throw new ApiError("BROWSE_NOT_READY", "Roon browse is not ready");
  }

  return roonClient.getBrowse();
}

function browseCall(browse: any, opts: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    browse.browse(opts, (error: string | false, body: any) => {
      if (error) {
        reject(new ApiError("INTERNAL_ERROR", String(error), { opts }));
        return;
      }
      resolve(body);
    });
  });
}

function loadCall(browse: any, opts: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    browse.load(opts, (error: string | false, body: any) => {
      if (error) {
        reject(new ApiError("INTERNAL_ERROR", String(error), { opts }));
        return;
      }
      resolve(body);
    });
  });
}

export async function browseLibrary(
  roonClient: RoonClient,
  request: BrowseRequest
): Promise<BrowseResponse> {
  const browse = requireBrowse(roonClient);
  const browseOpts: Record<string, unknown> = {
    hierarchy: request.hierarchy
  };

  if (request.sessionKey) browseOpts.multi_session_key = request.sessionKey;
  if (request.itemKey) browseOpts.item_key = request.itemKey;
  if (request.zoneOrOutputId) browseOpts.zone_or_output_id = request.zoneOrOutputId;
  if (request.popAll) browseOpts.pop_all = true;
  if (typeof request.popLevels === "number") browseOpts.pop_levels = request.popLevels;
  if (request.refreshList) browseOpts.refresh_list = true;

  const browseResult = await browseCall(browse, browseOpts);
  if (browseResult.action !== "list") {
    return {
      action: browseResult.action,
      hierarchy: request.hierarchy,
      list: browseResult.list || null,
      items: [],
      offset: request.offset,
      count: request.count,
      message: browseResult.message || null,
      is_error:
        typeof browseResult.is_error === "boolean" ? browseResult.is_error : null
    };
  }

  const loadOpts: Record<string, unknown> = {
    hierarchy: request.hierarchy,
    offset: request.offset,
    count: request.count,
    set_display_offset: request.offset
  };

  if (request.sessionKey) loadOpts.multi_session_key = request.sessionKey;

  const loadResult = await loadCall(browse, loadOpts);

  return {
    action: browseResult.action,
    hierarchy: request.hierarchy,
    list: loadResult.list || browseResult.list || null,
    items: loadResult.items || [],
    offset:
      typeof loadResult.offset === "number" ? loadResult.offset : request.offset,
    count: request.count,
    message: null,
    is_error: null
  };
}
