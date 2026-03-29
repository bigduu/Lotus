import { beforeEach, describe, expect, it } from "vitest";
import {
  buildEnhancedSystemPrompt,
  getEffectiveSystemPrompt,
  getSystemPromptEnhancement,
  getSystemPromptEnhancementPipeline,
  getSystemPromptEnhancementText,
  setSystemPromptEnhancement,
} from "../systemPromptEnhancement";
import { getMermaidEnhancementPrompt, setMermaidEnhancementEnabled } from "../mermaidUtils";
import { getTaskEnhancementPrompt, setTaskEnhancementEnabled } from "../taskEnhancementUtils";
import {
  getCopilotConclusionWithOptionsEnhancementPrompt,
  setCopilotConclusionWithOptionsEnhancementEnabled,
} from "../copilotConclusionWithOptionsEnhancementUtils";
import { getOSInfoEnhancementPrompt } from "../osInfoUtils";

const OPERATIONAL_GUIDANCE_HEADING = "## Bamboo Operational Guidance";
const OPERATIONAL_GUIDANCE_PROMPT = [
  "## Bamboo Operational Guidance",
  "",
  "- For recurring or delayed tasks, use the `schedule_tasks` tool to create and manage schedule jobs instead of only describing manual steps.",
  "- The `schedule_tasks` tool supports: `list`, `create`, `patch`, `delete`, `run_now`, and `list_sessions`.",
  "- Bamboo configuration is stored in `${BAMBOO_DATA_DIR}/config.json`.",
  "- Default config path: `~/.bamboo/config.json` (macOS/Linux) or `%USERPROFILE%\\\\.bamboo\\\\config.json` (Windows).",
].join("\n");

describe("systemPromptEnhancement", () => {
  beforeEach(() => {
    localStorage.clear();
    setMermaidEnhancementEnabled(false);
    setTaskEnhancementEnabled(false);
    setCopilotConclusionWithOptionsEnhancementEnabled(false);
  });

  it("returns base prompt when enhancement is empty", () => {
    const result = buildEnhancedSystemPrompt("Base prompt", "");
    expect(result).toBe("Base prompt");
  });

  it("returns enhancement when base prompt is empty", () => {
    const result = buildEnhancedSystemPrompt("", "Extra prompt");
    expect(result).toBe("Extra prompt");
  });

  it("joins base and enhancement with a blank line", () => {
    const result = buildEnhancedSystemPrompt("Base prompt", "Extra prompt");
    expect(result).toBe("Base prompt\n\nExtra prompt");
  });

  it("persists enhancement content", () => {
    setSystemPromptEnhancement("Enhanced guidance");
    expect(getSystemPromptEnhancement()).toBe("Enhanced guidance");
  });

  it("clears enhancement when value is whitespace", () => {
    setSystemPromptEnhancement("Enhanced guidance");
    setSystemPromptEnhancement("   ");
    expect(getSystemPromptEnhancement()).toBe("");
  });

  it("omits mermaid fallback from user enhancement", () => {
    setMermaidEnhancementEnabled(true);
    expect(getSystemPromptEnhancement()).toBe("");
  });

  it("builds enhancement text with user and system prompts in order", () => {
    setSystemPromptEnhancement("User enhancement");
    setMermaidEnhancementEnabled(true);
    setTaskEnhancementEnabled(true);

    expect(getSystemPromptEnhancementText()).toBe(
      [
        getOSInfoEnhancementPrompt().trim(),
        OPERATIONAL_GUIDANCE_PROMPT,
        "User enhancement",
        getMermaidEnhancementPrompt().trim(),
        getTaskEnhancementPrompt().trim(),
      ].join("\n\n"),
    );
  });

  it("mermaid enhancement prompt requires fenced code blocks", () => {
    expect(getMermaidEnhancementPrompt()).toContain("```mermaid");
    expect(getMermaidEnhancementPrompt()).toContain("fenced code block");
  });

  it("returns only enabled system enhancements when user text is empty", () => {
    setTaskEnhancementEnabled(true);

    expect(getSystemPromptEnhancementText()).toBe(
      [
        getOSInfoEnhancementPrompt().trim(),
        OPERATIONAL_GUIDANCE_PROMPT,
        getTaskEnhancementPrompt().trim(),
      ].join("\n\n"),
    );
  });

  it("appends workspace context after enhancements", () => {
    setSystemPromptEnhancement("User enhancement");

    const result = getEffectiveSystemPrompt("Base prompt", "/Users/alice/app");
    const workspaceSegment = [
      "Workspace path: /Users/alice/app",
      "If you need to inspect files, check the workspace first, then check Bamboo data at `${BAMBOO_DATA_DIR}` (default `~/.bamboo`) and the config file at `${BAMBOO_DATA_DIR}/config.json`.",
    ].join("\n");

    expect(result).toBe(
      [
        "Base prompt",
        getOSInfoEnhancementPrompt().trim(),
        OPERATIONAL_GUIDANCE_PROMPT,
        "User enhancement",
        workspaceSegment,
      ].join("\n\n"),
    );
  });

  it("omits workspace context when no workspace is set", () => {
    setSystemPromptEnhancement("User enhancement");

    const result = getEffectiveSystemPrompt("Base prompt", "");

    expect(result).toBe(
      [
        "Base prompt",
        getOSInfoEnhancementPrompt().trim(),
        OPERATIONAL_GUIDANCE_PROMPT,
        "User enhancement",
      ].join("\n\n"),
    );
  });

  it("OS info enhancement is always first in the pipeline", () => {
    setSystemPromptEnhancement("User enhancement");
    setMermaidEnhancementEnabled(true);
    setTaskEnhancementEnabled(true);

    const pipeline = getSystemPromptEnhancementPipeline();

    expect(pipeline.length).toBeGreaterThan(0);
    expect(pipeline[0]).toContain("Operating System Information");
    expect(pipeline[0]).toBe(getOSInfoEnhancementPrompt().trim());
  });

  it("OS info enhancement is included even when all other enhancements are disabled", () => {
    setSystemPromptEnhancement("");
    setMermaidEnhancementEnabled(false);
    setTaskEnhancementEnabled(false);

    const pipeline = getSystemPromptEnhancementPipeline();

    expect(pipeline.length).toBe(2);
    expect(pipeline[0]).toContain("Operating System Information");
    expect(pipeline[1]).toContain(OPERATIONAL_GUIDANCE_HEADING);
  });

  it("builds enhancement text with OS info first, then user and system prompts", () => {
    setSystemPromptEnhancement("User enhancement");
    setMermaidEnhancementEnabled(true);
    setTaskEnhancementEnabled(true);

    const enhancementText = getSystemPromptEnhancementText();
    const expectedOrder = [
      getOSInfoEnhancementPrompt().trim(),
      OPERATIONAL_GUIDANCE_PROMPT,
      "User enhancement",
      getMermaidEnhancementPrompt().trim(),
      getTaskEnhancementPrompt().trim(),
    ].join("\n\n");

    expect(enhancementText).toBe(expectedOrder);

    // Verify OS info comes before user enhancement
    const osIndex = enhancementText.indexOf("Operating System Information");
    const userIndex = enhancementText.indexOf("User enhancement");
    expect(osIndex).toBeLessThan(userIndex);
  });

  it("adds conclusion_with_options rule only for copilot provider when enabled", () => {
    setCopilotConclusionWithOptionsEnhancementEnabled(true);

    expect(getSystemPromptEnhancementText("copilot")).toContain(
      getCopilotConclusionWithOptionsEnhancementPrompt().trim(),
    );
    expect(getSystemPromptEnhancementText("openai")).not.toContain(
      getCopilotConclusionWithOptionsEnhancementPrompt().trim(),
    );
    expect(getSystemPromptEnhancementText()).not.toContain(
      getCopilotConclusionWithOptionsEnhancementPrompt().trim(),
    );
  });
});
