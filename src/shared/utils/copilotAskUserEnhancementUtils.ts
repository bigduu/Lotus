const COPILOT_ASK_USER_ENHANCEMENT_KEY =
  "copilot_ask_user_enhancement_enabled";

export const isCopilotAskUserEnhancementEnabled = (): boolean => {
  return localStorage.getItem(COPILOT_ASK_USER_ENHANCEMENT_KEY) === "true";
};

export const setCopilotAskUserEnhancementEnabled = (enabled: boolean): void => {
  localStorage.setItem(COPILOT_ASK_USER_ENHANCEMENT_KEY, enabled.toString());
};

export const getCopilotAskUserEnhancementPrompt = (): string => {
  return `
## Copilot Completion Confirmation Rule

Before ending the task, always call the \`ask_user\` tool to confirm whether the user still has additional requests.

Requirements:
- This rule applies at the end of every task turn.
- Ask a clear confirmation question and include \`OK\` as one of the selectable options.
- Only treat the task as finished when the user explicitly selects or replies \`OK\`.
- If the user gives any other response, continue assisting and do not end the task.
`;
};
