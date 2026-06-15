import i18n from "@shared/i18n";

/**
 * Map a backend notification `category` to a localized title.
 *
 * The backend already provides a `title` (and `body`); we override only the
 * title with a localized string when the category is one we have copy for, and
 * otherwise fall back to the backend-supplied title. Categories are defined by
 * `bamboo-notification`: `needs_approval` | `needs_clarification` |
 * `context_critical` | `subagent_completed`.
 *
 * The detail (tool name, question, pressure message, task title) lives in the
 * backend-supplied `body`, so the titles here are intentionally generic.
 */
export function notificationTitleForCategory(category?: string): string | null {
  switch (category) {
    case "needs_clarification":
      return i18n.t("app.notifications.clarification.title");
    case "needs_approval":
      return i18n.t("app.notifications.toolApproval.genericTitle", "Approval required");
    case "context_critical":
      return i18n.t("app.notifications.contextPressure.title");
    case "subagent_completed":
      return i18n.t("app.notifications.backgroundTask.completedTitle");
    default:
      return null;
  }
}
