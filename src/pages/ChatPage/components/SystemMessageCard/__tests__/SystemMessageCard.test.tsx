import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const capturedCollapseItems: any[] = [];

vi.mock("antd", () => ({
  Button: vi.fn(({ children, ...props }: any) => (
    <button data-testid="button" {...props}>
      {children}
    </button>
  )),
  Card: vi.fn(({ children, ...props }: any) => (
    <div data-testid="card" {...props}>
      {children}
    </div>
  )),
  Collapse: vi.fn(({ items, defaultActiveKey, ...props }: any) => {
    capturedCollapseItems.splice(0, capturedCollapseItems.length, ...(items ?? []));
    return (
      <div
        data-testid="collapse"
        data-default-active-key={String(defaultActiveKey ?? "")}
        {...props}
      >
        {items?.map((item: any) => (
          <div key={item.key} data-testid={`collapse-item-${item.key}`}>
            <div>{item.label}</div>
            <div>{item.children}</div>
          </div>
        ))}
      </div>
    );
  }),
  Divider: vi.fn((props: any) => <hr data-testid="divider" {...props} />),
  Flex: vi.fn(({ children }: any) => <div data-testid="flex">{children}</div>),
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
        colorBgContainer: "#fff",
        colorPrimary: "#1677ff",
        borderRadiusLG: 8,
        marginSM: 8,
        marginXS: 4,
        paddingXS: 4,
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

vi.mock("../../store", () => ({
  useAppStore: (selector: (state: any) => any) =>
    selector({
      systemPrompts: [],
    }),
}));

vi.mock("../SystemPromptMarkdown", () => ({
  SystemPromptMarkdown: ({ content }: { content: string }) => (
    <div data-testid="system-prompt-markdown">{content}</div>
  ),
}));

vi.mock("../useSystemPromptContent", () => ({
  useSystemPromptContent: () => ({
    basePrompt: "Base prompt",
    loadingEnhanced: false,
    loadEnhancedPrompt: vi.fn(),
    promptSnapshot: { session_id: "session-1" },
    promptToDisplay: "Effective prompt",
    showEnhanced: true,
    setShowEnhanced: vi.fn(),
    snapshotSections: [
      { key: "base", content: "Base prompt" },
      { key: "instruction", content: "Instruction layer" },
      { key: "sessionMemory", content: "Session memory note" },
      { key: "externalMemory", content: "Memory layers block" },
      { key: "effective", content: "Effective prompt" },
    ],
  }),
}));

vi.mock("@shared/utils/clipboard", () => ({
  copyText: vi.fn(),
}));

import SystemMessageCard from "../index";

describe("SystemMessageCard", () => {
  it("renders prompt snapshot sections when backend snapshot is available", () => {
    render(
      <SystemMessageCard
        currentChat={{
          id: "session-1",
          title: "Session",
          createdAt: Date.now(),
          messages: [],
          config: {
            systemPromptId: "preset-1",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
          },
          currentInteraction: null,
        }}
        message={{
          id: "system-message-1",
          createdAt: "2026-04-03T00:00:00Z",
          role: "system",
          content: "Persisted system prompt",
        }}
      />,
    );

    expect(screen.getByText("chat.prompt.systemCard.title")).toBeInTheDocument();
    expect(screen.getByText("chat.prompt.systemCard.snapshotTitle")).toBeInTheDocument();
    expect(capturedCollapseItems.map((item) => item.key)).toEqual([
      "base",
      "instruction",
      "sessionMemory",
      "externalMemory",
      "effective",
    ]);
    expect(capturedCollapseItems.map((item) => item.label)).toEqual([
      "chat.prompt.systemCard.sections.base",
      "chat.prompt.systemCard.sections.instruction",
      "chat.prompt.systemCard.sections.sessionMemory",
      "chat.prompt.systemCard.sections.externalMemory",
      "chat.prompt.systemCard.sections.effective",
    ]);
    expect(screen.getByText("Instruction layer")).toBeInTheDocument();
    expect(screen.getByText("Session memory note")).toBeInTheDocument();
    expect(screen.getByText("Memory layers block")).toBeInTheDocument();
  });
});
