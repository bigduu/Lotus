import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderSettings } from "./index";
import { useProviderStore } from "../../../ChatPage/store/slices/providerSlice";
import { useAppStore } from "../../../ChatPage/store";

// Mock fetch globally for HTTP API calls.
global.fetch = vi.fn();

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

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.ok === false ? "Bad Request" : "OK",
    headers: { get: () => "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("ProviderSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes defaults in save payload so model preferences persist", async () => {
    const postedBodies: any[] = [];
    (fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = url.toString();

      if (method === "POST" && path.includes("/bamboo/copilot/auth/status")) {
        return jsonResponse({ authenticated: false });
      }

      if (method === "GET" && path.includes("/bamboo/settings/provider")) {
        return jsonResponse({
          provider: "openai",
          defaults: {
            chat: { provider: "openai", model: "gpt-4o" },
            fast: { provider: "openai", model: "gpt-4o-mini" },
            sub_session: { provider: "openai", model: "gpt-4.1-mini" },
            vision: { provider: "openai", model: "gpt-4.1" },
          },
          providers: { openai: { api_key: "sk-masked" } },
        });
      }

      if (method === "POST" && path.includes("/bamboo/config/validate")) {
        return jsonResponse({ valid: true, errors: {} });
      }

      if (method === "POST" && path.includes("/bamboo/settings/provider")) {
        postedBodies.push(JSON.parse(String(init?.body || "{}")));
        return jsonResponse({ success: true, provider: "openai" });
      }

      return jsonResponse({});
    });

    render(<ProviderSettings />);

    // Wait for the config to load and form to populate before clicking save.
    // The save button is always rendered (not gated by configLoaded), but the
    // form values are set asynchronously by loadConfig.  On CI the async
    // effects can be slow enough that clicking immediately races with
    // loadConfig, causing the save to fail with "Please select a model".
    const saveButton = await screen.findByTestId("save-api-settings");
    await waitFor(() => {
      // loadConfig completes when the GET /bamboo/settings/provider fetch has
      // been called at least once.  Waiting for this ensures the form values
      // (especially defaults.chat) are populated before we click save.
      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/settings/provider") &&
            ((call[1]?.method || "GET") as string).toUpperCase() === "GET",
        ),
      ).toBe(true);
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(postedBodies.length).toBeGreaterThan(0);
    });

    expect(postedBodies[0]?.defaults?.chat).toEqual({ provider: "openai", model: "gpt-4o" });
    expect(postedBodies[0]?.defaults?.fast).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
    });
    expect(postedBodies[0]?.defaults?.sub_session).toEqual({
      provider: "openai",
      model: "gpt-4.1-mini",
    });
    expect(postedBodies[0]?.defaults?.vision).toEqual({
      provider: "openai",
      model: "gpt-4.1",
    });
  }, 15000);

  it("clears selectedModelRef and syncs current session when defaults change", async () => {
    let providerGetCount = 0;

    useProviderStore.setState({
      currentProvider: "openai",
      selectedModelRef: { provider: "openai", model: "gpt-old" },
      providerConfig: {
        provider: "openai",
        defaults: {
          chat: { provider: "openai", model: "gpt-old" },
        },
        providers: {},
      },
    });

    useAppStore.setState({
      currentSessionId: "session-1",
      chats: [
        {
          id: "session-1",
          title: "Test Session",
          createdAt: Date.now(),
          messages: [],
          config: {
            systemPromptId: "default",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
            model: "gpt-old",
            model_ref: { provider: "openai", model: "gpt-old" },
          },
          currentInteraction: null,
        },
      ],
    } as any);

    (fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = url.toString();

      if (method === "POST" && path.includes("/bamboo/copilot/auth/status")) {
        return jsonResponse({ authenticated: false });
      }

      if (method === "GET" && path.includes("/bamboo/settings/provider")) {
        providerGetCount += 1;
        return jsonResponse({
          provider: "openai",
          defaults:
            providerGetCount === 1
              ? {
                  chat: { provider: "openai", model: "gpt-old" },
                }
              : {
                  chat: { provider: "openai", model: "gpt-new" },
                },
          providers: { openai: { api_key: "sk-masked" } },
        });
      }

      if (method === "POST" && path.includes("/bamboo/config/validate")) {
        return jsonResponse({ valid: true, errors: {} });
      }

      if (method === "POST" && path.includes("/bamboo/settings/provider")) {
        return jsonResponse({ success: true, provider: "openai" });
      }

      return jsonResponse({});
    });

    render(<ProviderSettings />);

    const saveButton = await screen.findByTestId("save-api-settings");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(useProviderStore.getState().selectedModelRef).toBeNull();
      const currentChat = useAppStore.getState().chats.find((chat) => chat.id === "session-1");
      expect(currentChat?.config.model).toBe("gpt-new");
      expect(currentChat?.config.model_ref).toEqual({ provider: "openai", model: "gpt-new" });
    });
  });
  it("runs server-side validate before saving and blocks save when invalid", async () => {
    (fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = url.toString();

      if (method === "POST" && path.includes("/bamboo/copilot/auth/status")) {
        return jsonResponse({ authenticated: false });
      }

      if (method === "GET" && path.includes("/bamboo/settings/provider")) {
        return jsonResponse({
          provider: "openai",
          defaults: {
            chat: { provider: "openai", model: "gpt-4o" },
          },
          providers: { openai: { api_key: "sk-masked", model: "gpt-4o" } },
        });
      }

      if (method === "POST" && path.includes("/bamboo/config/validate")) {
        return jsonResponse({
          valid: false,
          errors: {
            provider: [
              {
                path: "providers.openai.api_key",
                message: "OpenAI API key is required",
              },
            ],
          },
        });
      }

      if (method === "POST" && path.includes("/bamboo/settings/provider")) {
        throw new Error("saveProviderConfig must not be called when validation fails");
      }

      return jsonResponse({});
    });

    render(<ProviderSettings />);

    const saveButton = await screen.findByTestId("save-api-settings");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/config/validate") &&
            ((call[1]?.method || "GET") as string).toUpperCase() === "POST",
        ),
      ).toBe(true);
    });

    expect(
      (fetch as any).mock.calls.some(
        (call: any[]) =>
          call[0].includes("/bamboo/settings/provider") &&
          ((call[1]?.method || "GET") as string).toUpperCase() === "POST",
      ),
    ).toBe(false);

    expect(await screen.findByText("OpenAI API key is required")).toBeInTheDocument();
  }, 15000);

  it("saves when validation passes (and refreshes provider config during apply)", async () => {
    let providerGetCount = 0;
    (fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = url.toString();

      if (method === "POST" && path.includes("/bamboo/copilot/auth/status")) {
        return jsonResponse({ authenticated: false });
      }

      if (method === "GET" && path.includes("/bamboo/settings/provider")) {
        providerGetCount += 1;
        return jsonResponse({
          provider: "openai",
          defaults: {
            chat: { provider: "openai", model: "gpt-4o" },
          },
          providers: { openai: { api_key: "sk-masked", model: "gpt-4o" } },
        });
      }

      if (method === "POST" && path.includes("/bamboo/config/validate")) {
        return jsonResponse({ valid: true, errors: {} });
      }

      if (method === "POST" && path.includes("/bamboo/settings/provider")) {
        return jsonResponse({ success: true, provider: "openai" });
      }

      return jsonResponse({});
    });

    render(<ProviderSettings />);

    const saveButton = await screen.findByTestId("save-api-settings");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/config/validate") &&
            ((call[1]?.method || "GET") as string).toUpperCase() === "POST",
        ),
      ).toBe(true);

      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/settings/provider") &&
            ((call[1]?.method || "GET") as string).toUpperCase() === "POST",
        ),
      ).toBe(true);
    });

    // One GET during initial loadConfig + one GET during apply (provider store refresh).
    await waitFor(() => {
      expect(providerGetCount).toBeGreaterThanOrEqual(2);
    });
  });

  it("blocks save when defaults.chat is missing (client-side required)", async () => {
    (fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = url.toString();

      if (method === "POST" && path.includes("/bamboo/copilot/auth/status")) {
        return jsonResponse({ authenticated: false });
      }

      // No defaults.chat → should be blocked by client-side validation
      if (method === "GET" && path.includes("/bamboo/settings/provider")) {
        return jsonResponse({
          provider: "openai",
          providers: { openai: { api_key: "sk-masked" } },
        });
      }

      if (method === "POST" && path.includes("/bamboo/config/validate")) {
        throw new Error("validate must not be called when defaults.chat is missing");
      }

      if (method === "POST" && path.includes("/bamboo/settings/provider")) {
        throw new Error("saveProviderConfig must not be called when defaults.chat is missing");
      }

      return jsonResponse({});
    });

    render(<ProviderSettings />);

    const saveButton = await screen.findByTestId("save-api-settings");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/settings/provider") &&
            ((call[1]?.method || "GET") as string).toUpperCase() === "POST",
        ),
      ).toBe(false);
    });
  }, 15000);
});
