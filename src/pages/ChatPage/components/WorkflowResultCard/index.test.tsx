import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WorkflowResultCard from ".";

const { mockCopyText } = vi.hoisted(() => ({
  mockCopyText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@shared/utils/clipboard", () => ({ copyText: mockCopyText }));

vi.mock("@shared/components/Markdown/LazySyntaxHighlighter", () => ({
  LazySyntaxHighlighter: ({ codeString }: { codeString: string }) => (
    <pre data-testid="syntax-highlighter">{codeString}</pre>
  ),
}));

beforeEach(() => {
  mockCopyText.mockClear();
});

describe("WorkflowResultCard", () => {
  it("expands JSON and wires result copy, parameter copy, and retry actions", async () => {
    const onRetry = vi.fn();
    const { container } = render(
      <WorkflowResultCard
        content='{"ok":true,"value":2}'
        workflowName="deploy"
        parameters={{ environment: "staging" }}
        status="warning"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("deploy")).toBeInTheDocument();
    expect(screen.getByText("warning")).toBeInTheDocument();
    expect(screen.getAllByTestId("syntax-highlighter")).toHaveLength(2);

    const expandButton = container.querySelector(".anticon-expand-alt")?.closest("button");
    expect(expandButton).not.toBeNull();
    fireEvent.click(expandButton as HTMLButtonElement);
    expect(container.querySelector(".anticon-compress")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "components.workflowResult.copyContent" }));
    fireEvent.click(
      screen.getByRole("button", { name: "components.workflowResult.copyParameters" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "components.workflowResult.retryWorkflow" }),
    );

    await waitFor(() => {
      expect(mockCopyText).toHaveBeenNthCalledWith(1, '{\n  "ok": true,\n  "value": 2\n}');
      expect(mockCopyText).toHaveBeenNthCalledWith(2, '{\n  "environment": "staging"\n}');
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("derives loading from empty content and still surfaces execution errors", () => {
    const { container } = render(
      <WorkflowResultCard
        content=""
        workflowName="broken-workflow"
        status="error"
        errorMessage="Backend failed"
      />,
    );

    expect(screen.getByText("components.workflowResult.executionFailed")).toBeInTheDocument();
    expect(screen.getByText("Backend failed")).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "components.workflowResult.retryWorkflow" }),
    ).not.toBeInTheDocument();
  });
});
