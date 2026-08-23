import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandItem } from "@shared/types/command";
import type { WorkflowCatalogView } from "../../../../features/workflows";
import { filterAndRankCommands, useCommandSelectorState } from "./useCommandSelectorState";

const commandService = vi.hoisted(() => ({
  listCommands: vi.fn(),
}));
const catalogQuery = vi.hoisted(() => ({
  load: vi.fn(),
  invalidate: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("../../services/CommandService", () => ({
  CommandService: {
    getInstance: () => commandService,
  },
}));

vi.mock("../../../../features/workflows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../features/workflows")>()),
  workflowCatalogQuery: catalogQuery,
}));

const emptyCatalog: WorkflowCatalogView = {
  revision: 1,
  items: [],
  diagnostics: [],
  capabilities: {
    mode: "legacy",
    clone: false,
    edit: false,
    activate: false,
    run: false,
    cancel: false,
  },
};

const command = (session: string): CommandItem => ({
  id: `skill-${session}`,
  name: `skill-${session}`,
  displayName: `Skill ${session}`,
  description: `Only visible in ${session}`,
  type: "skill",
  metadata: {},
});

describe("useCommandSelectorState session scoping", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    catalogQuery.load.mockResolvedValue(emptyCatalog);
    catalogQuery.subscribe.mockReturnValue(vi.fn());
  });

  it("refreshes on session switch and ignores the previous session's late response", async () => {
    let resolveSessionOne: ((commands: CommandItem[]) => void) | undefined;
    const sessionOneResponse = new Promise<CommandItem[]>((resolve) => {
      resolveSessionOne = resolve;
    });
    const sessionTwoCommand = command("session-two");

    commandService.listCommands.mockImplementation((sessionId: string) => {
      if (sessionId === "session-one") return sessionOneResponse;
      if (sessionId === "session-two") return Promise.resolve([sessionTwoCommand]);
      throw new Error(`Unexpected session: ${sessionId}`);
    });

    const { result, rerender } = renderHook(
      ({ sessionId }) =>
        useCommandSelectorState({
          visible: true,
          sessionId,
          searchText: "",
          onSelect: vi.fn(),
          onCancel: vi.fn(),
        }),
      { initialProps: { sessionId: "session-one" } },
    );

    rerender({ sessionId: "session-two" });

    await waitFor(() => {
      expect(result.current.filteredCommands).toEqual([sessionTwoCommand]);
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      resolveSessionOne?.([command("session-one")]);
      await sessionOneResponse;
    });

    expect(result.current.filteredCommands).toEqual([sessionTwoCommand]);
    expect(commandService.listCommands).toHaveBeenNthCalledWith(1, "session-one");
    expect(commandService.listCommands).toHaveBeenNthCalledWith(2, "session-two");
  });

  it("keeps commands usable when the Workflow catalog is degraded", async () => {
    const available = command("available");
    commandService.listCommands.mockResolvedValue([available]);
    catalogQuery.load.mockRejectedValue(new Error("Workflow catalog offline"));

    const { result } = renderHook(() =>
      useCommandSelectorState({
        visible: true,
        sessionId: "session-one",
        searchText: "",
        onSelect: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.filteredCommands).toEqual([available]);
    expect(result.current.loadError).toContain("Workflow catalog offline");
  });

  it("refreshes visible catalog rows when the invalidation subscription fires", async () => {
    let invalidateListener: (() => void) | undefined;
    const catalogFor = (description: string, revision: number): WorkflowCatalogView => ({
      ...emptyCatalog,
      revision,
      items: [
        {
          id: "review",
          name: "Review",
          description,
          kind: "instruction",
          source: "builtin",
          status: "valid",
          invocationPolicy: "both",
          argumentHint: "<scope>",
          readOnly: true,
          revision,
        },
      ],
    });
    commandService.listCommands.mockResolvedValue([command("unrelated")]);
    catalogQuery.load
      .mockResolvedValueOnce(catalogFor("Initial metadata", 1))
      .mockResolvedValueOnce(catalogFor("Recovered metadata", 2));
    catalogQuery.subscribe.mockImplementation((listener: () => void) => {
      invalidateListener = listener;
      return vi.fn();
    });

    const { result } = renderHook(() =>
      useCommandSelectorState({
        visible: true,
        sessionId: "session-one",
        searchText: "scope",
        onSelect: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    await waitFor(() =>
      expect(result.current.filteredCommands[0]?.description).toBe("Initial metadata"),
    );

    act(() => invalidateListener?.());
    await waitFor(() =>
      expect(result.current.filteredCommands[0]?.description).toBe("Recovered metadata"),
    );
    expect(catalogQuery.load).toHaveBeenCalledTimes(2);
  });
});

describe("filterAndRankCommands", () => {
  it("ranks an exact command name ahead of description-only fuzzy matches", () => {
    const agentBrowser: CommandItem = {
      id: "skill-agent-browser",
      name: "agent-browser",
      displayName: "Agent Browser",
      description: "Use for browser review and workflow testing.",
      type: "skill",
      metadata: {},
    };
    const review: CommandItem = {
      id: "skill-review",
      name: "review",
      displayName: "Review",
      description: "Review a scoped code change.",
      type: "skill",
      metadata: {},
    };

    expect(filterAndRankCommands([agentBrowser, review], "review")).toEqual([review, agentBrowser]);
  });

  it("preserves source order when the query is empty", () => {
    const first = command("first");
    const second = command("second");
    expect(filterAndRankCommands([first, second], "")).toEqual([first, second]);
  });

  it("searches metadata-only Workflow argument hints and diagnostics", () => {
    const workflow = command("workflow");
    workflow.metadata = {
      workflowCatalog: true,
      workflowKind: "instruction",
      workflowSource: "builtin",
      workflowStatus: "invalid",
      workflowInvocationPolicy: "both",
      workflowArgumentHint: "<repository> [focus]",
      workflowLastError: "Using last-known-good metadata",
    };

    expect(filterAndRankCommands([workflow], "repository")).toEqual([workflow]);
    expect(filterAndRankCommands([workflow], "last-known-good")).toEqual([workflow]);
  });
});
