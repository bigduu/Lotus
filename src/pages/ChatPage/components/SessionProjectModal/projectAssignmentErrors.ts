import i18n from "@shared/i18n";
import { isApiError } from "@services/api";
import { getWorkspaceSwitchErrorCode } from "../InputContainer/workspaceSwitchErrors";

/** Map Bamboo's session Project mutation failures to actionable UI copy. */
export const getProjectAssignmentErrorMessage = (error: unknown): string => {
  if (isApiError(error) && error.status === 412) {
    return i18n.t("chat.project.assignmentRevisionConflict");
  }

  switch (getWorkspaceSwitchErrorCode(error)) {
    case "session_project_running_conflict":
      return i18n.t("chat.project.assignmentRunningConflict");
    case "project_archived":
      return i18n.t("chat.project.assignmentArchived");
    case "project_unavailable":
      return i18n.t("chat.project.assignmentUnavailable");
    case "project_path_missing":
    case "project_path_unavailable":
      return i18n.t("chat.project.assignmentPathUnavailable");
    case "project_workspace_conflict":
    case "project_workspace_unbound":
      return i18n.t("chat.project.assignmentWorkspaceConflict");
    default:
      return error instanceof Error && error.message.trim()
        ? error.message
        : i18n.t("chat.project.assignmentFailed");
  }
};
