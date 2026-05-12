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

const publishToBus = async (sessionId: string, content: string) => {
  const { streamingMessageBus } = await import("../../utils/streamingMessageBus");
  streamingMessageBus.publish({
    sessionId,
    messageId: `streaming-${sessionId}`,
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
    const { streamingMessageBus } = await import("../../utils/streamingMessageBus");
    streamingMessageBus.clear("session-1", "streaming-session-1");
    streamingMessageBus.clear("session-1", "streaming-reasoning-session-1");
    streamingMessageBus.clear("session-1", "streaming-status-session-1");
  });

  it("renders mermaid blocks as readable code during streaming instead of mounting a chart", async () => {
    const { default: StreamingMessageCard } = await import("./index");

    await publishToBus("session-1", "```mermaid\ngraph TD\nA --> B\n```");

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

    await publishToBus("session-1", "```graph\nA --> B\n```");

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

    await publishToBus("session-1", "```ts\nconst value = 1;\n```");

    render(
      <AntApp>
        <StreamingMessageCard sessionId="session-1" />
      </AntApp>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("render-code-block")).toHaveAttribute("data-language", "ts");
    });
  });
});
