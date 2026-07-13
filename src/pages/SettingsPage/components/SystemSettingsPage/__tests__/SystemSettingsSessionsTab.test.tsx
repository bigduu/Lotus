import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SystemSettingsSessionsTab from "../SystemSettingsSessionsTab";

// The dev-reset card should only render in dev builds (see #157 — the backend
// gates `POST /api/v1/dev/reset` dev-only, so shipping this button
// unconditionally 404s in production). These tests drive `import.meta.env.DEV`
// directly rather than mocking the AgentService/appStore internals, since the
// gating itself is a pure render-time check.

const { mockDevResetSessions } = vi.hoisted(() => ({
  mockDevResetSessions: vi.fn(),
}));

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: () => ({
      devResetSessions: mockDevResetSessions,
      clearSession: vi.fn(),
      cleanupSessions: vi.fn(),
    }),
  },
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      chats: [],
      currentSessionId: null,
      refreshChats: vi.fn(),
      loadChats: vi.fn(),
      loadChatHistory: vi.fn(),
    }),
}));

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  const message = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
  };
  const notification = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };
  const modal = {
    confirm: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  };
  return {
    ...actual,
    message,
    notification,
    App: Object.assign(actual.App, {
      useApp: () => ({ message, notification, modal }),
    }),
  };
});

describe("SystemSettingsSessionsTab — dev reset gating", () => {
  beforeEach(() => {
    mockDevResetSessions.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the Dev Reset Sessions card in dev builds", () => {
    vi.stubEnv("DEV", true);

    render(<SystemSettingsSessionsTab />);

    expect(screen.getByText("Dev Reset Sessions")).toBeInTheDocument();
  });

  it("does not render the Dev Reset Sessions card in production builds", () => {
    vi.stubEnv("DEV", false);

    render(<SystemSettingsSessionsTab />);

    expect(screen.queryByText("Dev Reset Sessions")).not.toBeInTheDocument();
    // Sibling, always-on content should still be present — proves we only
    // gated the dev-only card, not the whole tab.
    expect(screen.getByText("Delete All")).toBeInTheDocument();
  });
});
