import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ToolSessionCard, { type ToolSessionItem } from ".";

const buildToolItem = (overrides?: Partial<ToolSessionItem>): ToolSessionItem => ({
  call: {
    id: "assistant-msg-1:call-1",
    role: "assistant",
    type: "tool_call",
    createdAt: "2026-03-22T11:29:10.131388Z",
    toolCalls: [
      {
        toolCallId: "call-1",
        toolName: "write",
        parameters: { file_path: "/tmp/demo.ts" },
        streamingOutput: "",
      },
    ],
  },
  result: {
    id: "tool-msg-1",
    role: "assistant",
    type: "tool_result",
    createdAt: "2026-03-22T11:29:10.231388Z",
    toolName: "write",
    toolCallId: "call-1",
    isError: false,
    result: {
      tool_name: "write",
      result: "ok",
      display_preference: "Default",
    },
  },
  callMessageId: "assistant-msg-1",
  resultMessageId: "tool-msg-1",
  ...overrides,
});

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
      {items?.map((item: any) => (
        <div key={item.key} data-testid={`step-${item.key}`} data-status={item.status}>
          <div data-testid={`step-title-${item.key}`}>{item.title}</div>
          <div data-testid={`step-description-${item.key}`}>{item.description}</div>
        </div>
      ))}
    </div>
  )),
  Space: vi.fn(({ children }: any) => <div data-testid="space">{children}</div>),
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
        colorTextTertiary: "#999",
        colorSuccess: "#52c41a",
        colorError: "#ff4d4f",
        colorBgElevated: "#fff",
        colorBgContainer: "#fafafa",
        colorBorder: "#d9d9d9",
        colorBorderSecondary: "#f0f0f0",
        borderRadiusLG: 8,
        borderRadiusSM: 4,
        marginSM: 8,
        marginXS: 4,
        marginMD: 16,
        paddingSM: 8,
        paddingXS: 4,
        paddingMD: 16,
        paddingLG: 16,
        fontSizeSM: 12,
        colorBgContainer: "#fff",
        colorFillTertiary: "#f5f5f5",
      },
    }),
  },
  Badge: vi.fn(({ count, ...props }: any) => (
    <span data-testid="badge" data-count={count} {...props} />
  )),
  Button: vi.fn(({ children, onClick, "data-testid": testId, disabled, ...props }: any) => (
    <button data-testid={testId || "button"} onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  )),
  Tooltip: vi.fn(({ children }: any) => <div data-testid="tooltip">{children}</div>),
  Tag: vi.fn(({ children, color, ...props }: any) => (
    <span data-testid="tag" data-color={color} {...props}>
      {children}
    </span>
  )),
}));

vi.mock("@ant-design/icons", () => ({
  ToolOutlined: () => <span data-testid="icon-tool">Tool</span>,
  DownOutlined: () => <span data-testid="icon-down">Down</span>,
  RightOutlined: () => <span data-testid="icon-right">Right</span>,
  DeleteOutlined: () => <span data-testid="icon-delete">Delete</span>,
  CheckCircleOutlined: () => <span data-testid="icon-check">Check</span>,
  ClockCircleOutlined: () => <span data-testid="icon-clock">Clock</span>,
  CloseCircleOutlined: () => <span data-testid="icon-close">Close</span>,
  LoadingOutlined: () => <span data-testid="icon-loading">Loading</span>,
  EyeOutlined: () => <span data-testid="icon-eye">Eye</span>,
  CopyOutlined: () => <span data-testid="icon-copy">Copy</span>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../utils/mcpAlias", () => ({
  parseMcpToolAlias: (_name: string) => null,
}));

vi.mock("@shared/utils/resultFormatters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/utils/resultFormatters")>()),
  getFileChangeDiffStats: vi.fn(() => null),
  parseFileChangeResultPayload: vi.fn(() => null),
}));

vi.mock("../../../utils/toolIntent", () => ({
  generateIntentDescription: (toolName: string) => `Calling ${toolName}`,
}));

vi.mock("../../../../services/storage/StorageManager", () => ({
  StorageManager: {
    getInstance: () => ({
      saveToolSessionCollapse: vi.fn(() => Promise.resolve()),
      loadToolSessionCollapse: vi.fn(() => Promise.resolve(null)),
    }),
  },
}));

// Mock SyntaxHighlighter used in drawer
vi.mock("react-syntax-highlighter", () => ({
  Prism: vi.fn(({ children }: any) => <pre data-testid="syntax-highlighter">{children}</pre>),
}));
vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  oneDark: {},
}));

vi.mock("@shared/utils/clipboard", () => ({
  copyText: vi.fn(),
}));

describe("ToolSessionCard", () => {
  it("deletes persisted tool call/result messages", () => {
    const onDeleteMessageIds = vi.fn();

    render(
      <ToolSessionCard
        tools={[buildToolItem()]}
        sessionId="session-1"
        createdAt="2026-03-22T11:29:10.131388Z"
        defaultExpanded={true}
        onDeleteMessageIds={onDeleteMessageIds}
      />,
    );

    fireEvent.click(screen.getByTestId("delete-tool-session"));

    expect(onDeleteMessageIds).toHaveBeenCalledTimes(1);
    expect(onDeleteMessageIds).toHaveBeenCalledWith(["assistant-msg-1", "tool-msg-1"]);
  });

  it("disables delete when no persisted message id is available", () => {
    const onDeleteMessageIds = vi.fn();

    render(
      <ToolSessionCard
        tools={[
          {
            call: {
              id: "synthetic-tool-call:orphan-result",
              role: "assistant",
              type: "tool_call",
              createdAt: "2026-03-22T11:31:49.321433Z",
              toolCalls: [
                {
                  toolCallId: "call-2",
                  toolName: "unknown",
                  parameters: {},
                },
              ],
            },
          },
        ]}
        sessionId="session-2"
        createdAt="2026-03-22T11:31:49.321433Z"
        defaultExpanded={true}
        onDeleteMessageIds={onDeleteMessageIds}
      />,
    );

    const button = screen.getByTestId("delete-tool-session") as HTMLButtonElement;
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onDeleteMessageIds).not.toHaveBeenCalled();
  });

  it("renders step count matching tools count when expanded", () => {
    const tool1 = buildToolItem();
    const tool2 = buildToolItem({
      call: {
        ...buildToolItem().call,
        id: "assistant-msg-2:call-2",
        toolCalls: [
          {
            toolCallId: "call-2",
            toolName: "bash",
            parameters: { command: "ls" },
            streamingOutput: "",
          },
        ],
      },
      callMessageId: "assistant-msg-2",
      result: undefined,
      resultMessageId: undefined,
    });

    render(
      <ToolSessionCard
        tools={[tool1, tool2]}
        sessionId="session-1"
        createdAt="2026-03-22T11:29:10.131388Z"
        defaultExpanded={true}
      />,
    );

    // Should render Steps with 2 steps
    const steps = screen.getByTestId("steps");
    const stepEls = steps.querySelectorAll(':scope > [data-testid^="step-"]');
    expect(stepEls).toHaveLength(2);
  });

  it("renders a single tool with header and steps", () => {
    render(
      <ToolSessionCard
        tools={[buildToolItem()]}
        sessionId="session-1"
        createdAt="2026-03-22T11:29:10.131388Z"
        defaultExpanded={true}
      />,
    );

    expect(screen.getByTestId("tool-session-card-header")).toBeDefined();
    // Tool name should be in the header
    expect(screen.getByTestId("tool-session-card-header").textContent).toContain("write");
  });
});
