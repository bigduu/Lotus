import i18n from "@shared/i18n";
import { isApiError } from "@services/api";

type StructuredApiErrorBody = {
  error?: {
    code?: string;
  };
};

export const getWorkspaceSwitchErrorCode = (error: unknown): string | null => {
  if (!isApiError(error) || !error.body) return null;
  try {
    const parsed = JSON.parse(error.body) as StructuredApiErrorBody;
    return parsed.error?.code?.trim() || null;
  } catch {
    return null;
  }
};

/** Map Bamboo's structured workspace-switch failures to distinct, actionable UI copy. */
export const getWorkspaceSwitchErrorMessage = (error: unknown): string => {
  if (isApiError(error) && error.status === 412) {
    return i18n.t("chat.workspace.switchRevisionConflict");
  }

  const code = getWorkspaceSwitchErrorCode(error);
  switch (code) {
    case "project_workspace_unbound":
      return i18n.t("chat.workspace.switchUnbound");
    case "project_workspace_conflict":
      return i18n.t("chat.workspace.switchOwnedByAnotherProject");
    case "project_archived":
      return i18n.t("chat.workspace.switchProjectArchived");
    case "project_unavailable":
      return i18n.t("chat.workspace.switchProjectUnavailable");
    case "session_project_running_conflict":
      return i18n.t("chat.workspace.switchSessionRunning");
    case "workspace_invalid":
      return i18n.t("chat.workspace.switchInvalidPath");
    default:
      return error instanceof Error && error.message.trim()
        ? error.message
        : i18n.t("chat.workspace.errorSaveFailed");
  }
};
