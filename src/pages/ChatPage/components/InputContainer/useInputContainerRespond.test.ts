import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@services/api/client";

import { useInputContainerRespond } from "./useInputContainerRespond";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  getPolicy: vi.fn(),
  markRespondStart: vi.fn(),
  markSettleTimeout: vi.fn(),
  applyExecutionStarted: vi.fn(),
  setPendingQuestion: vi.fn(),
  clearPendingQuestion: vi.fn(),
  pendingQuestion: null as any,
}));

vi.mock("@services/api", () => ({
  agentApiClient: { post: mocks.post },
  apiClient: { get: mocks.getPolicy },
}));

vi.mock("@shared/store/appStore", () => {
  const state = {
    executionBySession: {},
    markRespondStart: mocks.markRespondStart,
    markSettleTimeout: mocks.markSettleTimeout,
    applyExecutionStarted: mocks.applyExecutionStarted,
    setPendingQuestion: mocks.setPendingQuestion,
    clearPendingQuestion: mocks.clearPendingQuestion,
  };
  const useAppStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return {
    useAppStore,
    selectPendingQuestion: () => () => mocks.pendingQuestion,
  };
});

const permissionRequest = {
  requestId: "permission-1",
  sessionId: "child/session",
  workspacePath: "/workspace",
  policyRevision: 4,
  allowedDecisions: [{ id: "allow_once" }, { id: "allow_global" }, { id: "deny_once" }],
  suggestedMatchers: [
    { id: "broad", kind: "command_prefix", value: "git" },
    { id: "exact_resource", kind: "exact_resource", value: "git push origin main" },
  ],
};

const pendingQuestion = {
  question: "Approve git push?",
  options: ["allow_once", "allow_global", "deny_once"],
  allowCustom: false,
  toolCallId: "tool-call-1",
  permissionRequest,
  receivedAt: "2026-07-31T00:00:00.000Z",
};

const messageApi = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
};

const renderRespondHook = () =>
  renderHook(() =>
    useInputContainerRespond({
      sessionId: "root-session",
      reasoningEffort: "medium",
      activeModelRef: null,
      isFlagOn: () => false,
      messageApi: messageApi as any,
      setContent: vi.fn(),
      pendingQuestionToolCallId: "tool-call-1",
      permissionRequest,
      t: ((key: string) => key) as any,
    }),
  );

describe("useInputContainerRespond typed permission decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pendingQuestion = pendingQuestion;
    mocks.markRespondStart.mockReturnValue(2);
  });

  it("posts a typed global decision with the selected matcher and confirmation", async () => {
    mocks.post.mockResolvedValue({
      success: true,
      replayed: false,
      resume: { accepted: true },
    });
    const { result } = renderRespondHook();

    await act(async () => {
      await result.current.handleRespondSubmit("allow_global", {
        matcherId: "broad",
        confirmGlobal: true,
      });
    });

    expect(mocks.post).toHaveBeenCalledWith(
      "sessions/child%2Fsession/permission-decisions",
      {
        request_id: "permission-1",
        decision: "allow_global",
        matcher_id: "broad",
        expected_policy_revision: 4,
        confirm_global: true,
      },
      { retryable: true },
    );
    expect(mocks.clearPendingQuestion).toHaveBeenCalledWith("root-session");
    expect(mocks.applyExecutionStarted).toHaveBeenCalledWith("root-session", "", 2);
    expect(mocks.markSettleTimeout).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.handleRespondSubmit("allow_global", {
        matcherId: "broad",
        confirmGlobal: true,
      });
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it.each(["allow_once", "deny_once"] as const)(
    "starts the shared optimistic resume transition for a successful %s decision",
    async (decision) => {
      mocks.post.mockResolvedValue({
        success: true,
        replayed: false,
        resume: { accepted: true },
      });
      const { result } = renderRespondHook();

      await act(async () => {
        await result.current.handleRespondSubmit(decision);
      });

      expect(mocks.markRespondStart).toHaveBeenCalledWith("root-session", "tool-call-1");
      expect(mocks.clearPendingQuestion).toHaveBeenCalledWith("root-session");
      expect(mocks.applyExecutionStarted).toHaveBeenCalledWith("root-session", "", 2);
      expect(mocks.markSettleTimeout).not.toHaveBeenCalled();
    },
  );

  it("keeps the prompt available after a transient submission failure", async () => {
    mocks.post.mockRejectedValue(new Error("network unavailable"));
    const { result } = renderRespondHook();

    await act(async () => {
      await result.current.handleRespondSubmit("allow_once");
    });

    expect(mocks.setPendingQuestion).toHaveBeenCalledWith("root-session", {
      question: pendingQuestion.question,
      options: pendingQuestion.options,
      allowCustom: false,
      toolCallId: "tool-call-1",
      permissionRequest,
    });
    expect(mocks.clearPendingQuestion).not.toHaveBeenCalled();
    expect(mocks.markSettleTimeout).toHaveBeenCalledWith("root-session");
    expect(messageApi.error).toHaveBeenCalledWith("network unavailable");
  });

  it("refreshes the policy revision after a CAS conflict before restoring the prompt", async () => {
    mocks.post.mockRejectedValue(new ApiError("revision conflict", 409, "Conflict"));
    mocks.getPolicy.mockResolvedValue({ revision: 9 });
    const { result } = renderRespondHook();

    await act(async () => {
      await result.current.handleRespondSubmit("allow_global", {
        matcherId: "exact_resource",
        confirmGlobal: true,
      });
    });

    expect(mocks.getPolicy).toHaveBeenCalledWith("/bamboo/permission/policy");
    expect(mocks.setPendingQuestion).toHaveBeenCalledWith(
      "root-session",
      expect.objectContaining({
        permissionRequest: expect.objectContaining({ policyRevision: 9 }),
      }),
    );
    expect(messageApi.error).toHaveBeenCalledWith(
      "components.questionDialog.policyRevisionChanged",
    );
  });

  it("suppresses a second click while the same request is in flight", async () => {
    let resolvePost!: (value: unknown) => void;
    mocks.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    const { result } = renderRespondHook();

    let firstSubmission!: Promise<void>;
    act(() => {
      firstSubmission = result.current.handleRespondSubmit("allow_once");
    });
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.handleRespondSubmit("allow_once");
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePost({ success: true, replayed: false, resume: { accepted: true } });
      await firstSubmission;
    });
  });

  it("rejects a stale confirmation after the FIFO queue advances", async () => {
    mocks.pendingQuestion = {
      ...pendingQuestion,
      permissionRequest: {
        ...permissionRequest,
        requestId: "permission-2",
      },
    };
    const { result } = renderRespondHook();

    await act(async () => {
      await result.current.handleRespondSubmit("allow_global", {
        matcherId: "exact_resource",
        confirmGlobal: true,
      });
    });

    expect(mocks.post).not.toHaveBeenCalled();
    expect(messageApi.warning).toHaveBeenCalledWith("components.questionDialog.requestChanged");
  });
});
