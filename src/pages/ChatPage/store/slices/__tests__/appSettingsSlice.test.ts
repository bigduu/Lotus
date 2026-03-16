import { describe, expect, it, vi } from "vitest";

import {
  createSessionSlice,
  type SessionSlice,
} from "../appSettingsSlice";
import { createSliceHarness } from "./sliceHarness";

type SessionHarnessState = SessionSlice & {
  processingChats: Set<string>;
  setSessionProcessing: (sessionId: string, value: boolean) => void;
};

describe("appSettingsSlice", () => {
  it("stores current request controller", () => {
    const harness = createSliceHarness<SessionHarnessState>(
      createSessionSlice as any,
      {
        processingChats: new Set<string>(),
        setSessionProcessing: vi.fn(),
      },
    );

    const controller = new AbortController();
    harness.getState().setCurrentRequestController(controller);
    expect(harness.getState().currentRequestController).toBe(controller);
  });

  it("cancels request and clears processing chats", () => {
    const setSessionProcessing = vi.fn();
    const harness = createSliceHarness<SessionHarnessState>(
      createSessionSlice as any,
      {
        processingChats: new Set(["session-1", "session-2"]),
        setSessionProcessing,
      },
    );
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, "abort");
    harness.getState().setCurrentRequestController(controller);

    harness.getState().cancelCurrentRequest();

    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(setSessionProcessing).toHaveBeenCalledWith("session-1", false);
    expect(setSessionProcessing).toHaveBeenCalledWith("session-2", false);
    expect(harness.getState().currentRequestController).toBeNull();
  });

  it("handles cancel when controller is missing", () => {
    const setSessionProcessing = vi.fn();
    const harness = createSliceHarness<SessionHarnessState>(
      createSessionSlice as any,
      {
        processingChats: new Set<string>(),
        setSessionProcessing,
      },
    );

    harness.getState().cancelCurrentRequest();
    expect(setSessionProcessing).not.toHaveBeenCalled();
    expect(harness.getState().currentRequestController).toBeNull();
  });
});
