const TASK_ENHANCEMENT_KEY = "task_enhancement_enabled";
const LEGACY_ENHANCEMENT_KEY = "todo_enhancement_enabled";

const isDisabledValue = (value: string | null): boolean => value === "false";

export const isTaskEnhancementEnabled = (): boolean => {
  let taskValue = localStorage.getItem(TASK_ENHANCEMENT_KEY);
  if (taskValue === null) {
    const legacyValue = localStorage.getItem(LEGACY_ENHANCEMENT_KEY);
    if (legacyValue !== null) {
      taskValue = legacyValue;
      localStorage.setItem(TASK_ENHANCEMENT_KEY, legacyValue);
      localStorage.removeItem(LEGACY_ENHANCEMENT_KEY);
    }
  }
  return !isDisabledValue(taskValue);
};

export const setTaskEnhancementEnabled = (enabled: boolean): void => {
  localStorage.setItem(TASK_ENHANCEMENT_KEY, enabled.toString());
};

export const getTaskEnhancementPrompt = (): string => {
  return `\n\n## Task Management Rules\n\nUse the Task tool for non-trivial or multi-step tasks.\nTask updates are shared across the current root session and all child sessions.\nKeep exactly one item in \`in_progress\` state whenever possible.\nUpdate Task immediately when a step starts or completes; do not batch status updates.\nWhen marking a task as completed, always fill in the \`summary\` field with a concise description of what was accomplished.\nDo not use Markdown checkbox lists as a substitute for Task.\nSkip Task only for simple one-step requests.\nUse SubAgent only when the user explicitly requests delegated/parallel sub-agent work.\n`;
};
