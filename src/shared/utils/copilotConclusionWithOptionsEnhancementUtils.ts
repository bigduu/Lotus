const COPILOT_CONCLUSION_WITH_OPTIONS_ENHANCEMENT_KEY = "copilot_conclusion_with_options_enhancement_enabled";

export const isCopilotConclusionWithOptionsEnhancementEnabled = (): boolean => {
  return localStorage.getItem(COPILOT_CONCLUSION_WITH_OPTIONS_ENHANCEMENT_KEY) === "true";
};

export const setCopilotConclusionWithOptionsEnhancementEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(COPILOT_CONCLUSION_WITH_OPTIONS_ENHANCEMENT_KEY, enabled.toString());
  } catch (error) {
    console.error("[copilotConclusionWithOptionsEnhancement] Failed to persist setting:", error);
  }
};

export const getCopilotConclusionWithOptionsEnhancementPrompt = (): string => {
  return `
## Copilot Completion Confirmation Rule

Before ending the task, always call the \`conclusion_with_options\` tool to confirm whether the user still has additional requests.

Requirements:
- This rule applies at the end of every task turn.
- Do not ask final confirmation in plain assistant text; use \`conclusion_with_options\` for the final confirmation step.
- The \`conclusion_with_options\` call must include a \`conclusion\` object in its arguments.
- \`conclusion.summary\` is required and should summarize progress/conclusions.
- \`conclusion.mermaid.graph\` is required and must contain a Mermaid graph.
- Ask a clear confirmation question and include \`OK\` as one of the selectable options.
- Only treat the task as finished when the user explicitly selects or replies \`OK\`.
- If the user gives any other response, continue assisting and do not end the task.
- A response that ends the task without \`conclusion_with_options\` is invalid and must be corrected before finishing.
`;
};


export const getCopilotConclusionWithOptionsEnhancementUserFacingText = (): string => {
  return [
    "When this is enabled for Copilot sessions, the assistant must finish by asking for confirmation with the conclusion_with_options tool instead of ending with plain assistant text.",
    "If the assistant tries to finish without calling conclusion_with_options, Bamboo stops the completion and returns a completion policy violation error.",
    "Use this when you want enforced end-of-turn confirmation for Copilot sessions.",
  ].join(" ");
};
