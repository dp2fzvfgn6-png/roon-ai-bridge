export type ToolClassification = {
  read_only: boolean;
  safe_mutation: boolean;
  destructive: boolean;
  audible: boolean;
  queue_mutation: boolean;
  volume_mutation: boolean;
  requires_confirmation_by_default: boolean;
};

export type MutationResponseOptions = {
  before?: unknown;
  after?: unknown;
  planned_changes?: unknown;
  warnings?: string[];
  extra?: Record<string, unknown>;
};

const readOnly: ToolClassification = {
  read_only: true,
  safe_mutation: false,
  destructive: false,
  audible: false,
  queue_mutation: false,
  volume_mutation: false,
  requires_confirmation_by_default: false
};

const safeMutation: ToolClassification = {
  read_only: false,
  safe_mutation: true,
  destructive: false,
  audible: false,
  queue_mutation: false,
  volume_mutation: false,
  requires_confirmation_by_default: false
};

export const TOOL_CLASSIFICATION: Record<string, ToolClassification> = {
  roon_status: readOnly,
  roon_list_zones: readOnly,
  roon_get_queue: readOnly,
  roon_search: readOnly,
  roon_search_media: readOnly,
  roon_get_media_details: readOnly,
  roon_list_artist_releases: readOnly,
  roon_get_image: readOnly,
  roon_list_outputs: readOnly,
  roon_list_virtual_playlists: readOnly,
  roon_get_virtual_playlist: readOnly,

  roon_control_playback: { ...safeMutation, audible: true },
  roon_change_volume: { ...safeMutation, volume_mutation: true },
  roon_transfer_playback: { ...safeMutation, audible: true, queue_mutation: true },
  roon_group_zones: { ...safeMutation, audible: true },
  roon_ungroup_zone: { ...safeMutation, audible: true },
  roon_play_by_query: { ...safeMutation, audible: true, queue_mutation: true },
  roon_queue_by_query: { ...safeMutation, queue_mutation: true },
  roon_play_queue_item_from_here: { ...safeMutation, audible: true, queue_mutation: true },
  roon_play_media: { ...safeMutation, audible: true, queue_mutation: true },
  roon_start_radio: { ...safeMutation, audible: true, queue_mutation: true },
  roon_add_media_to_queue: { ...safeMutation, queue_mutation: true },
  roon_play_virtual_playlist: { ...safeMutation, audible: true, queue_mutation: true },
  roon_create_virtual_playlist: safeMutation,
  roon_update_virtual_playlist: safeMutation,
  roon_add_virtual_playlist_track: safeMutation,
  roon_update_virtual_playlist_track: safeMutation,
  roon_reorder_virtual_playlist_tracks: safeMutation,
  roon_resolve_virtual_playlist: safeMutation,
  roon_seek: { ...safeMutation, audible: true },
  roon_mute_output: { ...safeMutation, audible: true, volume_mutation: true },
  roon_change_output_volume: { ...safeMutation, volume_mutation: true },
  roon_mute_all: { ...safeMutation, audible: true, volume_mutation: true },
  roon_pause_all: { ...safeMutation, audible: true },
  roon_output_power: safeMutation,
  roon_change_playback_settings: safeMutation,
  roon_restart_queue: { ...safeMutation, audible: true, queue_mutation: true },
  roon_run_browse_action: safeMutation,

  roon_delete_virtual_playlist: {
    read_only: false,
    safe_mutation: false,
    destructive: true,
    audible: false,
    queue_mutation: false,
    volume_mutation: false,
    requires_confirmation_by_default: true
  },
  roon_remove_virtual_playlist_track: {
    read_only: false,
    safe_mutation: false,
    destructive: true,
    audible: false,
    queue_mutation: false,
    volume_mutation: false,
    requires_confirmation_by_default: true
  },
  roon_replace_virtual_playlist_tracks: {
    read_only: false,
    safe_mutation: false,
    destructive: true,
    audible: false,
    queue_mutation: false,
    volume_mutation: false,
    requires_confirmation_by_default: true
  }
};

export function getToolClassification(action: string): ToolClassification {
  return TOOL_CLASSIFICATION[action] || safeMutation;
}

export function mutationSuccess(
  action: string,
  result: unknown,
  options: MutationResponseOptions = {}
): Record<string, unknown> {
  return {
    ok: true,
    action,
    dry_run: false,
    classification: getToolClassification(action),
    before: options.before ?? null,
    after: options.after ?? result,
    warnings: options.warnings || [],
    ...(result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : { result }),
    ...(options.extra || {})
  };
}

export function dryRunResponse(
  action: string,
  plannedChanges: unknown,
  options: MutationResponseOptions = {}
): Record<string, unknown> {
  return {
    ok: true,
    dry_run: true,
    would_execute: true,
    action,
    classification: getToolClassification(action),
    planned_changes: plannedChanges,
    before: options.before ?? null,
    after: options.after ?? null,
    warnings: options.warnings || [],
    ...(options.extra || {})
  };
}

export function confirmationRequiredResponse(
  action: string,
  reason: string,
  message: string,
  plannedAction: Record<string, unknown>,
  originalArguments: Record<string, unknown>,
  humanSummary = message
): Record<string, unknown> {
  return {
    ok: false,
    requires_confirmation: true,
    confirmation_reason: reason,
    action,
    message,
    human_summary: humanSummary,
    classification: getToolClassification(action),
    planned_action: plannedAction,
    confirm_payload: {
      tool: action,
      arguments: {
        ...originalArguments,
        dry_run: false,
        confirm: true
      }
    }
  };
}

export function safetyPolicyPayload(volumeLimits: unknown): Record<string, unknown> {
  return {
    version: 1,
    volume_limits: volumeLimits,
    tool_classification: TOOL_CLASSIFICATION,
    confirmation_policy: {
      destructive_requires_confirmation: true,
      volume_above_safe_limit_requires_confirmation: true,
      playback_requires_confirmation: false
    }
  };
}
