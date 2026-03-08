const TODO_ENHANCEMENT_KEY = "todo_enhancement_enabled";

export const isTodoEnhancementEnabled = (): boolean => {
  return localStorage.getItem(TODO_ENHANCEMENT_KEY) !== "false";
};

export const setTodoEnhancementEnabled = (enabled: boolean): void => {
  localStorage.setItem(TODO_ENHANCEMENT_KEY, enabled.toString());
};

export const getTodoEnhancementPrompt = (): string => {
  return `\n\n## Task Management Rules\n\nUse the TodoWrite tool for non-trivial or multi-step tasks.\nKeep exactly one item in \`in_progress\` state whenever possible.\nUpdate TodoWrite immediately when a step starts or completes; do not batch status updates.\nDo not use Markdown checkbox lists as a substitute for TodoWrite.\nSkip TodoWrite only for simple one-step requests.\n`;
};
