import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CHAT_PENDING_QUESTION_RESOLVED_EVENT } from "../ChatView/events";
import { InteractiveQuestionToolCard } from "./InteractiveQuestionToolCard";

const baseProps = {
  sessionId: "root-session",
  question: "Allow this command?",
  options: ["allow_once", "deny_once"],
  allowCustom: false,
  toolCallId: "tool-call-1",
  conclusionMarkdown: null,
  markdownComponents: {},
  markdownPlugins: [],
  rehypePlugins: [],
};

describe("InteractiveQuestionToolCard permission details", () => {
  it("explains a bypass exception and safely expands a long resource", () => {
    const resource = `git push ${"origin/".repeat(40)}main`;
    render(
      <InteractiveQuestionToolCard
        {...baseProps}
        permissionRequest={{
          requestId: "request-1",
          sessionId: "child-session",
          childSessionId: "child-executor-1",
          tool: "Bash",
          resource,
          risk: "high",
          reasonCode: "configured_always_ask",
          effectiveMode: "bypass",
          bypassRequested: true,
          matchedRule: { id: "Bash(git push *)", source: "user" },
          allowedDecisions: [{ id: "allow_once" }, { id: "deny_once" }],
          suggestedMatchers: [],
        }}
      />,
    );

    expect(
      screen.getByText(
        "Bypass is on, but this operation matched the required approval rule Bash(git push *).",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("child-executor-1")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.queryByText(resource)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show full resource" }));
    expect(screen.getByText(resource)).toBeInTheDocument();
  });

  it("does not carry resolved UI state to a replay with a different request id", () => {
    const permissionRequest = {
      requestId: "request-1",
      allowedDecisions: [{ id: "allow_once" }, { id: "deny_once" }],
      suggestedMatchers: [],
    };
    const { rerender } = render(
      <InteractiveQuestionToolCard {...baseProps} permissionRequest={permissionRequest} />,
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(CHAT_PENDING_QUESTION_RESOLVED_EVENT, {
          detail: { sessionId: "root-session", requestId: "request-1" },
        }),
      );
    });
    expect(screen.getByText("Response submitted, AI will continue processing")).toBeInTheDocument();

    rerender(
      <InteractiveQuestionToolCard
        {...baseProps}
        permissionRequest={{ ...permissionRequest, requestId: "request-2" }}
      />,
    );
    expect(
      screen.getByText("Please respond using the options below the input box."),
    ).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(CHAT_PENDING_QUESTION_RESOLVED_EVENT, {
          detail: { sessionId: "root-session", requestId: "request-1" },
        }),
      );
    });
    expect(
      screen.getByText("Please respond using the options below the input box."),
    ).toBeInTheDocument();
  });
});
