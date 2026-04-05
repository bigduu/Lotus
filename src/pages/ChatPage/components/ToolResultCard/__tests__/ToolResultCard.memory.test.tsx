import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("antd", () => ({
  Alert: vi.fn(({ message, description }: any) => (
    <div data-testid="alert">
      <div>{message}</div>
      <div>{description}</div>
    </div>
  )),
  Button: vi.fn(({ children, ...props }: any) => (
    <button data-testid="button" {...props}>
      {children}
    </button>
  )),
  Collapse: vi.fn(({ items, defaultActiveKey, ...rest }: any) => (
    <div data-testid="collapse" data-default-active-key={String(defaultActiveKey ?? "")} {...rest}>
      {items?.map((item: any) => (
        <div key={item.key} data-testid={`collapse-item-${item.key}`}>
          <div data-testid="collapse-label">{item.label}</div>
          <div data-testid="collapse-children">{item.children}</div>
        </div>
      ))}
    </div>
  )),
  Divider: vi.fn((props: any) => <hr data-testid="divider" {...props} />),
  Space: vi.fn(({ children }: any) => <div data-testid="space">{children}</div>),
  Tag: vi.fn(({ children, color, ...props }: any) => (
    <span data-testid="tag" data-color={color} {...props}>
      {children}
    </span>
  )),
  Tooltip: vi.fn(({ children }: any) => <div data-testid="tooltip">{children}</div>),
  Typography: {
    Text: vi.fn(({ children, strong, ellipsis, ...props }: any) => (
      <span
        data-testid="text"
        data-strong={strong ? "true" : undefined}
        data-ellipsis={ellipsis ? "true" : undefined}
        {...props}
      >
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
        colorBgContainer: "#fff",
        colorBorderSecondary: "#ddd",
        colorSuccessBg: "#f6ffed",
        colorErrorBg: "#fff2f0",
        colorWarningBg: "#fffbe6",
        colorFillSecondary: "#f5f5f5",
        colorFillTertiary: "#fafafa",
        borderRadiusLG: 8,
        borderRadiusSM: 4,
        marginSM: 8,
        marginXS: 4,
        paddingSM: 8,
        fontSizeSM: 12,
      },
    }),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("react-syntax-highlighter", () => ({
  Prism: vi.fn(({ children }: any) => <pre data-testid="syntax-highlighter">{children}</pre>),
}));

vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  oneDark: {},
}));

vi.mock("@shared/utils/clipboard", () => ({
  copyText: vi.fn(),
}));

import ToolResultCard from "../index";

describe("ToolResultCard - memory inspect and rebuild payloads", () => {
  it("renders a specialized summary for memory inspect payloads", () => {
    const payload = JSON.stringify({
      action: "inspect",
      data: {
        scope: "project",
        project_key: "zenith-123",
        total_memories: 4,
        by_type: { project: 2, reference: 2 },
        by_status: { active: 3, stale: 1 },
        recent_ids: ["mem_1", "mem_2"],
        view_files: ["dream.md"],
        index_files: ["lexical.json", "stale_candidates.json"],
        state_files: ["last_reindex.json"],
        stale_candidate_count: 1,
        last_reindex_at: "2026-04-03T13:00:00Z",
        last_dream_at: "2026-04-03T13:10:00Z",
        topic_paths: ["/tmp/memory/topic-a.md"],
      },
    });

    render(
      <ToolResultCard
        content={payload}
        toolName="memory"
        status="success"
        defaultCollapsed={false}
      />,
    );

    expect(screen.getByText("components.toolResult.memory.totalMemories")).toBeInTheDocument();
    expect(screen.getByText("components.toolResult.memory.staleCandidates")).toBeInTheDocument();
    expect(screen.getByText("components.toolResult.memory.indexesLabel")).toBeInTheDocument();
    expect(screen.getByText("components.toolResult.memory.stateFiles")).toBeInTheDocument();
    expect(screen.getByText("components.toolResult.memory.viewFiles")).toBeInTheDocument();
    expect(screen.getByText("components.toolResult.memory.topicPaths")).toBeInTheDocument();
    expect(screen.getByText("components.toolResult.memory.recentMemories")).toBeInTheDocument();
    expect(screen.getByText("dream.md")).toBeInTheDocument();
    expect(screen.getByText("/tmp/memory/topic-a.md")).toBeInTheDocument();
    expect(screen.getByText(new Date("2026-04-03T13:00:00Z").toLocaleString())).toBeInTheDocument();
    expect(screen.getByText("lexical.json")).toBeInTheDocument();
  });

  it("renders rebuild payloads with the same specialized memory summary shell", () => {
    const payload = JSON.stringify({
      action: "rebuild",
      data: {
        scope: "global",
        project_key: null,
        total_memories: 2,
        by_type: { reference: 2 },
        by_status: { active: 2 },
        recent_ids: ["mem_1"],
        view_files: ["DREAM_NOTEBOOK.md"],
        index_files: ["lexical.json"],
        state_files: ["last_reindex.json"],
        stale_candidate_count: 0,
        last_reindex_at: "2026-04-03T13:00:00Z",
        last_dream_at: "2026-04-03T13:10:00Z",
        topic_paths: [],
      },
    });

    render(
      <ToolResultCard
        content={payload}
        toolName="memory"
        status="success"
        defaultCollapsed={false}
      />,
    );

    expect(screen.getByText("components.toolResult.memory.action.rebuild")).toBeInTheDocument();
    expect(screen.getByText("components.toolResult.memory.totalMemories")).toBeInTheDocument();
    expect(screen.getByText("DREAM_NOTEBOOK.md")).toBeInTheDocument();
  });
});
