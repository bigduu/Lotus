/**
 * Unit tests for the cosmetic `subagent_type` label used by SubAgentsPanel.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderSubagentTypeTag } from "../renderSubagentTypeTag";

describe("renderSubagentTypeTag", () => {
  it("renders nothing when subagentType is null, undefined, or blank", () => {
    expect(renderSubagentTypeTag(null)).toBeNull();
    expect(renderSubagentTypeTag(undefined)).toBeNull();
    expect(renderSubagentTypeTag("")).toBeNull();
    expect(renderSubagentTypeTag("   ")).toBeNull();
  });

  it("renders the raw subagent_type as a neutral tag", () => {
    const node = renderSubagentTypeTag("researcher");
    const { container } = render(<>{node}</>);
    const tag = container.querySelector('[data-testid="sub-agent-role-tag-researcher"]');

    expect(tag).not.toBeNull();
    expect(tag).toHaveClass("ant-tag");
    expect(tag?.textContent).toBe("researcher");
  });

  it("renders compact inline text without Ant Tag chrome", () => {
    const node = renderSubagentTypeTag("plan", { compact: true });
    const { container } = render(<>{node}</>);
    const tag = container.querySelector('[data-testid="sub-agent-role-tag-plan"]');

    expect(tag).not.toBeNull();
    expect(tag).not.toHaveClass("ant-tag");
    expect(tag?.textContent).toBe("plan");
  });

  it("trims whitespace around the cosmetic label", () => {
    const node = renderSubagentTypeTag("  minimal  ");
    const { container } = render(<>{node}</>);
    const tag = container.querySelector('[data-testid="sub-agent-role-tag-minimal"]');

    expect(tag).not.toBeNull();
    expect(tag?.textContent).toBe("minimal");
  });
});
