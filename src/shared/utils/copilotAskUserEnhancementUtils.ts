const COPILOT_ASK_USER_ENHANCEMENT_KEY = "copilot_ask_user_enhancement_enabled";

export const isCopilotAskUserEnhancementEnabled = (): boolean => {
  return localStorage.getItem(COPILOT_ASK_USER_ENHANCEMENT_KEY) === "true";
};

export const setCopilotAskUserEnhancementEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(COPILOT_ASK_USER_ENHANCEMENT_KEY, enabled.toString());
  } catch (error) {
    console.error("[copilotAskUserEnhancement] Failed to persist setting:", error);
  }
};

export const getCopilotAskUserEnhancementPrompt = (): string => {
  return `
## Copilot Completion Confirmation Rule

Before ending the task, always call the \`ask_user\` tool to confirm whether the user still has additional requests.

Requirements:
- This rule applies at the end of every task turn.
- Do not ask final confirmation in plain assistant text; use \`ask_user\` for the final confirmation step.
- Before the final \`ask_user\` call, first call either \`conclusion\` or \`mermaid\` to present progress/conclusions.
- For final wrap-up, include \`conclusion\`/ \`mermaid\` and \`ask_user\` in the same assistant response.
- If using \`mermaid\`, include a short textual takeaway in the tool payload summary/title.
- After the tool call, add a brief assistant text recap so the user understands the conclusion in plain language.
- Ask a clear confirmation question and include \`OK\` as one of the selectable options.
- Only treat the task as finished when the user explicitly selects or replies \`OK\`.
- If the user gives any other response, continue assisting and do not end the task.
- A response that ends the task without \`ask_user\` is invalid and must be corrected before finishing.
`;
};
