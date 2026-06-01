import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionDetail = vi.fn();
const mockUseAppStore = vi.fn();
const mockSelectSessionById = vi.fn();

vi.mock("antd", () => ({
  Tag: vi.fn(({ children, ...props }: any) => (
    <span data-testid="tag" {...props}>
      {children}
    </span>
  )),
  Tooltip: vi.fn(({ title, children }: any) => (
    <div data-testid="tooltip">
      {children}
      {title ? <div data-testid="tooltip-title">{title}</div> : null}
    </div>
  )),
  theme: {
    useToken: () => ({
      token: {
        colorPrimary: "#1677ff",
        colorText: "#111",
        colorTextSecondary: "#666",
        colorTextTertiary: "#999",
        colorBorderSecondary: "#f0f0f0",
        colorBgElevated: "#fff",
      },
    }),
  },
}));

vi.mock("@ant-design/icons", () => ({
  ClockCircleOutlined: () => <span data-testid="icon-clock" />,
  CodeOutlined: () => <span data-testid="icon-code" />,
  DownOutlined: () => <span data-testid="icon-down" />,
  FileTextOutlined: () => <span data-testid="icon-file" />,
  FunctionOutlined: () => <span data-testid="icon-function" />,
  MessageOutlined: () => <span data-testid="icon-message" />,
  ProfileOutlined: () => <span data-testid="icon-profile" />,
  WarningOutlined: () => <span data-testid="icon-warning" />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../../../shared/components/InlineMetaText", () => ({
  default: ({ items }: { items: string[] }) => (
    <div data-testid="inline-meta">{items.join(", ")}</div>
  ),
}));

vi.mock("../../../../services/metrics", () => ({
  metricsService: {
    getSessionDetail: (...args: any[]) => mockGetSessionDetail(...args),
  },
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: (selector: any) => mockUseAppStore(selector),
  selectSessionById: (...args: any[]) => mockSelectSessionById(...args),
}));

import { SessionSummaryCard } from "./index";

const buildChat = (sessionId: string) => ({
  id: sessionId,
  messages: [
    {
      id: "u1",
      role: "user",
      content: "Please inspect this repo",
      createdAt: "2026-05-11T10:00:00.000Z",
    },
    {
      id: "a1",
      role: "assistant",
      type: "text",
      content:
        "I reviewed the repository and identified a few architecture issues worth addressing first.",
      createdAt: "2026-05-11T10:00:05.000Z",
    },
    {
      id: "a2",
      role: "assistant",
      type: "tool_call",
      toolCalls: [
        {
          toolCallId: "call-1",
          toolName: "Read",
          parameters: { file_path: "/tmp/demo.ts" },
        },
      ],
      createdAt: "2026-05-11T10:00:06.000Z",
    },
  ],
});

describe("SessionSummaryCard", () => {
  beforeEach(() => {
    mockGetSessionDetail.mockReset();
    mockSelectSessionById.mockReset();
    mockUseAppStore.mockReset();

    mockSelectSessionById.mockReturnValue("selector-result");
  });

  it("renders cumulative token usage from session metrics in collapsed summary", async () => {
    const sessionId = "session-collapsed";
    mockUseAppStore.mockImplementation(() => buildChat(sessionId));
    mockGetSessionDetail.mockResolvedValue({
      session: {
        session_id: sessionId,
        model: "gpt-5",
        started_at: "2026-05-11T10:00:00.000Z",
        completed_at: null,
        total_rounds: 3,
        total_token_usage: {
          prompt_tokens: 820314,
          completion_tokens: 425018,
          total_tokens: 1245332,
        },
        tool_call_count: 1,
        tool_breakdown: {},
        status: "running",
        message_count: 3,
        duration_ms: 1200,
      },
      rounds: [],
    });

    render(<SessionSummaryCard sessionId={sessionId} compact />);

    await waitFor(() => {
      expect(mockGetSessionDetail).toHaveBeenCalledWith(sessionId);
    });

    expect(screen.getByText("1.2M")).toBeInTheDocument();
    expect(screen.getByText("Total tokens")).toBeInTheDocument();
    expect(screen.getByText(/Prompt: 820,314/)).toBeInTheDocument();
    expect(screen.getByText(/Completion: 425,018/)).toBeInTheDocument();
    expect(screen.getByText(/Total tokens: 1,245,332/)).toBeInTheDocument();
  });

  it("shows expanded total tokens from metrics instead of current window token usage", async () => {
    const sessionId = "session-expanded";
    mockUseAppStore.mockImplementation(() => ({
      ...buildChat(sessionId),
      config: {
        tokenUsage: {
          systemTokens: 100,
          summaryTokens: 50,
          windowTokens: 850,
          totalTokens: 1000,
          budgetLimit: 4000,
        },
      },
    }));

    mockGetSessionDetail.mockResolvedValue({
      session: {
        session_id: sessionId,
        model: "gpt-5",
        started_at: "2026-05-11T10:00:00.000Z",
        completed_at: null,
        total_rounds: 8,
        total_token_usage: {
          prompt_tokens: 1500000,
          completion_tokens: 250000,
          total_tokens: 1750000,
        },
        tool_call_count: 2,
        tool_breakdown: {},
        status: "running",
        message_count: 3,
        duration_ms: 1200,
      },
      rounds: [],
    });

    render(<SessionSummaryCard sessionId={sessionId} />);

    const header = screen.getByRole("button");
    fireEvent.click(header);

    await waitFor(() => {
      expect(screen.getByText("1.8M")).toBeInTheDocument();
    });

    expect(screen.getByText(/Total tokens: 1,750,000/)).toBeInTheDocument();
    expect(screen.queryByText("1,000")).not.toBeInTheDocument();
  });

  it("does not render token stats when metrics are unavailable", async () => {
    const sessionId = "session-no-metrics";
    mockUseAppStore.mockImplementation(() => buildChat(sessionId));
    mockGetSessionDetail.mockResolvedValue(null);

    render(<SessionSummaryCard sessionId={sessionId} compact />);

    await waitFor(() => {
      expect(mockGetSessionDetail).toHaveBeenCalledWith(sessionId);
    });

    expect(screen.queryByText(/total tokens/i)).toBeNull();
    expect(screen.queryByText("1.2M")).toBeNull();
  });
});
