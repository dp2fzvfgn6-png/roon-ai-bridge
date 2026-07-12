import { ApiError } from "../utils/errors";
import { cleanRoonDisplayText, hasRoonDisplayLink } from "./roonText";
import { RoonClient } from "./roonClient";
import { getZoneOrThrow } from "./roonZoneService";

export type BrowseHierarchy =
  | "browse"
  | "internet_radio"
  | "albums"
  | "artists"
  | "genres"
  | "composers"
  | "playlists"
  | "settings";

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
  input?: string;
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
  item?: BrowseItem | null;
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

export type QueueByQueryMode = "add_next" | "add_to_queue";

export type QueueByQueryRequest = {
  zoneId: string;
  query: string;
  mode: QueueByQueryMode;
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

export type QueueByQueryResponse = {
  ok: boolean;
  zone_id: string;
  query: string;
  mode: QueueByQueryMode;
  selected: BrowseItem;
  action: string;
  message: string | null;
  is_error: boolean | null;
};

export type QueueActionInspection = {
  zone_id: string;
  query: string;
  selected: BrowseItem;
  actions: BrowseItem[];
};

type ItemKeyActionRequest = {
  zoneId: string;
  itemKey: string;
  label?: string;
  sessionKey?: string;
};

export const browseImplemented = true;

export function requireBrowse(roonClient: RoonClient): any {
  if (!roonClient.isCoreConnected()) {
    throw new ApiError("ROON_NOT_CONNECTED", "Roon Core is not connected");
  }

  if (!roonClient.isBrowseReady() || !roonClient.getBrowse()) {
    throw new ApiError("BROWSE_NOT_READY", "Roon browse is not ready");
  }

  return roonClient.getBrowse();
}

export function browseCall(browse: any, opts: Record<string, unknown>): Promise<any> {
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

export function loadCall(browse: any, opts: Record<string, unknown>): Promise<any> {
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

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function pickNumber(item: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function coverPayload(imageKey: string | null): Record<string, unknown> | null {
  return imageKey ? { image_key: imageKey } : null;
}

export function enrichBrowseItem(item: BrowseItem): BrowseItem {
  const raw = asObject(item) || {};
  const rawMedia = asObject(raw.media) || {};
  const roonLinkedMetadata = raw.roon_linked_metadata === true || [
    raw.title,
    raw.subtitle,
    raw.artist,
    raw.album,
    raw.album_artist,
    rawMedia.artist,
    rawMedia.album,
    rawMedia.album_artist
  ].some(hasRoonDisplayLink);
  const imageKey =
    typeof item.image_key === "string" && item.image_key.trim() !== ""
      ? item.image_key.trim()
      : pickString(raw, ["album_art_key", "artwork_key", "cover_key"]);

  const title = cleanRoonDisplayText(pickString(raw, ["title"]));
  const subtitle = cleanRoonDisplayText(pickString(raw, ["subtitle"]));
  const media = {
    title,
    subtitle,
    artist: cleanRoonDisplayText(pickString(rawMedia, ["artist", "artist_name"]) || pickString(raw, ["artist", "artist_name"])),
    album: cleanRoonDisplayText(pickString(rawMedia, ["album", "album_name"]) || pickString(raw, ["album", "album_name"])),
    album_artist: cleanRoonDisplayText(pickString(rawMedia, ["album_artist", "albumartist"]) || pickString(raw, ["album_artist", "albumartist"])),
    composer: cleanRoonDisplayText(pickString(raw, ["composer"])),
    genre: raw.genre ?? raw.genres ?? null,
    track_number: pickNumber(raw, ["track_number", "track"]) ?? null,
    disc_number: pickNumber(raw, ["disc_number", "disc"]) ?? null,
    duration_seconds:
      pickNumber(raw, ["duration_seconds", "duration", "length"]) ?? null,
    release_year: pickNumber(raw, ["release_year", "year"]) ?? null,
    roon_item_key: pickString(raw, ["item_key"]) || null,
    image_key: imageKey || null,
    source: rawMedia.source ?? raw.source ?? raw.source_context ?? null,
    quality: rawMedia.quality ?? raw.quality ?? raw.audio_quality ?? null,
    cover: coverPayload(imageKey || null)
  };

  return {
    ...item,
    title: title || item.title,
    subtitle,
    roon_linked_metadata: roonLinkedMetadata,
    image_key: imageKey || item.image_key || null,
    media
  };
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

function titleLooksLikeQueueAction(title: string, mode: QueueByQueryMode): boolean {
  const normalized = title.toLowerCase();
  const compact = normalized.replace(/\s+/g, " ").trim();

  if (mode === "add_next") {
    return [
      "add next",
      "play next",
      "add to next",
      "add as next",
      "anadir siguiente",
      "anadir como siguiente",
      "reproducir siguiente"
    ].some((candidate) => compact === candidate || compact.startsWith(`${candidate} `));
  }

  return [
    "queue",
    "add to queue",
    "add at end",
    "add to end",
    "add to end of queue",
    "add to queue end",
    "add last",
    "append to queue",
    "anadir al final",
    "anadir al final de la cola"
  ].some((candidate) => compact === candidate || compact.startsWith(`${candidate} `));
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

function choosePlaybackStep(items: BrowseItem[]): BrowseItem | null {
  return (
    items.find(
      (item) =>
        item.item_key &&
        item.hint === "action" &&
        titleLooksPlayable(String(item.title || ""))
    ) ||
    items.find((item) => item.item_key && item.hint === "action") ||
    items.find(
      (item) =>
        item.item_key &&
        item.hint !== "header" &&
        titleLooksPlayable(String(item.title || ""))
    ) ||
    items.find((item) => item.item_key && item.hint === "action_list") ||
    items.find((item) => item.item_key && item.hint === "list") ||
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

function chooseQueueAction(items: BrowseItem[], mode: QueueByQueryMode): BrowseItem | null {
  return (
    items.find(
      (item) =>
        item.item_key &&
        item.hint !== "header" &&
        titleLooksLikeQueueAction(String(item.title || ""), mode)
    ) || null
  );
}

function chooseQueueStep(items: BrowseItem[], mode: QueueByQueryMode): BrowseItem | null {
  return (
    items.find(
      (item) =>
        item.item_key &&
        item.hint === "action" &&
        titleLooksLikeQueueAction(String(item.title || ""), mode)
    ) ||
    items.find(
      (item) =>
        item.item_key &&
        item.hint !== "header" &&
        titleLooksLikeQueueAction(String(item.title || ""), mode)
    ) ||
    items.find((item) => item.item_key && item.hint === "action_list") ||
    items.find((item) => item.item_key && item.hint === "list") ||
    null
  );
}

function actionItems(items: BrowseItem[]): BrowseItem[] {
  return items.filter(
    (item) =>
      item.item_key &&
      item.hint !== "header" &&
      (item.hint === "action" ||
        item.hint === "action_list" ||
        titleLooksPlayable(String(item.title || "")) ||
        titleLooksLikeQueueAction(String(item.title || ""), "add_next") ||
        titleLooksLikeQueueAction(String(item.title || ""), "add_to_queue"))
  );
}

export async function loadCurrentList(
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
    items: asItems(loadResult.items).map(enrichBrowseItem),
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
  if (typeof request.input === "string") browseOpts.input = request.input;

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
        typeof browseResult.is_error === "boolean" ? browseResult.is_error : null,
      item: browseResult.item ? enrichBrowseItem(browseResult.item) : null
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

export async function runBrowseAction(
  roonClient: RoonClient,
  request: {
    hierarchy: BrowseHierarchy | "search";
    itemKey: string;
    sessionKey?: string;
    zoneOrOutputId?: string;
    input?: string;
    count?: number;
  }
): Promise<BrowseResponse> {
  if (!request.itemKey?.trim()) {
    throw new ApiError("INVALID_BROWSE_ACTION", "item_key is required");
  }
  const browse = requireBrowse(roonClient);
  const opts: Record<string, unknown> = {
    hierarchy: request.hierarchy,
    item_key: request.itemKey
  };
  if (request.sessionKey) opts.multi_session_key = request.sessionKey;
  if (request.zoneOrOutputId) {
    opts.zone_or_output_id = request.zoneOrOutputId;
  }
  if (typeof request.input === "string") opts.input = request.input;

  const result = await browseCall(browse, opts);
  if (result.action === "list") {
    const loaded = await loadCurrentList(
      browse,
      request.hierarchy,
      request.sessionKey,
      0,
      Math.max(1, Math.min(request.count || 100, 500))
    );
    return {
      ...loaded,
      action: "list",
      list: loaded.list || result.list || null,
      item: result.item ? enrichBrowseItem(result.item) : null
    };
  }
  return {
    action: result.action || "none",
    hierarchy: request.hierarchy,
    list: result.list || null,
    items: [],
    offset: 0,
    count: 0,
    message: result.message || null,
    is_error: typeof result.is_error === "boolean" ? result.is_error : null,
    item: result.item ? enrichBrowseItem(result.item) : null
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
    const nextSelected =
      choosePlaybackStep(actionList.items) || chooseSearchResult(actionList.items);
    if (!nextSelected?.item_key || nextSelected.item_key === selected.item_key) break;
    selected = nextSelected;
  }

  throw new ApiError("PLAYBACK_ACTION_NOT_FOUND", "Could not find a playback action for query", {
    query,
    zone_id: request.zoneId,
    selected
  });
}

export async function playByItemKey(
  roonClient: RoonClient,
  request: ItemKeyActionRequest
): Promise<PlayByQueryResponse> {
  getZoneOrThrow(roonClient, request.zoneId);
  const browse = requireBrowse(roonClient);
  const sessionKey =
    request.sessionKey || `roon-ai-bridge-play-key-${Date.now().toString(36)}`;
  let selected: BrowseItem = {
    title: request.label || request.itemKey,
    item_key: request.itemKey
  };
  let lastActions: BrowseItem[] = [];

  for (let depth = 0; depth < 6; depth += 1) {
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
        query: request.label || request.itemKey,
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
      50
    );
    lastActions = actionItems(actionList.items);
    const next = choosePlaybackStep(actionList.items);
    if (!next?.item_key || next.item_key === selected.item_key) break;
    selected = next;
  }

  throw new ApiError("PLAYBACK_ACTION_NOT_FOUND", "Could not find a playback action for stored item key", {
    item_key: request.itemKey,
    label: request.label,
    zone_id: request.zoneId,
    available_actions: lastActions
  });
}

export async function queueByQuery(
  roonClient: RoonClient,
  request: QueueByQueryRequest
): Promise<QueueByQueryResponse> {
  const query = normalizeQuery(request.query);
  if (!query) {
    throw new ApiError("INVALID_SEARCH_QUERY", "Search query is required");
  }

  getZoneOrThrow(roonClient, request.zoneId);

  const browse = requireBrowse(roonClient);
  const sessionKey =
    request.sessionKey || `roon-ai-bridge-queue-${Date.now().toString(36)}`;

  const searchResult = await searchRoon(roonClient, {
    query,
    zoneOrOutputId: request.zoneId,
    offset: 0,
    count: 25,
    sessionKey
  });

  let selected = chooseSearchResult(searchResult.items);
  let lastActions: BrowseItem[] = [];
  if (!selected?.item_key) {
    throw new ApiError("SEARCH_NO_RESULTS", "No queueable search results found", {
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
        mode: request.mode,
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
    lastActions = actionItems(actionList.items);
    const nextSelected =
      chooseQueueStep(actionList.items, request.mode) || chooseSearchResult(actionList.items);
    if (!nextSelected?.item_key || nextSelected.item_key === selected.item_key) break;
    selected = nextSelected;
  }

  throw new ApiError("QUEUE_ACTION_NOT_FOUND", "Could not find a queue action for query", {
    query,
    zone_id: request.zoneId,
    mode: request.mode,
    selected,
    available_actions: lastActions
  });
}

export async function queueByItemKey(
  roonClient: RoonClient,
  request: ItemKeyActionRequest & { mode: QueueByQueryMode }
): Promise<QueueByQueryResponse> {
  getZoneOrThrow(roonClient, request.zoneId);
  const browse = requireBrowse(roonClient);
  const sessionKey =
    request.sessionKey || `roon-ai-bridge-queue-key-${Date.now().toString(36)}`;
  let selected: BrowseItem = {
    title: request.label || request.itemKey,
    item_key: request.itemKey
  };
  let lastActions: BrowseItem[] = [];

  for (let depth = 0; depth < 6; depth += 1) {
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
        query: request.label || request.itemKey,
        mode: request.mode,
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
      50
    );
    lastActions = actionItems(actionList.items);
    const next = chooseQueueStep(actionList.items, request.mode);
    if (!next?.item_key || next.item_key === selected.item_key) break;
    selected = next;
  }

  throw new ApiError("QUEUE_ACTION_NOT_FOUND", "Could not find a queue action for stored item key", {
    item_key: request.itemKey,
    label: request.label,
    zone_id: request.zoneId,
    mode: request.mode,
    available_actions: lastActions
  });
}

export async function inspectQueueActions(
  roonClient: RoonClient,
  request: Omit<QueueByQueryRequest, "mode">
): Promise<QueueActionInspection> {
  const query = normalizeQuery(request.query);
  if (!query) {
    throw new ApiError("INVALID_SEARCH_QUERY", "Search query is required");
  }

  getZoneOrThrow(roonClient, request.zoneId);

  const browse = requireBrowse(roonClient);
  const sessionKey =
    request.sessionKey || `roon-ai-bridge-inspect-${Date.now().toString(36)}`;

  const searchResult = await searchRoon(roonClient, {
    query,
    zoneOrOutputId: request.zoneId,
    offset: 0,
    count: 25,
    sessionKey
  });

  const selected = chooseSearchResult(searchResult.items);
  if (!selected?.item_key) {
    throw new ApiError("SEARCH_NO_RESULTS", "No queueable search results found", {
      query,
      candidates: searchResult.items.slice(0, 10)
    });
  }

  await browseCall(browse, {
    hierarchy: "search",
    multi_session_key: sessionKey,
    item_key: selected.item_key,
    zone_or_output_id: request.zoneId
  });

  const actionList = await loadCurrentList(
    browse,
    "search",
    sessionKey,
    0,
    50
  );

  return {
    zone_id: request.zoneId,
    query,
    selected,
    actions: actionItems(actionList.items)
  };
}
