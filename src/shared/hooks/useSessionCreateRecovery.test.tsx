import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatSessionCreateRecoveryError } from "@shared/store/appStore/slices/chatSessionSlice/sessionCreateRecovery";
import { useSessionCreateRecovery } from "./useSessionCreateRecovery";

const { confirm, showDefinitiveError } = vi.hoisted(() => ({
  confirm: vi.fn(),
  showDefinitiveError: vi.fn(),
}));

vi.mock("antd", () => ({
  App: {
    useApp: () => ({
      modal: {
        confirm,
        error: showDefinitiveError,
      },
    }),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

describe("useSessionCreateRecovery", () => {
  beforeEach(() => {
    confirm.mockReset();
    showDefinitiveError.mockReset();
  });

  it("shows an uncertain warning and completes caller side effects once after retry", async () => {
    const retry = vi.fn(async () => "session-recovered");
    const onRecovered = vi.fn();
    const recovery = new ChatSessionCreateRecoveryError(
      "lotus-session-stable",
      "pending",
      retry,
      "Session creation may already have succeeded.",
    );
    const { result } = renderHook(() => useSessionCreateRecovery());

    expect(result.current(recovery, { onRecovered })).toBe(true);

    const dialog = confirm.mock.calls[0]?.[0] as {
      title: string;
      content: string;
      onOk: () => Promise<void>;
    };
    expect(dialog.title).toBe("Session creation is still being confirmed");
    expect(dialog.content).toContain("may already have succeeded");

    await act(async () => {
      await dialog.onOk();
    });

    expect(retry).toHaveBeenCalledTimes(1);
    expect(onRecovered).toHaveBeenCalledOnce();
    expect(onRecovered).toHaveBeenCalledWith("session-recovered");
    expect(showDefinitiveError).not.toHaveBeenCalled();
  });

  it("leaves definitive errors to the caller", () => {
    const { result } = renderHook(() => useSessionCreateRecovery());

    expect(result.current(new Error("definitive failure"))).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});
