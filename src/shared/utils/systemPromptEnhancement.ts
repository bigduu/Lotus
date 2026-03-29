import { getMermaidEnhancementPrompt, isMermaidEnhancementEnabled } from "./mermaidUtils";
import { getTaskEnhancementPrompt, isTaskEnhancementEnabled } from "./taskEnhancementUtils";
import { getOSInfoEnhancementPrompt } from "./osInfoUtils";
import {
  getCopilotConclusionWithOptionsEnhancementPrompt,
  isCopilotConclusionWithOptionsEnhancementEnabled,
} from "./copilotConclusionWithOptionsEnhancementUtils";

const SYSTEM_PROMPT_ENHANCEMENT_KEY = "bamboo_system_prompt_enhancement";

const getBambooOperationalGuidancePrompt = (): string => {
  return [
    "## Bamboo Operational Guidance",
    "",
    "- For recurring or delayed tasks, use the `schedule_tasks` tool to create and manage schedule jobs instead of only describing manual steps.",
    "- The `schedule_tasks` tool supports: `list`, `create`, `patch`, `delete`, `run_now`, and `list_sessions`.",
    "- Bamboo configuration is stored in `${BAMBOO_DATA_DIR}/config.json`.",
    "- Default config path: `~/.bamboo/config.json` (macOS/Linux) or `%USERPROFILE%\\\\.bamboo\\\\config.json` (Windows).",
  ].join("\n");
};

const joinPromptSegments = (segments: string[]): string => {
  const normalized = segments
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return normalized.join("\n\n");
};

const appendPromptSegment = (base: string, segment: string): string => {
  const normalizedBase = (base ?? "").trimEnd();
  const normalizedSegment = (segment ?? "").trim();
  if (!normalizedSegment) {
    return normalizedBase;
  }
  if (!normalizedBase) {
    return normalizedSegment;
  }
  return `${normalizedBase}\n\n${normalizedSegment}`;
};

const buildWorkspaceContextSegment = (workspacePath?: string): string => {
  const normalized = (workspacePath ?? "").trim();
  if (!normalized) {
    return "";
  }
  return [
    `Workspace path: ${normalized}`,
    "If you need to inspect files, check the workspace first, then check Bamboo data at `${BAMBOO_DATA_DIR}` (default `~/.bamboo`) and the config file at `${BAMBOO_DATA_DIR}/config.json`.",
  ].join("\n");
};

export const getSystemPromptEnhancement = (): string => {
  try {
    const stored = localStorage.getItem(SYSTEM_PROMPT_ENHANCEMENT_KEY);
    return stored ?? "";
  } catch (error) {
    console.error("Failed to load system prompt enhancement:", error);
    return "";
  }
};

export const setSystemPromptEnhancement = (value: string): void => {
  try {
    const normalized = value.trim() ? value : "";
    localStorage.setItem(SYSTEM_PROMPT_ENHANCEMENT_KEY, normalized);
  } catch (error) {
    console.error("Failed to save system prompt enhancement:", error);
  }
};

export const getSystemPromptEnhancementPipeline = (currentProvider?: string): string[] => {
  const pipeline: string[] = [];

  // OS info enhancement is ALWAYS included first (user cannot disable)
  pipeline.push(getOSInfoEnhancementPrompt().trim());
  pipeline.push(getBambooOperationalGuidancePrompt().trim());

  const userEnhancement = getSystemPromptEnhancement().trim();

  if (userEnhancement) {
    pipeline.push(userEnhancement);
  }

  if (isMermaidEnhancementEnabled()) {
    pipeline.push(getMermaidEnhancementPrompt().trim());
  }

  if (isTaskEnhancementEnabled()) {
    pipeline.push(getTaskEnhancementPrompt().trim());
  }

  const normalizedProvider = (currentProvider ?? "").trim().toLowerCase();
  if (normalizedProvider === "copilot" && isCopilotConclusionWithOptionsEnhancementEnabled()) {
    pipeline.push(getCopilotConclusionWithOptionsEnhancementPrompt().trim());
  }

  return pipeline;
};

export const getSystemPromptEnhancementText = (currentProvider?: string): string => {
  return joinPromptSegments(getSystemPromptEnhancementPipeline(currentProvider));
};

export const buildEnhancedSystemPrompt = (basePrompt: string, enhancement?: string): string => {
  return appendPromptSegment(basePrompt, enhancement ?? "");
};

export const getEffectiveSystemPrompt = (
  basePrompt: string,
  workspacePath?: string,
  currentProvider?: string,
): string => {
  const enhanced = buildEnhancedSystemPrompt(
    basePrompt,
    getSystemPromptEnhancementText(currentProvider),
  );
  return appendPromptSegment(enhanced, buildWorkspaceContextSegment(workspacePath));
};
