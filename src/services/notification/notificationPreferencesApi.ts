/**
 * Notification preferences API.
 *
 * Preferences now live on the backend (the notification policy in
 * `bamboo-notification` reads them server-side). These helpers read/write them
 * via the agent REST endpoints, replacing the old browser-local storage.
 *
 * The backend serializes preferences in snake_case; we keep the camelCase TS
 * shape the settings UI already uses and map at this boundary.
 */
import { agentApiClient } from "../api";

export interface NotificationPreferences {
  /** Master switch for all desktop notifications */
  enabled: boolean;
  /** Notify when agent needs clarification */
  onClarification: boolean;
  /** Notify when a mutating tool needs approval */
  onToolApproval: boolean;
  /** Notify on critical context pressure */
  onContextPressure: boolean;
  /** Notify when a background sub-agent completes */
  onSubAgentComplete: boolean;
  /** Notify when a background shell/command (Bash run_in_background) finishes */
  onBackgroundTaskComplete: boolean;
  /** Notify when a run finishes successfully */
  onRunComplete: boolean;
  /** Notify when a run fails */
  onRunFailed: boolean;
}

/** Wire shape returned/accepted by the backend (snake_case). */
interface NotificationPreferencesDto {
  enabled: boolean;
  on_clarification: boolean;
  on_tool_approval: boolean;
  on_context_pressure: boolean;
  on_subagent_complete: boolean;
  on_background_task_complete: boolean;
  on_run_complete: boolean;
  on_run_failed: boolean;
}

const PREFERENCES_PATH = "notifications/preferences";

function fromDto(dto: NotificationPreferencesDto): NotificationPreferences {
  return {
    enabled: dto.enabled,
    onClarification: dto.on_clarification,
    onToolApproval: dto.on_tool_approval,
    onContextPressure: dto.on_context_pressure,
    onSubAgentComplete: dto.on_subagent_complete,
    onBackgroundTaskComplete: dto.on_background_task_complete,
    onRunComplete: dto.on_run_complete,
    onRunFailed: dto.on_run_failed,
  };
}

function toDto(prefs: NotificationPreferences): NotificationPreferencesDto {
  return {
    enabled: prefs.enabled,
    on_clarification: prefs.onClarification,
    on_tool_approval: prefs.onToolApproval,
    on_context_pressure: prefs.onContextPressure,
    on_subagent_complete: prefs.onSubAgentComplete,
    on_background_task_complete: prefs.onBackgroundTaskComplete,
    on_run_complete: prefs.onRunComplete,
    on_run_failed: prefs.onRunFailed,
  };
}

/** Fetch the user's notification preferences from the backend. */
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const dto = await agentApiClient.get<NotificationPreferencesDto>(PREFERENCES_PATH);
  return fromDto(dto);
}

/** Persist the user's notification preferences to the backend. */
export async function setNotificationPreferences(
  prefs: NotificationPreferences,
): Promise<NotificationPreferences> {
  const dto = await agentApiClient.put<NotificationPreferencesDto>(PREFERENCES_PATH, toDto(prefs));
  return fromDto(dto);
}
