import { ApiError } from "../utils/errors";
import { RoonClient } from "./roonClient";
import { getZoneOrThrow } from "./roonZoneService";

export type BrowseHierarchy =
  | "browse"
  | "internet_radio"
  | "albums"
  | "artists"
  | "genres"
  | "composers";

export type BrowseItem = {
  title: string;
  subtitle?: string | null;
  image_key?: string | null;
  item_key?: string;
  hint?: string | null;
  [key: string]: unknown;
};

export type BrowseList = {
  level: number;
  title: string;
  subtitle?: string | null;
  image_key?: string | null;
  count: number;
  display_offset?: number;
  hint?: string | null;
  [key: string]: unknown;
};

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
  hierarchy: BrowseHierarchy | "search";
  list: BrowseList | null;
  items: BrowseItem[];
  offset: number;
  count: number;
  message: string | null;
  is_error: boolean | null;
};

export type SearchRequest = {
  query: string;
  zoneOrOutputId?: string;
  offset: number;
  count: number;
  sessionKey?: string;
};

export type PlayByQueryRequest = {
  zoneId: string;
  query: string;
  sessionKey?: string;
};

export type PlayByQueryResponse = {
  ok: boolean;
  zone_id: string;
  query: string;
  selected: BrowseItem;
  action: string;
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

function asItems(value: unknown): BrowseItem[] {
  return Array.isArray(value) ? (value as BrowseItem[]) : [];
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function titleLooksPlayable(title: string): boolean {
  const normalized = title.toLowerCase();
  if (normalized.startsWith("play ") || normalized.startsWith("reproducir ")) {
    return true;
  }

  return [
    "play",
    "play now",
    "play album",
    "play track",
    "play from here",
    "reproducir",
    "reproducir ahora"
  ].some((candidate) => normalized === candidate);
}

function choosePlayableItem(items: BrowseItem[]): BrowseItem | null {
  return (
    items.find(
      (item) =>
        item.item_key &&
        item.hint !== "header" &&
        titleLooksPlayable(String(item.title || ""))
    ) ||
    items.find((item) => item.item_key && item.hint === "action") ||
    items.find((item) => item.item_key && item.hint === "action_list") ||
    null
  );
}

function chooseSearchResult(items: BrowseItem[]): BrowseItem | null {
  return (
    items.find(
      (item) =>
        item.item_key &&
        item.hint !== "header" &&
        !titleLooksPlayable(String(item.title || ""))
    ) || null
  );
}

async function loadCurrentList(
  browse: any,
  hierarchy: BrowseHierarchy | "search",
  sessionKey: string | undefined,
  offset: number,
  count: number
): Promise<BrowseResponse> {
  const loadOpts: Record<string, unknown> = {
    hierarchy,
    offset,
    count,
    set_display_offset: offset
  };

  if (sessionKey) loadOpts.multi_session_key = sessionKey;

  const loadResult = await loadCall(browse, loadOpts);

  return {
    action: "list",
    hierarchy,
    list: loadResult.list || null,
    items: asItems(loadResult.items),
    offset:
      typeof loadResult.offset === "number" ? loadResult.offset : offset,
    count,
    message: null,
    is_error: null
  };
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

  const loaded = await loadCurrentList(
    browse,
    request.hierarchy,
    request.sessionKey,
    request.offset,
    request.count
  );

  return {
    ...loaded,
    action: browseResult.action,
    list: loaded.list || browseResult.list || null
  };
}

export async function searchRoon(
  roonClient: RoonClient,
  request: SearchRequest
): Promise<BrowseResponse> {
  const query = normalizeQuery(request.query);
  if (!query) {
    throw new ApiError("INVALID_SEARCH_QUERY", "Search query is required");
  }

  const browse = requireBrowse(roonClient);
  const browseOpts: Record<string, unknown> = {
    hierarchy: "search",
    input: query,
    pop_all: true
  };

  if (request.sessionKey) browseOpts.multi_session_key = request.sessionKey;
  if (request.zoneOrOutputId) browseOpts.zone_or_output_id = request.zoneOrOutputId;

  const browseResult = await browseCall(browse, browseOpts);
  if (browseResult.action !== "list") {
    return {
      action: browseResult.action,
      hierarchy: "search",
      list: browseResult.list || null,
      items: [],
      offset: request.offset,
      count: request.count,
      message: browseResult.message || null,
      is_error:
        typeof browseResult.is_error === "boolean" ? browseResult.is_error : null
    };
  }

  return {
    ...(await loadCurrentList(
      browse,
      "search",
      request.sessionKey,
      request.offset,
      request.count
    )),
    action: browseResult.action
  };
}

export async function playByQuery(
  roonClient: RoonClient,
  request: PlayByQueryRequest
): Promise<PlayByQueryResponse> {
  const query = normalizeQuery(request.query);
  if (!query) {
    throw new ApiError("INVALID_SEARCH_QUERY", "Search query is required");
  }

  getZoneOrThrow(roonClient, request.zoneId);

  const browse = requireBrowse(roonClient);
  const sessionKey =
    request.sessionKey || `roon-ai-bridge-play-${Date.now().toString(36)}`;

  const searchResult = await searchRoon(roonClient, {
    query,
    zoneOrOutputId: request.zoneId,
    offset: 0,
    count: 25,
    sessionKey
  });

  let selected = choosePlayableItem(searchResult.items) || chooseSearchResult(searchResult.items);
  if (!selected?.item_key) {
    throw new ApiError("SEARCH_NO_RESULTS", "No playable search results found", {
      query,
      candidates: searchResult.items.slice(0, 10)
    });
  }

  for (let depth = 0; depth < 4; depth += 1) {
    const browseResult = await browseCall(browse, {
      hierarchy: "search",
      multi_session_key: sessionKey,
      item_key: selected.item_key,
      zone_or_output_id: request.zoneId
    });

    if (browseResult.action !== "list") {
      return {
        ok: !browseResult.is_error,
        zone_id: request.zoneId,
        query,
        selected,
        action: browseResult.action,
        message: browseResult.message || null,
        is_error:
          typeof browseResult.is_error === "boolean" ? browseResult.is_error : null
      };
    }

    const actionList = await loadCurrentList(
      browse,
      "search",
      sessionKey,
      0,
      25
    );
    const playable = choosePlayableItem(actionList.items);
    if (!playable?.item_key) {
      const nextSelected = chooseSearchResult(actionList.items);
      if (!nextSelected?.item_key || nextSelected.item_key === selected.item_key) break;
      selected = nextSelected;
      continue;
    }

    selected = playable;
  }

  throw new ApiError("PLAYBACK_ACTION_NOT_FOUND", "Could not find a playback action for query", {
    query,
    zone_id: request.zoneId,
    selected
  });
}
