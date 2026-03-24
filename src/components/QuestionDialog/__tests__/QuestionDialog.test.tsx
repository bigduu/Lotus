import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QuestionDialog, formatPendingQuestionText } from "../QuestionDialog";
import { useAppStore } from "../../../pages/ChatPage/store";
import { useProviderStore } from "../../../pages/ChatPage/store/slices/providerSlice";

// Mock dependencies
vi.mock("../../../pages/ChatPage/store", () => ({
  useAppStore: vi.fn(),
}));

vi.mock("../../../services/api", () => ({
  agentApiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe("QuestionDialog", () => {
  const mockSetSessionProcessing = vi.fn();
  const mockIsSessionProcessing = vi.fn();
  const mockSetPendingQuestionRespond = vi.fn();
  const mockClearPendingQuestionRespondForSession = vi.fn();
  const defaultProps = {
    sessionId: "test-session-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSessionProcessing.mockReturnValue(false);
    // Ensure provider store has a default model available (QuestionDialog uses it for resume).
    useProviderStore.setState({
      currentProvider: "openai",
      providerConfig: {
        provider: "openai",
        providers: {
          openai: { model: "gpt-5-mini" } as any,
        },
      } as any,
      isLoading: false,
      error: null,
    } as any);

    (useAppStore as any).mockImplementation((selector: (state: any) => any) => {
      if (typeof selector === "function") {
        return selector({
          setSessionProcessing: mockSetSessionProcessing,
          isSessionProcessing: mockIsSessionProcessing,
          setPendingQuestionRespond: mockSetPendingQuestionRespond,
          clearPendingQuestionRespondForSession:
            mockClearPendingQuestionRespondForSession,
          chats: [],
          inputStates: {},
          // Keep a "selectedModel" in the store to ensure the dialog does NOT use it
          // (it may auto-default to models[0] elsewhere).
          selectedModel: "gpt-5-ultra-expensive",
        });
      }
      return {
        setSessionProcessing: mockSetSessionProcessing,
        isSessionProcessing: mockIsSessionProcessing,
        setPendingQuestionRespond: mockSetPendingQuestionRespond,
        clearPendingQuestionRespondForSession:
          mockClearPendingQuestionRespondForSession,
        chats: [],
        inputStates: {},
        selectedModel: "gpt-5-ultra-expensive",
      };
    });
  });

  afterEach(() => {
    // Ensure fake timers don't leak into other tests on failure.
    vi.useRealTimers();
  });

  it("should fetch pending question on mount", async () => {
    const { agentApiClient } = await import("../../../services/api");
    (agentApiClient.get as any).mockResolvedValue({
      has_pending_question: true,
      question: "Test question?",
      options: ["Option A", "Option B"],
      allow_custom: false,
    });

    render(<QuestionDialog {...defaultProps} />);

    await waitFor(() => {
      expect(agentApiClient.get).toHaveBeenCalledWith(
        "respond/test-session-1/pending",
      );
    });
  });

  it("formats inline numbered question text into multiline", () => {
    const formatted = formatPendingQuestionText(
      "To proceed, tell me: 1) Cloud or Server? 2) Read or write? 3) Use REST or browser?",
    );
    expect(formatted).toContain("\n1) Cloud or Server?");
    expect(formatted).toContain("\n2) Read or write?");
    expect(formatted).toContain("\n3) Use REST or browser?");
  });

  it("converts escaped newline sequences into real newlines", () => {
    const formatted = formatPendingQuestionText(
      "Line 1\\nLine 2\\r\\nLine 3",
    );
    expect(formatted).toBe("Line 1\nLine 2\nLine 3");
  });

  it("should display question when pending question exists", async () => {
    const { agentApiClient } = await import("../../../services/api");
    (agentApiClient.get as any).mockResolvedValue({
      has_pending_question: true,
      question: "Choose an option:",
      options: ["A", "B"],
      allow_custom: false,
    });

    await act(async () => {
      render(<QuestionDialog {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText("Choose an option:")).toBeInTheDocument();
    });
  });

  it("should not render when no pending question", async () => {
    const { agentApiClient } = await import("../../../services/api");
    (agentApiClient.get as any).mockResolvedValue({
      has_pending_question: false,
    });

    const { container } = render(<QuestionDialog {...defaultProps} />);

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("should submit response with model and mark session processing when auto-resume starts", async () => {
    const { agentApiClient } = await import("../../../services/api");
    (agentApiClient.get as any).mockResolvedValue({
      has_pending_question: true,
      question: "Test?",
      options: ["A", "B"],
      allow_custom: false,
      tool_call_id: "tool-1",
    });

    (agentApiClient.post as any).mockResolvedValueOnce({
      auto_resume_status: "started",
    });

    await act(async () => {
      render(<QuestionDialog {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText("Test?")).toBeInTheDocument();
    });

    // Select option
    const optionA = screen.getByText("A");
    fireEvent.click(optionA);

    // Submit
    const submitButton = screen.getByText("Confirm");
    await act(async () => {
      fireEvent.click(submitButton);
    });

    await waitFor(() => {
      expect(agentApiClient.post).toHaveBeenCalledWith(
        "respond/test-session-1",
        {
          response: "A",
          model: "gpt-5-mini",
          reasoning_effort: "medium",
        },
      );
      expect(mockSetSessionProcessing).toHaveBeenCalledWith(
        "test-session-1",
        true,
      );
    });
  });

  it("should fall back to active provider model when selectedModel is not set", async () => {
    const { agentApiClient } = await import("../../../services/api");
    (agentApiClient.get as any).mockResolvedValue({
      has_pending_question: true,
      question: "Test?",
      options: ["A", "B"],
      allow_custom: false,
      tool_call_id: "tool-1",
    });

    (agentApiClient.post as any).mockResolvedValueOnce({
      auto_resume_status: "started",
    });

    await act(async () => {
      render(<QuestionDialog {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText("Test?")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("A"));
    await act(async () => {
      fireEvent.click(screen.getByText("Confirm"));
    });

    await waitFor(() => {
      expect(agentApiClient.post).toHaveBeenCalledWith(
        "respond/test-session-1",
        {
          response: "A",
          model: "gpt-5-mini",
          reasoning_effort: "medium",
        },
      );
    });
  });

  it("should re-enable polling after response submission", async () => {
    const { agentApiClient } = await import("../../../services/api");

    // Track how many times GET has been called
    let getCallCount = 0;
    (agentApiClient.get as any).mockImplementation(() => {
      getCallCount++;
      // First 3 calls return first question (gives time for test to interact)
      if (getCallCount <= 3) {
        return Promise.resolve({
          has_pending_question: true,
          question: "Test?",
          options: ["A"],
          allow_custom: false,
          tool_call_id: "tool-1",
        });
      }
      // Subsequent calls return second question
      return Promise.resolve({
        has_pending_question: true,
        question: "Second question?",
        options: ["C"],
        allow_custom: false,
      });
    });

    (agentApiClient.post as any).mockResolvedValueOnce({
      auto_resume_status: "started",
    });

    await act(async () => {
      render(<QuestionDialog {...defaultProps} />);
    });

    // Wait for first question to appear
    await waitFor(
      () => {
        expect(screen.getByText("Test?")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // Submit first response
    const optionA = screen.getByText("A");
    fireEvent.click(optionA);

    const submitButton = screen.getByText("Confirm");
    await act(async () => {
      fireEvent.click(submitButton);
    });

    // Wait for first question to disappear (setPendingQuestion(null) clears it)
    await waitFor(() => {
      expect(screen.queryByText("Test?")).not.toBeInTheDocument();
    });

    // Should detect second question (polling re-enabled)
    await waitFor(
      () => {
        expect(screen.getByText("Second question?")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it("should keep polling and eventually show a question after empty responses", async () => {
    vi.useFakeTimers();

    const { agentApiClient } = await import("../../../services/api");
    let callCount = 0;
    (agentApiClient.get as any).mockImplementation(() => {
      callCount += 1;
      // First few polls: nothing pending
      if (callCount <= 4) {
        return Promise.resolve({ has_pending_question: false });
      }
      return Promise.resolve({
        has_pending_question: true,
        question: "Late question?",
        options: ["A"],
        allow_custom: false,
      });
    });

    await act(async () => {
      render(<QuestionDialog {...defaultProps} />);
    });

    // Advance enough time for multiple 15s polls to happen.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // Flush pending microtasks from async fetches.
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await Promise.resolve();
    });

    expect(screen.getByText("Late question?")).toBeInTheDocument();
  });

  it("should handle auto-resume error status gracefully", async () => {
    const { agentApiClient } = await import("../../../services/api");
    (agentApiClient.get as any).mockResolvedValue({
      has_pending_question: true,
      question: "Test?",
      options: ["A"],
      allow_custom: false,
      tool_call_id: "tool-1",
    });

    (agentApiClient.post as any).mockResolvedValueOnce({
      auto_resume_status: "error",
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      render(<QuestionDialog {...defaultProps} />);
    });

    // Wait for loading to complete and question to appear
    await waitFor(
      () => {
        expect(screen.getByText("Test?")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    const optionA = screen.getByText("A");
    fireEvent.click(optionA);

    const submitButton = screen.getByText("Confirm");
    await act(async () => {
      fireEvent.click(submitButton);
    });

    await waitFor(() => {
      // Should still call /respond
      expect(agentApiClient.post).toHaveBeenCalledWith(
        "respond/test-session-1",
        {
          response: "A",
          model: "gpt-5-mini",
          reasoning_effort: "medium",
        },
      );

      // Should log error
      expect(consoleSpy).toHaveBeenCalledWith(
        "[QuestionDialog] Failed to auto-resume agent execution",
      );
    });

    consoleSpy.mockRestore();
  });

  it("should reset polling state when sessionId changes", async () => {
    const { agentApiClient } = await import("../../../services/api");
    (agentApiClient.get as any).mockResolvedValue({
      has_pending_question: false,
    });

    const { rerender } = render(<QuestionDialog {...defaultProps} />);

    await waitFor(() => {
      expect(agentApiClient.get).toHaveBeenCalledWith(
        "respond/test-session-1/pending",
      );
    });

    // Change session ID
    (agentApiClient.get as any).mockClear();

    rerender(<QuestionDialog sessionId="test-session-2" />);

    await waitFor(() => {
      expect(agentApiClient.get).toHaveBeenCalledWith(
        "respond/test-session-2/pending",
      );
    });
  });

  it("should handle custom input when allow_custom is true", async () => {
    const { agentApiClient } = await import("../../../services/api");
    (agentApiClient.get as any).mockResolvedValue({
      has_pending_question: true,
      question: "Test?",
      options: ["A"],
      allow_custom: true,
      tool_call_id: "tool-1",
    });

    await act(async () => {
      render(<QuestionDialog {...defaultProps} />);
    });

    // Wait for loading to complete and question to appear
    await waitFor(
      () => {
        expect(
          screen.getByText("Other (type below)"),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // Select custom option — this should activate respond mode via the store
    const customOption = screen.getByText(
      "Other (type below)",
    );
    fireEvent.click(customOption);

    // Verify that setPendingQuestionRespond was called with the correct payload
    expect(mockSetPendingQuestionRespond).toHaveBeenCalledWith({
      sessionId: "test-session-1",
      question: "Test?",
    });

    // In custom mode, no submit button is shown (user submits via InputContainer)
    expect(screen.queryByText("Confirm")).not.toBeInTheDocument();

    // A hint should appear guiding the user to the input box below
    expect(
      screen.getByText(
        /Custom answer/,
      ),
    ).toBeInTheDocument();

    // Switching back to a predefined option keeps respond mode active
    // for the current pending question lifecycle.
    const optionA = screen.getByText("A");
    fireEvent.click(optionA);

    expect(mockSetPendingQuestionRespond).not.toHaveBeenCalledWith(null);
  });
});
