import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageInstance } from "antd/es/message/interface";

import { ApiError } from "@services/api";
import type { SessionSummary } from "@services/chat";
import type { ChatItem } from "@shared/types/chat";
import i18n from "@shared/i18n";
import { useInputContainerFileReferences } from "./useInputContainerFileReferences";

const makeChat = (id: string, workspacePath: string): ChatItem =>
  ({
    id,
    title: id,
    kind: "root",
    createdAt: "2026-07-28T00:00:00Z",
    messages: [],
    config: {
      systemPromptId: "general_assistant",
      baseSystemPrompt: "You are helpful.",
      lastUsedEnhancedPrompt: null,
      projectId: "proj-zenith",
      workspacePath,
    },
  }) as ChatItem;

const summary = (id: string, workspacePath: string): SessionSummary =>
  ({
    id,
    project_id: "proj-zenith",
    workspace_path: workspacePath,
  }) as SessionSummary;

const structuredError = (status: number, code: string): ApiError =>
  new ApiError(
    code,
    status,
    status === 412 ? "Precondition Failed" : "Conflict",
    JSON.stringify({ error: { type: "api_error", code, message: code } }),
  );

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("useInputContainerFileReferences workspace switching (#155)", () => {
  const messageError = vi.fn();
  const messageApi = { error: messageError } as unknown as MessageInstance;

  beforeEach(() => {
    messageError.mockReset();
  });

  it("keeps the attempted Other path and modal open after a structured 409", async () => {
    const switchSessionWorkspace = vi
      .fn()
      .mockRejectedValue(structuredError(409, "project_workspace_unbound"));
    const currentChat = makeChat("session-a", "/repo/zenith");
    const { result } = renderHook(() =>
      useInputContainerFileReferences({
        content: "",
        setContent: vi.fn(),
        currentSessionId: currentChat.id,
        currentChat,
        switchSessionWorkspace,
        messageApi,
      }),
    );

    act(() => result.current.openWorkspaceModal());
    let confirmed = true;
    await act(async () => {
      confirmed = await result.current.handleWorkspaceModalSubmit("/other/unbound");
    });

    expect(confirmed).toBe(false);
    expect(result.current.isWorkspaceModalVisible).toBe(true);
    expect(result.current.workspacePathInput).toBe("/other/unbound");
    expect(result.current.workspaceSubmitError).toBe(i18n.t("chat.workspace.switchUnbound"));
    expect(messageError).toHaveBeenCalledWith(i18n.t("chat.workspace.switchUnbound"));
  });

  it("preserves the attempted path and shows stale-revision recovery copy after 412", async () => {
    const switchSessionWorkspace = vi
      .fn()
      .mockRejectedValue(structuredError(412, "metadata_version_conflict"));
    const currentChat = makeChat("session-a", "/repo/server-confirmed");
    const { result } = renderHook(() =>
      useInputContainerFileReferences({
        content: "",
        setContent: vi.fn(),
        currentSessionId: currentChat.id,
        currentChat,
        switchSessionWorkspace,
        messageApi,
      }),
    );

    act(() => result.current.openWorkspaceModal());
    await act(async () => {
      await result.current.handleWorkspaceModalSubmit("/repo/attempted");
    });

    expect(result.current.isWorkspaceModalVisible).toBe(true);
    expect(result.current.workspacePathInput).toBe("/repo/attempted");
    expect(result.current.workspaceSubmitError).toBe(
      i18n.t("chat.workspace.switchRevisionConflict"),
    );
  });

  it("does not let a completion from the previous session close or rewrite the new modal", async () => {
    const pending = deferred<SessionSummary>();
    const switchSessionWorkspace = vi.fn().mockReturnValue(pending.promise);
    const sessionA = makeChat("session-a", "/repo/a");
    const sessionB = makeChat("session-b", "/repo/b");
    const { result, rerender } = renderHook(
      ({ currentSessionId, currentChat }) =>
        useInputContainerFileReferences({
          content: "",
          setContent: vi.fn(),
          currentSessionId,
          currentChat,
          switchSessionWorkspace,
          messageApi,
        }),
      { initialProps: { currentSessionId: sessionA.id, currentChat: sessionA } },
    );

    act(() => result.current.openWorkspaceModal());
    let firstSubmit: Promise<boolean> | undefined;
    act(() => {
      firstSubmit = result.current.handleWorkspaceModalSubmit("/repo/a-worktree");
    });

    // The pane id can arrive before its ChatItem. The previous record must not
    // seed the new modal, and the matching record should hydrate it once ready.
    rerender({ currentSessionId: sessionB.id, currentChat: sessionA });
    await waitFor(() => expect(result.current.workspacePathInput).toBe(""));
    rerender({ currentSessionId: sessionB.id, currentChat: sessionB });
    await waitFor(() => expect(result.current.workspacePathInput).toBe("/repo/b"));

    await act(async () => {
      pending.resolve(summary("session-a", "/repo/a-worktree"));
      await firstSubmit;
    });

    expect(result.current.isWorkspaceModalVisible).toBe(true);
    expect(result.current.workspacePathInput).toBe("/repo/b");
    expect(result.current.workspaceSubmitError).toBeNull();
    expect(result.current.isSavingWorkspace).toBe(false);
  });

  it("closes only after Bamboo confirms the active session switch", async () => {
    const switchSessionWorkspace = vi
      .fn()
      .mockResolvedValue(summary("session-a", "/repo/zenith-worktree"));
    const currentChat = makeChat("session-a", "/repo/zenith");
    const { result } = renderHook(() =>
      useInputContainerFileReferences({
        content: "",
        setContent: vi.fn(),
        currentSessionId: currentChat.id,
        currentChat,
        switchSessionWorkspace,
        messageApi,
      }),
    );

    act(() => result.current.openWorkspaceModal());
    let confirmed = false;
    await act(async () => {
      confirmed = await result.current.handleWorkspaceModalSubmit("/repo/zenith-worktree");
    });

    expect(confirmed).toBe(true);
    expect(switchSessionWorkspace).toHaveBeenCalledWith("session-a", "/repo/zenith-worktree");
    expect(result.current.isWorkspaceModalVisible).toBe(false);
    expect(result.current.workspacePathInput).toBe("");
  });
});
