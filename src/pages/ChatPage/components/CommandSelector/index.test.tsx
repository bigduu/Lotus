import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandItem } from "@shared/types/command";
import CommandSelector from "./index";

const selectorState = vi.hoisted(() => vi.fn());

vi.mock("./useCommandSelectorState", () => ({
  useCommandSelectorState: selectorState,
}));

const workflow: CommandItem = {
  id: "workflow-catalog:review",
  name: "review",
  displayName: "Review",
  description: "Review a scoped change with evidence.",
  type: "skill",
  metadata: {
    workflowCatalog: true,
    workflowKind: "instruction",
    workflowSource: "builtin",
    workflowStatus: "invalid",
    workflowInvocationPolicy: "both",
    workflowArgumentHint: "<scope> [focus]",
    workflowRevision: 7,
    workflowVersion: "3",
    workflowWinner: true,
    workflowLastKnownGood: true,
    workflowSelectable: false,
    workflowShadowedCandidates: [{ source: "project", status: "invalid" }],
  },
};

const mcp: CommandItem = {
  id: "mcp-read",
  name: "mcp__files__read",
  displayName: "Read",
  description: "Read a file through MCP.",
  type: "mcp",
  metadata: { serverId: "files", serverName: "Files", originalName: "read" },
};

describe("CommandSelector Workflow catalog rows", () => {
  beforeEach(() => {
    selectorState.mockReturnValue({
      containerRef: { current: null },
      selectedItemRef: { current: null },
      filteredCommands: [workflow, mcp],
      selectedIndex: 0,
      setSelectedIndex: vi.fn(),
      isLoading: false,
      loadError: null,
      catalogDiagnostics: [],
      handleCommandSelect: vi.fn(),
    });
  });

  it("renders metadata-only Workflow diagnostics while keeping MCP semantically distinct", () => {
    render(
      <CommandSelector
        visible
        sessionId="session-230"
        searchText=""
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const rows = screen.getAllByRole("option");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("aria-disabled", "true");
    expect(within(rows[0]).getByText("Instruction")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Built-in")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Invalid")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Manual + automatic")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Last-known-good metadata")).toBeInTheDocument();
    expect(within(rows[0]).getByText("1 shadowed candidate")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Winner")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Arguments: <scope> [focus]")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Version 3 · Revision 7")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Activation available in a later update")).toBeInTheDocument();

    expect(within(rows[1]).getByText("MCP")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Files")).toBeInTheDocument();
    expect(within(rows[1]).queryByText("Instruction")).not.toBeInTheDocument();
  });
});
