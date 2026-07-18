import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { App as AntApp, ConfigProvider } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../shared/components/Markdown/MarkdownCodeBlock", () => ({
  renderCodeBlock: vi.fn((language: string, codeString: string) => (
    <div data-testid="render-code-block" data-language={language}>
      {codeString}
    </div>
  )),
}));

const setAssistantLiveState = async (
  sessionId: string,
  patch: { content?: string; reasoningContent?: string },
) => {
  const { setAssistantStreamingState } = await import("../../streaming/assistantStreamingAtoms");
  setAssistantStreamingState(sessionId, {
    content: patch.content ?? "",
    reasoningContent: patch.reasoningContent ?? "",
    updatedAt: Date.now(),
  });
};

const clearAssistantLiveState = async (sessionId: string) => {
  const { clearAssistantStreamingState } = await import("../../streaming/assistantStreamingAtoms");
  clearAssistantStreamingState(sessionId);
};

const publishStatusToBus = async (sessionId: string, content: string | null) => {
  const { streamingMessageBus } = await import("../../utils/streamingMessageBus");
  streamingMessageBus.publish({
    sessionId,
    messageId: `streaming-status-${sessionId}`,
    content,
  });
  streamingMessageBus.forceFlush();
};

describe("StreamingMessageCard", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await clearAssistantLiveState("session-1");
    const { streamingMessageBus } = await import("../../utils/streamingMessageBus");
    streamingMessageBus.clear("session-1", "streaming-session-1");
    streamingMessageBus.clear("session-1", "streaming-reasoning-session-1");
    streamingMessageBus.clear("session-1", "streaming-status-session-1");
  });

  it("uses the opaque streaming surface without backdrop blur (#17)", async () => {
    const { default: StreamingMessageCard } = await import("./index");
    render(
      <AntApp>
        <StreamingMessageCard sessionId="session-1" />
      </AntApp>,
    );

    const card = screen.getByTestId("streaming-indicator");
    expect(card.style.background).toBe("var(--lotus-message-streaming-bg)");
    expect(card.style.backdropFilter).toBeUndefined();
    expect(card.style.webkitBackdropFilter).toBeUndefined();
  });

  it("renders mermaid blocks as readable code during streaming instead of mounting a chart", async () => {
    const { default: StreamingMessageCard } = await import("./index");

    await setAssistantLiveState("session-1", {
      content: "```mermaid\ngraph TD\nA --> B\n```",
    });

    const { container } = render(
      <ConfigProvider
        theme={{
          token: {
            colorBgContainer: "rgb(17, 24, 39)",
            colorText: "rgb(243, 244, 246)",
          },
        }}
      >
        <AntApp>
          <StreamingMessageCard sessionId="session-1" />
        </AntApp>
      </ConfigProvider>,
    );

    await waitFor(() => {
      const code = container.querySelector("pre code");
      expect(code?.textContent).toContain("graph TD");
      expect(code?.textContent).toContain("A --> B");
    });

    expect(screen.queryByTestId("render-code-block")).not.toBeInTheDocument();

    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre).toHaveStyle({
      background: "rgb(17, 24, 39)",
      color: "rgb(243, 244, 246)",
    });
  });

  it("treats mermaid alias fenced blocks as plain code during streaming", async () => {
    const { default: StreamingMessageCard } = await import("./index");

    await setAssistantLiveState("session-1", {
      content: "```graph\nA --> B\n```",
    });

    const { container } = render(
      <AntApp>
        <StreamingMessageCard sessionId="session-1" />
      </AntApp>,
    );

    await waitFor(() => {
      const code = container.querySelector("pre code");
      expect(code?.textContent).toContain("A --> B");
    });

    expect(screen.queryByTestId("render-code-block")).not.toBeInTheDocument();
  });

  it("still delegates non-mermaid code blocks to shared renderCodeBlock", async () => {
    const { default: StreamingMessageCard } = await import("./index");

    await setAssistantLiveState("session-1", {
      content: "```ts\nconst value = 1;\n```",
    });

    render(
      <AntApp>
        <StreamingMessageCard sessionId="session-1" />
      </AntApp>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("render-code-block")).toHaveAttribute("data-language", "ts");
    });
  });

  it("still renders thinking/status text from the streaming bus while assistant content comes from Jotai", async () => {
    const { default: StreamingMessageCard } = await import("./index");

    await publishStatusToBus("session-1", "memory_updating");

    render(
      <AntApp>
        <StreamingMessageCard sessionId="session-1" />
      </AntApp>,
    );

    await waitFor(() => {
      expect(screen.getByText(/memory/i)).toBeInTheDocument();
    });
  });
});
