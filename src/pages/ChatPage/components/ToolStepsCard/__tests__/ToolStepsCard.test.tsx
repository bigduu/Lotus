/**
 * Tests for ToolStepsCard component.
 *
 * Verifies step rendering, status mapping, mini output preview, drawer interaction,
 * and the new `tools` prop path (ToolSessionItem[]) with result-aware status.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ToolSessionItem } from "../../ToolSessionCard";

// Mock antd components
vi.mock("antd", () => ({
  Steps: vi.fn(({ items, current, status, direction, size }: any) => (
    <div
      data-testid="steps"
      data-current={current}
      data-status={status}
      data-direction={direction}
      data-size={size}
    >
      {items?.map((item: any, _idx: number) => (
        <div key={item.key} data-testid={`step-${item.key}`} data-status={item.status}>
          <div data-testid={`step-title-${item.key}`}>{item.title}</div>
          <div data-testid={`step-subtitle-${item.key}`}>{item.subTitle}</div>
          <div data-testid={`step-description-${item.key}`}>{item.description}</div>
        </div>
      ))}
    </div>
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
        colorTextSecondary: "#666",
        borderRadiusLG: 8,
        borderRadiusSM: 4,
        marginSM: 8,
        marginXS: 4,
        paddingSM: 8,
        paddingXS: 4,
        paddingLG: 16,
        fontSizeSM: 12,
        colorBgContainer: "#fff",
        colorFillTertiary: "#f5f5f5",
      },
    }),
  },
  Tag: vi.fn(({ children, color, ...props }: any) => (
    <span data-testid="tag" data-color={color} {...props}>
      {children}
    </span>
  )),
  Button: vi.fn(({ children, onClick, "data-testid": testId, ...props }: any) => (
    <button data-testid={testId || "button"} onClick={onClick} {...props}>
      {children}
    </button>
  )),
  Space: vi.fn(({ children }: any) => <div data-testid="space">{children}</div>),
  Drawer: vi.fn(({ open, onClose, title, children }: any) => (
    <div data-testid="drawer" data-open={open}>
      <div data-testid="drawer-title">{title}</div>
      <button data-testid="drawer-close" onClick={onClose}>
        Close
      </button>
      {open && children}
    </div>
  )),
  Tabs: vi.fn(({ items, defaultActiveKey }: any) => (
    <div data-testid="tabs" data-default-active-key={defaultActiveKey}>
      {items?.map((item: any) => (
        <div key={item.key} data-testid={`tab-${item.key}`}>
          <div data-testid={`tab-label-${item.key}`}>{item.label}</div>
          <div data-testid={`tab-content-${item.key}`}>{item.children}</div>
        </div>
      ))}
    </div>
  )),
  Empty: vi.fn(({ description }: any) => <div data-testid="empty">{description}</div>),
  Tooltip: vi.fn(({ children }: any) => <div data-testid="tooltip">{children}</div>),
}));

// Mock icons
vi.mock("@ant-design/icons", () => ({
  ClockCircleOutlined: () => <span data-testid="icon-clock">Clock</span>,
  LoadingOutlined: () => <span data-testid="icon-loading">Loading</span>,
  CheckCircleOutlined: () => <span data-testid="icon-check">Check</span>,
  CloseCircleOutlined: () => <span data-testid="icon-close">Close</span>,
  EyeOutlined: () => <span data-testid="icon-eye">Eye</span>,
  DownOutlined: () => <span data-testid="icon-down">Down</span>,
  RightOutlined: () => <span data-testid="icon-right">Right</span>,
  CopyOutlined: () => <span data-testid="icon-copy">Copy</span>,
}));

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
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

// Mock mcpAlias utility
vi.mock("../../../utils/mcpAlias", () => ({
  parseMcpToolAlias: (name: string) => {
    if (name.startsWith("mcp__")) {
      const rest = name.slice(5);
      const sep = rest.indexOf("__");
      if (sep > 0) {
        return { serverId: rest.slice(0, sep), toolName: rest.slice(sep + 2) };
      }
    }
    return null;
  },
}));

// Mock toolIntent
vi.mock("../../../utils/toolIntent", () => ({
  generateIntentDescription: (toolName: string, params: Record<string, unknown>) => {
    if (params.command) return `Executing: ${params.command}`;
    return `Calling ${toolName}`;
  },
}));

// Mock resultFormatters
vi.mock("../../../utils/resultFormatters", () => ({
  safeStringify: (obj: unknown, indent?: number) => JSON.stringify(obj, null, indent),
}));

import { ToolStepsCard } from "../index";

// ── Helpers ───────────────────────────────────────────────────────────

const makeCall = (
  overrides: Partial<{
    toolCallId: string;
    toolName: string;
    parameters: Record<string, unknown>;
    streamingOutput?: string;
  }> = {},
) => ({
  toolCallId: overrides.toolCallId ?? `call-${Math.random().toString(36).slice(2, 8)}`,
  toolName: overrides.toolName ?? "bash",
  parameters: overrides.parameters ?? { command: "ls -la" },
  streamingOutput: overrides.streamingOutput,
});

const makeToolSessionItem = (
  overrides: Partial<{
    toolCallId: string;
    toolName: string;
    parameters: Record<string, unknown>;
    streamingOutput?: string;
    hasResult?: boolean;
    isError?: boolean;
    resultContent?: string;
  }> = {},
): ToolSessionItem => ({
  call: {
    id: `assistant-msg:${overrides.toolCallId ?? "call-1"}`,
    role: "assistant",
    type: "tool_call",
    createdAt: "2026-03-24T00:00:00.000Z",
    toolCalls: [
      {
        toolCallId: overrides.toolCallId ?? "call-1",
        toolName: overrides.toolName ?? "bash",
        parameters: overrides.parameters ?? { command: "ls" },
        streamingOutput: overrides.streamingOutput,
      },
    ],
  },
  ...(overrides.hasResult
    ? {
        result: {
          id: `result-${overrides.toolCallId ?? "call-1"}`,
          role: "assistant" as const,
          type: "tool_result" as const,
          createdAt: "2026-03-24T00:00:01.000Z",
          toolName: overrides.toolName ?? "bash",
          toolCallId: overrides.toolCallId ?? "call-1",
          isError: overrides.isError ?? false,
          result: {
            tool_name: overrides.toolName ?? "bash",
            result: overrides.resultContent ?? "ok",
            display_preference: "Default" as const,
          },
        },
      }
    : {}),
});

// ── Tests ──────────────────────────────────────────────────────────────

describe("ToolStepsCard", () => {
  // ── Legacy toolCalls prop ─────────────────────────────────────────

  it("renders correct number of steps for multiple toolCalls", () => {
    const calls = [
      makeCall({ toolCallId: "c1" }),
      makeCall({ toolCallId: "c2" }),
      makeCall({ toolCallId: "c3" }),
    ];
    render(<ToolStepsCard toolCalls={calls} defaultExpanded={true} />);

    const steps = screen.getByTestId("steps");
    const stepEls = steps.querySelectorAll(':scope > [data-testid^="step-"]');
    expect(stepEls).toHaveLength(3);
  });

  it("maps step status to 'wait' when no streamingOutput", () => {
    const calls = [makeCall({ toolCallId: "c1", streamingOutput: undefined })];
    render(<ToolStepsCard toolCalls={calls} defaultExpanded={true} />);

    const step = screen.getByTestId("step-c1");
    expect(step.getAttribute("data-status")).toBe("wait");
  });

  it("maps step status to 'process' when streamingOutput exists", () => {
    const calls = [makeCall({ toolCallId: "c1", streamingOutput: "some output" })];
    render(<ToolStepsCard toolCalls={calls} defaultExpanded={true} />);

    const step = screen.getByTestId("step-c1");
    expect(step.getAttribute("data-status")).toBe("process");
  });

  it("shows mini output preview with last 3 lines when streaming", () => {
    const output = "line1\nline2\nline3\nline4\nline5";
    const calls = [makeCall({ toolCallId: "c1", streamingOutput: output })];
    render(<ToolStepsCard toolCalls={calls} defaultExpanded={true} />);

    const desc = screen.getByTestId("step-description-c1");
    expect(desc.textContent).toContain("line3");
    expect(desc.textContent).toContain("line4");
    expect(desc.textContent).toContain("line5");
    expect(desc.textContent).not.toContain("line1");
    expect(desc.textContent).not.toContain("line2");
  });

  it("does not show mini output preview when status is wait", () => {
    const calls = [makeCall({ toolCallId: "c1", streamingOutput: undefined })];
    render(<ToolStepsCard toolCalls={calls} defaultExpanded={true} />);

    const desc = screen.getByTestId("step-description-c1");
    expect(desc.textContent).not.toContain("components.toolSteps.viewFullOutput");
  });

  it("shows 'Details' button per step", () => {
    const calls = [makeCall({ toolCallId: "c1" }), makeCall({ toolCallId: "c2" })];
    render(<ToolStepsCard toolCalls={calls} defaultExpanded={true} />);

    expect(screen.getByTestId("tool-step-details-c1")).toBeDefined();
    expect(screen.getByTestId("tool-step-details-c2")).toBeDefined();
  });

  it("clicking 'Details' opens the drawer with correct tabs", () => {
    const calls = [makeCall({ toolCallId: "c1", toolName: "bash", parameters: { command: "ls" } })];
    render(<ToolStepsCard toolCalls={calls} defaultExpanded={true} />);

    expect(screen.queryByTestId("drawer")).toBeNull();

    fireEvent.click(screen.getByTestId("tool-step-details-c1"));

    expect(screen.getByTestId("drawer").getAttribute("data-open")).toBe("true");
    expect(screen.getByTestId("tab-preview")).toBeDefined();
    expect(screen.getByTestId("tab-parameters")).toBeDefined();
    expect(screen.getByTestId("tab-result")).toBeDefined();
  });

  it("shows tool name in step title", () => {
    const calls = [makeCall({ toolCallId: "c1", toolName: "file_read" })];
    render(<ToolStepsCard toolCalls={calls} defaultExpanded={true} />);

    const title = screen.getByTestId("step-title-c1");
    expect(title.textContent).toContain("file_read");
  });

  it("renders MCP tag when tool is an MCP alias", () => {
    const calls = [makeCall({ toolCallId: "c1", toolName: "mcp__server1__tool_a" })];
    render(<ToolStepsCard toolCalls={calls} defaultExpanded={true} />);

    const title = screen.getByTestId("step-title-c1");
    expect(title.textContent).toContain("MCP");
    expect(title.textContent).toContain("tool_a");
  });

  it("renders header with title and count", () => {
    const calls = [makeCall({ toolCallId: "c1" }), makeCall({ toolCallId: "c2" })];
    render(<ToolStepsCard toolCalls={calls} defaultExpanded={true} />);

    const header = screen.getByTestId("tool-steps-header");
    expect(header.textContent).toContain("components.toolSteps.title");
    expect(header.textContent).toContain("0/2");
  });

  it("renders header with elapsed time when metadata provided", () => {
    const calls = [makeCall({ toolCallId: "c1" })];
    render(
      <ToolStepsCard
        toolCalls={calls}
        metadata={{ elapsed_ms: 1500, is_mutating: false }}
        defaultExpanded={true}
      />,
    );

    const header = screen.getByTestId("tool-steps-header");
    expect(header.textContent).toContain("1.5s");
  });

  // ── New `tools` prop (ToolSessionItem[]) ──────────────────────────

  describe("tools prop", () => {
    it("maps step status to 'finish' when result exists and no error", () => {
      const tools = [makeToolSessionItem({ toolCallId: "c1", hasResult: true, isError: false })];
      render(<ToolStepsCard tools={tools} defaultExpanded={true} />);

      const step = screen.getByTestId("step-c1");
      expect(step.getAttribute("data-status")).toBe("finish");
    });

    it("maps step status to 'error' when result has isError=true", () => {
      const tools = [makeToolSessionItem({ toolCallId: "c1", hasResult: true, isError: true })];
      render(<ToolStepsCard tools={tools} defaultExpanded={true} />);

      const step = screen.getByTestId("step-c1");
      expect(step.getAttribute("data-status")).toBe("error");
    });

    it("maps step status to 'wait' when no result and no streamingOutput", () => {
      const tools = [
        makeToolSessionItem({ toolCallId: "c1", hasResult: false, streamingOutput: undefined }),
      ];
      render(<ToolStepsCard tools={tools} defaultExpanded={true} />);

      const step = screen.getByTestId("step-c1");
      expect(step.getAttribute("data-status")).toBe("wait");
    });

    it("maps step status to 'process' when no result but has streamingOutput", () => {
      const tools = [
        makeToolSessionItem({ toolCallId: "c1", hasResult: false, streamingOutput: "running..." }),
      ];
      render(<ToolStepsCard tools={tools} defaultExpanded={true} />);

      const step = screen.getByTestId("step-c1");
      expect(step.getAttribute("data-status")).toBe("process");
    });

    it("renders correct number of steps from tools array", () => {
      const tools = [
        makeToolSessionItem({ toolCallId: "c1" }),
        makeToolSessionItem({ toolCallId: "c2" }),
        makeToolSessionItem({ toolCallId: "c3" }),
      ];
      render(<ToolStepsCard tools={tools} defaultExpanded={true} />);

      const steps = screen.getByTestId("steps");
      const stepEls = steps.querySelectorAll(':scope > [data-testid^="step-"]');
      expect(stepEls).toHaveLength(3);
    });

    it("passes result to drawer so Result tab is populated", () => {
      const tools = [
        makeToolSessionItem({
          toolCallId: "c1",
          hasResult: true,
          isError: false,
          resultContent: "operation completed",
        }),
      ];
      render(<ToolStepsCard tools={tools} defaultExpanded={true} />);

      // Click Details to open the drawer
      fireEvent.click(screen.getByTestId("tool-step-details-c1"));

      // The Result tab content should contain the actual result text
      const resultTab = screen.getByTestId("tab-content-result");
      expect(resultTab.textContent).toContain("operation completed");
    });
  });

  // ── hideHeader ────────────────────────────────────────────────────

  describe("hideHeader", () => {
    it("hides mini header when hideHeader=true", () => {
      const calls = [makeCall({ toolCallId: "c1" })];
      render(<ToolStepsCard toolCalls={calls} defaultExpanded={true} hideHeader={true} />);

      expect(screen.queryByTestId("tool-steps-header")).toBeNull();
    });

    it("shows mini header when hideHeader=false (default)", () => {
      const calls = [makeCall({ toolCallId: "c1" })];
      render(<ToolStepsCard toolCalls={calls} defaultExpanded={true} />);

      expect(screen.getByTestId("tool-steps-header")).toBeDefined();
    });

    it("renders steps body immediately when hideHeader=true regardless of expanded state", () => {
      const calls = [makeCall({ toolCallId: "c1" })];
      // Even with defaultExpanded=false, steps should render because hideHeader=true
      render(<ToolStepsCard toolCalls={calls} defaultExpanded={false} hideHeader={true} />);

      expect(screen.getByTestId("steps")).toBeDefined();
    });
  });
});
