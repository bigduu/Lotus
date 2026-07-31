import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PermissionDecisionConfirmation } from "./PermissionDecisionConfirmation";

const request = {
  requestId: "request-1",
  workspacePath: "/workspace/project",
  policyRevision: 3,
  allowedDecisions: [{ id: "allow_workspace" }],
  suggestedMatchers: [
    { id: "prefix", kind: "command_prefix", value: "git" },
    { id: "opaque-exact", kind: "exact_resource", value: "git push origin main" },
  ],
};

describe("PermissionDecisionConfirmation", () => {
  it("defaults to the exact matcher and lets the user choose another backend suggestion", () => {
    const onMatcherChange = vi.fn();
    render(
      <PermissionDecisionConfirmation
        decision="allow_workspace"
        request={request}
        onMatcherChange={onMatcherChange}
      />,
    );

    expect(screen.getByText("/workspace/project")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /exact_resource git push origin main/i }),
    ).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /command_prefix git/i }));
    expect(onMatcherChange).toHaveBeenCalledWith("prefix");
  });

  it("shows the stronger global warning without implying a workspace boundary", () => {
    render(
      <PermissionDecisionConfirmation
        decision="allow_global"
        request={request}
        onMatcherChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("/workspace/project")).not.toBeInTheDocument();
    expect(screen.getByText(/allowed in every workspace until you revoke it/i)).toBeInTheDocument();
  });
});
