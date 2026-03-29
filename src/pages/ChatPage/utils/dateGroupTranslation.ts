import { TFunction } from "i18next";

/**
 * Translates date group keys from internal keys to localized strings
 *
 * @param dateKey - The internal date key (e.g., "Today", "Yesterday", "This Week")
 * @param t - i18next translation function
 * @returns Localized string for display
 */
export const translateDateKey = (dateKey: string, t: TFunction): string => {
  const keyMap: Record<string, string> = {
    Today: "chat.sidebar.dateGroups.today",
    Yesterday: "chat.sidebar.dateGroups.yesterday",
    "This Week": "chat.sidebar.dateGroups.thisWeek",
    "This Month": "chat.sidebar.dateGroups.thisMonth",
    Pinned: "chat.sidebar.dateGroups.pinned",
    Scheduled: "chat.sidebar.dateGroups.scheduled",
  };

  const translationKey = keyMap[dateKey];

  // If it's a known key, translate it; otherwise return as-is (e.g., date strings)
  return translationKey ? t(translationKey) : dateKey;
};
