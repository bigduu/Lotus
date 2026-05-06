/**
 * Unit tests for the `renderSubagentTypeTag` helper used by
 * `SubAgentsPanel` to render a child's subagent role tag.
 *
 * The helper resolves a child's `subagent_type` (a stable id like "plan")
 * against the SubagentProfile catalogue and falls back gracefully when
 * the id is missing, blank, or unknown.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { renderSubagentTypeTag } from "../renderSubagentTypeTag";
import type { SubagentProfile } from "../../../../../services/subagent/types";

const planProfile: SubagentProfile = {
  id: "plan",
  display_name: "Plan",
  description: "Read-only planning role",
  tools: { mode: "inherit" },
  ui: { icon: "🗺️", color: "blue" },
};

const noUiProfile: SubagentProfile = {
  id: "minimal",
  display_name: "Minimal",
  description: "no ui hints",
  tools: { mode: "inherit" },
};

const buildCatalogue = (...profiles: SubagentProfile[]) => new Map(profiles.map((p) => [p.id, p]));

describe("renderSubagentTypeTag", () => {
  it("renders nothing when subagentType is null/undefined/empty", () => {
    const byId = buildCatalogue(planProfile);
    expect(renderSubagentTypeTag(null, byId)).toBeNull();
    expect(renderSubagentTypeTag(undefined, byId)).toBeNull();
    expect(renderSubagentTypeTag("", byId)).toBeNull();
    expect(renderSubagentTypeTag("   ", byId)).toBeNull();
  });

  it("renders a styled tag with display_name + icon when the catalogue has a match", () => {
    const byId = buildCatalogue(planProfile);
    const node = renderSubagentTypeTag("plan", byId);
    const { container } = render(<>{node}</>);
    const tag = container.querySelector('[data-testid="sub-agent-role-tag-plan"]');
    expect(tag).not.toBeNull();
    expect(tag?.textContent).toContain("Plan");
    expect(tag?.textContent).toContain("🗺️");
  });

  it("falls back to the raw id when the catalogue is missing the entry", () => {
    const byId = buildCatalogue(planProfile);
    const node = renderSubagentTypeTag("researcher", byId);
    const { container } = render(<>{node}</>);
    const tag = container.querySelector('[data-testid="sub-agent-role-tag-researcher"]');
    expect(tag).not.toBeNull();
    expect(tag?.textContent).toBe("researcher");
  });

  it("renders without icon when the profile has no ui hints", () => {
    const byId = buildCatalogue(noUiProfile);
    const node = renderSubagentTypeTag("minimal", byId);
    const { container } = render(<>{node}</>);
    const tag = container.querySelector('[data-testid="sub-agent-role-tag-minimal"]');
    expect(tag).not.toBeNull();
    // No icon prefix; just the display_name.
    expect(tag?.textContent).toBe("Minimal");
  });

  it("trims whitespace around the subagent_type id before lookup", () => {
    const byId = buildCatalogue(planProfile);
    const node = renderSubagentTypeTag("  plan  ", byId);
    const { container } = render(<>{node}</>);
    const tag = container.querySelector('[data-testid="sub-agent-role-tag-plan"]');
    expect(tag).not.toBeNull();
    expect(tag?.textContent).toContain("Plan");
  });
});
