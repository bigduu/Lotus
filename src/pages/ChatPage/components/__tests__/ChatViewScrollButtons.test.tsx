import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStoreState: any = {
  currentSessionId: "session-1",
  chats: [{ id: "session-1", kind: "root", messages: [{ id: "m1" }], messageCount: 1 }],
  deleteMessage: vi.fn(),
  updateSession: vi.fn(),
  loadChatHistory: vi.fn(),
  loadTaskList: vi.fn().mockResolvedValue(undefined),
  subAgentsByParent: {},
  selectSession: vi.fn(),
  setSessionProcessing: vi.fn(),
  isSessionProcessing: vi.fn(() => false),
  processingChats: new Set<string>(),
  tokenUsages: {},
  truncationOccurred: {},
  segmentsRemoved: {},
  taskLists: {},
};

vi.mock("antd", async () => {
  const actual = await vi.importActual<any>("antd");
  return {
    ...actual,
    Grid: {
      ...actual.Grid,
      useBreakpoint: () => ({ xs: false }),
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, optionsOrDefault?: any, maybeDefault?: string) => {
      if (typeof optionsOrDefault === "string") return optionsOrDefault;
      if (typeof maybeDefault === "string") return maybeDefault;
      if (optionsOrDefault && typeof optionsOrDefault === "object") {
        if (typeof optionsOrDefault.defaultValue === "string") {
          return optionsOrDefault.defaultValue.replace(
            "{{count}}",
            String(optionsOrDefault.count ?? 0),
          );
        }
        if (key === "chat.scroll.newMessagesWithCount") {
          return `${optionsOrDefault.count ?? 0} new messages`;
        }
      }
      return key;
    },
  }),
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
    {
      subscribe: vi.fn(() => vi.fn()),
      getState: vi.fn(() => mockStoreState),
      setState: vi.fn(),
    },
  ),
  selectSessionById: (sessionId: string | null) => (state: typeof mockStoreState) =>
    sessionId ? state.chats.find((c: any) => c.id === sessionId) || null : null,
  selectIsBusy: (_sessionId: string | null) => (_state: typeof mockStoreState) => false,
  selectChildren: () => () => ({}),
}));

vi.mock("../ChatView/useChatViewMessages", () => ({
  useChatViewMessages: () => ({
    systemPromptMessage: null,
    renderableMessages: [
      { message: { id: "m1", role: "assistant", createdAt: new Date().toISOString() } },
      { message: { id: "m2", role: "assistant", createdAt: new Date().toISOString() } },
      { message: { id: "m3", role: "assistant", createdAt: new Date().toISOString() } },
      { message: { id: "m4", role: "assistant", createdAt: new Date().toISOString() } },
    ],
    convertRenderableEntry: vi.fn(),
  }),
}));

vi.mock("../ChatView/useChatViewScroll", () => ({
  useChatViewScroll: () => ({
    handleMessagesScroll: vi.fn(),
    hasUnreadActivity: true,
    resetUserScroll: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollToTop: vi.fn(),
    showScrollToBottom: true,
    showScrollToTop: true,
    unreadCount: 3,
  }),
}));

vi.mock("../ChatView/ChatMessagesList", () => ({
  ChatMessagesList: () => <div data-testid="chat-messages-list" />,
}));

vi.mock("../InputContainer", () => ({
  InputContainer: () => <div data-testid="chat-input-area" />,
}));

vi.mock("../ChatView/SubAgentsPanel", () => ({
  SubAgentsPanel: () => null,
}));

vi.mock("../ChatView/ActiveToolMessageCard", () => ({
  __esModule: true,
  default: () => null,
  ActiveToolMessageCard: () => null,
}));

vi.mock("../EmptyTaskLauncher", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("@components/QuestionDialog", () => ({
  QuestionDialog: () => null,
}));

vi.mock("@components/TodoList", () => ({
  TodoList: () => null,
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
  }),
}));

import { ChatView } from "../ChatView";

describe("ChatView scroll button group", () => {
  beforeEach(() => {
    mockStoreState.deleteMessage.mockReset();
    mockStoreState.updateSession.mockReset();
    mockStoreState.loadTaskList.mockClear();
  });

  it("renders visible sticky scroll controls near the message composer", () => {
    render(<ChatView />);

    const bottomStack = screen.getByTestId("chat-bottom-stack");
    const capsule = screen.getByTestId("chat-scroll-capsule-wrapper");

    expect(bottomStack).toContainElement(capsule);
    expect(screen.getByTestId("chat-scroll-top-button")).toBeInTheDocument();
    expect(screen.getByTestId("chat-scroll-bottom-button")).toBeInTheDocument();
    expect(screen.getByText("3 new messages")).toBeInTheDocument();
  });
});
