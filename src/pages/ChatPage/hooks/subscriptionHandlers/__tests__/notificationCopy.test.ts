import { describe, expect, it, vi } from "vitest";

import { notificationTitleForCategory } from "../notificationCopy";

const { mockTranslate } = vi.hoisted(() => ({
  mockTranslate: vi.fn((key: string) => `translated:${key}`),
}));

vi.mock("@shared/i18n", () => ({
  default: { t: mockTranslate },
}));

describe("notificationTitleForCategory", () => {
  it.each([
    ["needs_clarification", "app.notifications.clarification.title"],
    ["needs_approval", "app.notifications.toolApproval.genericTitle"],
    ["context_critical", "app.notifications.contextPressure.title"],
    ["subagent_completed", "app.notifications.backgroundTask.completedTitle"],
  ])("maps %s to localized notification copy", (category, key) => {
    expect(notificationTitleForCategory(category)).toBe(`translated:${key}`);
    expect(mockTranslate).toHaveBeenCalledWith(key);
  });

  it.each([undefined, "", "unrecognized"])("lets the backend title handle %s", (category) => {
    expect(notificationTitleForCategory(category)).toBeNull();
  });
});
