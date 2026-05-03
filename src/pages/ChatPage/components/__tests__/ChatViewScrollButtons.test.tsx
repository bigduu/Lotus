import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStoreState: any = {
  currentSessionId: null,
  chats: [],
  deleteMessage: vi.fn(),
  updateSession: vi.fn(),
  loadChatHistory: vi.fn(),
  subSessionsByParent: {},
  selectSession: vi.fn(),
  setSessionProcessing: vi.fn(),
  isSessionProcessing: vi.fn(() => false),
  processingChats: new Set<string>(),
  tokenUsages: {},
  truncationOccurred: {},
  segmentsRemoved: {},
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

vi.mock("../../store", () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
    {
      subscribe: vi.fn(() => vi.fn()), // Return unsubscribe function
      getState: vi.fn(() => mockStoreState),
      setState: vi.fn(),
    },
  ),
  selectSessionById: (sessionId: string | null) => (state: typeof mockStoreState) =>
    sessionId ? state.chats.find((c: any) => c.id === sessionId) || null : null,
  selectIsBusy: (_sessionId: string | null) => (_state: typeof mockStoreState) => false,
}));

vi.mock("../ChatView/useChatViewMessages", () => ({
  useChatViewMessages: () => ({
    systemPromptMessage: null,
    renderableMessages: [],
    convertRenderableEntry: vi.fn(),
  }),
}));

vi.mock("../ChatView/useChatViewScroll", () => ({
  useChatViewScroll: () => ({
    handleMessagesScroll: vi.fn(),
    resetUserScroll: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollToTop: vi.fn(),
    showScrollToBottom: false,
    showScrollToTop: true,
  }),
}));

vi.mock("../ChatView/ChatMessagesList", () => ({
  ChatMessagesList: () => <div data-testid="chat-messages-list" />,
}));

vi.mock("../ChatView/ChatInputArea", () => ({
  ChatInputArea: () => <div data-testid="chat-input-area" />,
}));

vi.mock("../ChatView/SubSessionsPanel", () => ({
  SubSessionsPanel: () => null,
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
  });

  it("renders scroll button container with the expected absolute position", () => {
    const { container } = render(<ChatView />);
    // The scroll buttons are now in a plain div with position: absolute
    // Look for a container that has FloatButton children
    const floatBtns = container.querySelectorAll(".ant-float-btn");
    expect(floatBtns.length).toBeGreaterThan(0);

    // The parent div should have absolute positioning
    const wrapper = floatBtns[0].parentElement;
    expect(wrapper).not.toBeNull();
    expect((wrapper as HTMLElement).style.position).toBe("absolute");
    expect((wrapper as HTMLElement).style.bottom).toBe("180px");
    expect((wrapper as HTMLElement).style.right).toBe("32px");
  });
});
