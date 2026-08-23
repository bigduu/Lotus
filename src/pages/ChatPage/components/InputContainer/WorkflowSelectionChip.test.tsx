import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import WorkflowSelectionChip from "./WorkflowSelectionChip";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      ({
        "settings.workflowsTab.revision": `Revision ${values?.revision}`,
        "chat.workflowSelection.reselect": "Reselect",
        "chat.workflowSelection.argumentsLabel": "Workflow arguments (JSON)",
        "chat.workflowSelection.argumentsHint": `Arguments: ${values?.hint}`,
        "chat.workflowSelection.selectionRejected": "Workflow selection needs attention",
        "chat.workflowSelection.refreshCatalog": "Refresh catalog",
      })[key] ?? key,
  }),
}));

const draft = {
  id: "draft-review",
  name: "review",
  displayName: "Review",
  content: "",
  createdAt: "2026-08-23T08:00:00Z",
  type: "skill" as const,
  workflowSelection: {
    id: "review",
    source: "project" as const,
    revision: 12,
    args: { scope: "src" },
  },
  workflowArgumentHint: "<scope>",
  workflowArgumentsText: '{"scope":"src"}',
  workflowArgumentsError: null,
  workflowActivationError: "The selected revision changed.",
};

describe("WorkflowSelectionChip", () => {
  it("edits JSON args and exposes refresh/reselection recovery actions", () => {
    const onArgumentsChange = vi.fn();
    const onRefresh = vi.fn();
    const onReselect = vi.fn();
    render(
      <WorkflowSelectionChip
        draft={draft}
        onArgumentsChange={onArgumentsChange}
        onRefresh={onRefresh}
        onReselect={onReselect}
      />,
    );

    fireEvent.change(screen.getByLabelText("Workflow arguments (JSON)"), {
      target: { value: '{"scope":"tests"}' },
    });
    expect(onArgumentsChange).toHaveBeenCalledWith('{"scope":"tests"}');
    expect(screen.getByText("The selected revision changed.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh catalog" }));
    expect(onRefresh).toHaveBeenCalledOnce();
    fireEvent.click(screen.getAllByRole("button", { name: "Reselect" })[0]);
    expect(onReselect).toHaveBeenCalledOnce();
  });
});
