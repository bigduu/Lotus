import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandItem } from "@shared/types/command";
import { useCommandSelectorState } from "./useCommandSelectorState";

const commandService = vi.hoisted(() => ({
  listCommands: vi.fn(),
}));

vi.mock("../../services/CommandService", () => ({
  CommandService: {
    getInstance: () => commandService,
  },
}));

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
});
