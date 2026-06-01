/**
 * Tests for ToolCallCard metadata badge rendering.
 *
 * Verifies that lifecycle metadata (elapsed_ms, is_mutating) from the backend
 * is rendered correctly as badges in the ToolCallCard component.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock antd components to inspect rendered output without full theme provider.
vi.mock("antd", () => ({
  Collapse: vi.fn(({ items, ...rest }: any) => (
    <div data-testid="collapse" {...rest}>
      {items?.map((item: any) => (
        <div key={item.key} data-testid={`collapse-item-${item.key}`}>
          <div data-testid="collapse-label">{item.label}</div>
          <div data-testid="collapse-children">{item.children}</div>
        </div>
      ))}
    </div>
  )),
  Space: vi.fn(({ children }: any) => <div data-testid="space">{children}</div>),
  Button: vi.fn(({ children, ...props }: any) => (
    <button data-testid="button" {...props}>
      {children}
    </button>
  )),
  Typography: {
    Text: vi.fn(({ children, ...props }: any) => (
      <span data-testid="text" {...props}>
        {children}
      </span>
    )),
  },
  theme: {
    useToken: () => ({
      token: {
        colorPrimary: "#1677ff",
        colorText: "#000",
        borderRadiusLG: 8,
        borderRadiusSM: 4,
        marginSM: 8,
        marginXS: 4,
        paddingLG: 16,
        fontSizeSM: 12,
        colorBgContainer: "#fff",
      },
    }),
  },
  Tooltip: vi.fn(({ title, children }: any) => (
    <div data-testid="tooltip" data-tooltip-title={String(title)}>
      {children}
    </div>
  )),
  Tag: vi.fn(({ children, color, ...props }: any) => (
    <span data-testid="tag" data-color={color} {...props}>
      {children}
    </span>
  )),
}));

// Mock syntax highlighter
vi.mock("react-syntax-highlighter", () => ({
  Prism: vi.fn(({ children }: any) => <pre data-testid="syntax-highlighter">{children}</pre>),
}));
vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  oneDark: {},
}));

// Mock clipboard
vi.mock("@shared/utils/clipboard", () => ({
  copyText: vi.fn(),
}));

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock mcpAlias utility
vi.mock("../../../utils/mcpAlias", () => ({
  parseMcpToolAlias: () => null,
}));

// Mock resultFormatters
vi.mock("@shared/utils/resultFormatters", () => ({
  safeStringify: (obj: unknown, indent?: number) => JSON.stringify(obj, null, indent),
}));

// Mock toolIntent — the function was extracted but we still mock via the new path
vi.mock("../../../utils/toolIntent", () => ({
  generateIntentDescription: (_toolName: string, _params: Record<string, unknown>) =>
    `Calling ${_toolName}`,
}));

import { ToolCallCard } from "../index";

// ── Tests ──────────────────────────────────────────────────────────────

describe("ToolCallCard — metadata badges", () => {
  const baseProps = {
    toolName: "Read",
    parameters: { file_path: "test.rs" },
    toolCallId: "call-1",
  };

  it("renders elapsed_ms badge in milliseconds when < 1000ms", () => {
    render(<ToolCallCard {...baseProps} metadata={{ elapsed_ms: 150, is_mutating: false }} />);

    // Find the tag with elapsed time text
    const tags = screen.getAllByTestId("tag");
    const elapsedTag = tags.find((t) => t.textContent === "150ms");

    expect(elapsedTag).toBeDefined();
    expect(elapsedTag!.getAttribute("data-color")).toBe("green");
  });

  it("renders elapsed_ms badge in seconds when >= 1000ms", () => {
    render(<ToolCallCard {...baseProps} metadata={{ elapsed_ms: 5200, is_mutating: true }} />);

    const tags = screen.getAllByTestId("tag");
    const elapsedTag = tags.find((t) => t.textContent === "5.2s");

    expect(elapsedTag).toBeDefined();
    expect(elapsedTag!.getAttribute("data-color")).toBe("orange");
  });

  it("renders green tag for read-only tool", () => {
    render(
      <ToolCallCard
        {...baseProps}
        toolName="Read"
        metadata={{ elapsed_ms: 42, is_mutating: false }}
      />,
    );

    const tags = screen.getAllByTestId("tag");
    const elapsedTag = tags.find((t) => t.textContent === "42ms");

    expect(elapsedTag).toBeDefined();
    expect(elapsedTag!.getAttribute("data-color")).toBe("green");
  });

  it("renders orange tag for mutating tool", () => {
    render(
      <ToolCallCard
        {...baseProps}
        toolName="Bash"
        metadata={{ elapsed_ms: 800, is_mutating: true }}
      />,
    );

    const tags = screen.getAllByTestId("tag");
    const elapsedTag = tags.find((t) => t.textContent === "800ms");

    expect(elapsedTag).toBeDefined();
    expect(elapsedTag!.getAttribute("data-color")).toBe("orange");
  });

  it("does not render elapsed badge when metadata is undefined", () => {
    render(<ToolCallCard {...baseProps} />);

    const tags = screen.queryAllByTestId("tag");
    // No tag should contain ms or s timing
    const timingTags = tags.filter(
      (t) => t.textContent?.includes("ms") || /^\d+\.\d+s$/.test(t.textContent || ""),
    );
    expect(timingTags).toHaveLength(0);
  });

  it("does not render elapsed badge when elapsed_ms is null", () => {
    render(<ToolCallCard {...baseProps} metadata={{ is_mutating: false }} />);

    const tags = screen.queryAllByTestId("tag");
    const timingTags = tags.filter(
      (t) => t.textContent?.includes("ms") || /^\d+\.\d+s$/.test(t.textContent || ""),
    );
    expect(timingTags).toHaveLength(0);
  });

  it("wraps elapsed badge in tooltip with mutating description", () => {
    render(<ToolCallCard {...baseProps} metadata={{ elapsed_ms: 300, is_mutating: true }} />);

    const tooltips = screen.getAllByTestId("tooltip");
    const mutatingTooltip = tooltips.find(
      (t) => t.getAttribute("data-tooltip-title") === "Mutating tool",
    );
    expect(mutatingTooltip).toBeDefined();
  });

  it("wraps elapsed badge in tooltip with read-only description", () => {
    render(<ToolCallCard {...baseProps} metadata={{ elapsed_ms: 50, is_mutating: false }} />);

    const tooltips = screen.getAllByTestId("tooltip");
    const readOnlyTooltip = tooltips.find(
      (t) => t.getAttribute("data-tooltip-title") === "Read-only tool",
    );
    expect(readOnlyTooltip).toBeDefined();
  });

  it("renders exactly 1000ms as 1.0s", () => {
    render(<ToolCallCard {...baseProps} metadata={{ elapsed_ms: 1000, is_mutating: false }} />);

    const tags = screen.getAllByTestId("tag");
    const elapsedTag = tags.find((t) => t.textContent === "1.0s");
    expect(elapsedTag).toBeDefined();
  });
});
