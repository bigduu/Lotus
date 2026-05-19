import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function setupProviderSettingsFetch(
  initialConfig: Record<string, unknown>,
  options?: {
    catalog?: Record<string, unknown>;
    bambooConfig?: Record<string, unknown>;
  },
) {
  const postedBodies: Array<Record<string, unknown>> = [];
  let currentConfig = deepClone(initialConfig);
  const catalog =
    options?.catalog ??
    ({
      providers: [],
      models: [],
    } satisfies Record<string, unknown>);
  const bambooConfig = options?.bambooConfig ?? {};

  useProviderStore.setState({ catalog: catalog as any, isCatalogFetching: false });

  (fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
    const method = (init?.method || "GET").toUpperCase();
    const path = url.toString();
    const isLegacyProviderEndpoint =
      path.includes("/bamboo/settings/provider") &&
      !path.includes("/bamboo/settings/provider-instances");

    if (method === "POST" && path.includes("/bamboo/copilot/auth/status")) {
      return jsonResponse({ authenticated: false });
    }

    if (method === "GET" && isLegacyProviderEndpoint) {
      return jsonResponse(currentConfig);
    }

    if (method === "GET" && path.includes("/bamboo/config")) {
      return jsonResponse(bambooConfig);
    }

    if (method === "GET" && path.includes("/bamboo/provider-catalog")) {
      return jsonResponse(catalog);
    }

    if (method === "GET" && path.includes("/bamboo/env-vars")) {
      return jsonResponse({ entries: [] });
    }

    if (method === "POST" && path.includes("/bamboo/config/validate")) {
      return jsonResponse({ valid: true, errors: {} });
    }

    if (method === "POST" && isLegacyProviderEndpoint) {
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      postedBodies.push(body);
      currentConfig = {
        ...currentConfig,
        ...body,
        defaults: (body.defaults as Record<string, unknown> | undefined) ?? currentConfig.defaults,
        providers: {
          ...(currentConfig.providers as Record<string, unknown> | undefined),
          ...(body.providers as Record<string, unknown> | undefined),
        },
        features: {
          ...(currentConfig.features as Record<string, unknown> | undefined),
          ...(body.features as Record<string, unknown> | undefined),
        },
      };
      return jsonResponse({ success: true, provider: currentConfig.provider });
    }

    return jsonResponse({});
  });

  return {
    postedBodies,
    getCurrentConfig: () => currentConfig,
  };
}

async function selectAntdOption(testId: string, optionText: string) {
  const select = await screen.findByTestId(testId);
  const trigger = select.querySelector(".ant-select-selector") ?? select;
  fireEvent.mouseDown(trigger);

  const option = await waitFor(() => {
    const found = Array.from(document.querySelectorAll(".ant-select-item-option-content")).find(
      (node) => node.textContent?.trim() === optionText,
    ) as HTMLElement | undefined;
    expect(found).toBeTruthy();
    return found as HTMLElement;
  });

  fireEvent.click(option);
}

async function selectModelPreferenceOption(field: string, optionText: string) {
  const trigger = await screen.findByTestId(`model-preference-${field}-picker`);
  fireEvent.click(trigger);

  const option = await waitFor(() => {
    const found = Array.from(document.querySelectorAll(".ant-dropdown-menu-title-content")).find(
      (node) => node.textContent?.includes(optionText),
    ) as HTMLElement | undefined;
    expect(found).toBeTruthy();
    return found as HTMLElement;
  });

  fireEvent.click(option);
}

async function waitForModelPreferenceValue(field: string, title: string) {
  await waitFor(() => {
    expect(screen.getByTestId(`model-preference-${field}-picker`)).toHaveAttribute("title", title);
  });
}

async function waitForOpenAIApiKeyValue(value: string) {
  await waitFor(() => {
    const field = screen.getByTestId("api-key-input") as HTMLElement;
    const input =
      field instanceof HTMLInputElement
        ? field
        : (field.querySelector("input") as HTMLInputElement | null);
    expect(input).toBeTruthy();
    expect(input?.value).toBe(value);
  });
}

describe("ProviderSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem("lotus_ui_locale_v1", "en-US");
    const mockCatalog = {
      models: [
        {
          reference: { provider: "openai", model: "gpt-old" },
          display_name: "gpt-old",
          provider_display_name: "OpenAI",
          capabilities: { supports_vision: false },
        },
        {
          reference: { provider: "openai", model: "gpt-new" },
          display_name: "gpt-new",
          provider_display_name: "OpenAI",
          capabilities: { supports_vision: false },
        },
        {
          reference: { provider: "openai", model: "gpt-4o" },
          display_name: "gpt-4o",
          provider_display_name: "OpenAI",
          capabilities: { supports_vision: true },
        },
        {
          reference: { provider: "openai", model: "gpt-4o-mini" },
          display_name: "gpt-4o-mini",
          provider_display_name: "OpenAI",
          capabilities: { supports_vision: false },
        },
        {
          reference: { provider: "openai", model: "gpt-4.1-mini" },
          display_name: "gpt-4.1-mini",
          provider_display_name: "OpenAI",
          capabilities: { supports_vision: false },
        },
        {
          reference: { provider: "openai", model: "gpt-4.1" },
          display_name: "gpt-4.1",
          provider_display_name: "OpenAI",
          capabilities: { supports_vision: true },
        },
        {
          reference: { provider: "anthropic", model: "claude-3-5-sonnet" },
          display_name: "claude-3-5-sonnet",
          provider_display_name: "Anthropic",
          capabilities: { supports_vision: false },
        },
        {
          reference: { provider: "gemini", model: "gemini-2.5-pro" },
          display_name: "gemini-2.5-pro",
          provider_display_name: "Gemini",
          capabilities: { supports_vision: true },
        },
        {
          reference: { provider: "copilot", model: "gpt-4o" },
          display_name: "gpt-4o",
          provider_display_name: "GitHub Copilot",
          capabilities: { supports_vision: true },
        },
        {
          reference: { provider: "bodhi", model: "llama3.2" },
          display_name: "llama3.2",
          provider_display_name: "Bodhi",
          capabilities: { supports_vision: false },
        },
      ],
    };
    useProviderStore.setState({
      currentProvider: "copilot",
      providerConfig: {
        provider: "copilot",
        defaults: undefined,
        providers: {},
      },
      providerInstances: [],
      defaultProviderInstanceId: null,
      isInstancesLoaded: false,
      selectedModelRef: null,
      catalog: mockCatalog as any,
      isCatalogFetching: false,
      isLoading: false,
      error: null,
      loadCatalog: vi.fn(async () => {}) as any,
      fetchCatalogModels: vi.fn(async () => {}) as any,
    });
    useAppStore.setState({
      currentSessionId: null,
      chats: [],
    } as any);
  });

  it("includes defaults in save payload so model preferences persist", async () => {
    const postedBodies: any[] = [];
    let providerGetCount = 0;
    (fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = url.toString();
      const isLegacyProviderEndpoint =
        path.includes("/bamboo/settings/provider") &&
        !path.includes("/bamboo/settings/provider-instances");

      if (method === "POST" && path.includes("/bamboo/copilot/auth/status")) {
        return jsonResponse({ authenticated: false });
      }

      if (method === "GET" && isLegacyProviderEndpoint) {
        providerGetCount += 1;
        return jsonResponse({
          provider: "openai",
          defaults: {
            chat: { provider: "openai", model: "gpt-4o" },
            fast: { provider: "openai", model: "gpt-4o-mini" },
            task_summary: { provider: "anthropic", model: "claude-3-7-sonnet" },
            memory_background: { provider: "openai", model: "gpt-4.1-mini" },
            sub_agent: { provider: "openai", model: "gpt-4.1-mini" },
            vision: { provider: "openai", model: "gpt-4.1" },
          },
          providers: { openai: { api_key: "sk-masked" } },
          features: { provider_model_ref: false },
        });
      }

      if (method === "POST" && path.includes("bamboo/config/validate")) {
        return jsonResponse({ valid: true, errors: {} });
      }

      if (method === "POST" && isLegacyProviderEndpoint) {
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
    await screen.findByTestId("save-api-settings");
    await waitForModelPreferenceValue("chat", "openai/gpt-4o");
    await waitFor(() => {
      // loadConfig completes when the GET /bamboo/settings/provider fetch has
      // been called at least once. Waiting for the real legacy endpoint avoids
      // falsely matching /bamboo/settings/provider-instances.
      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/settings/provider") &&
            !call[0].includes("/bamboo/settings/provider-instances") &&
            ((call[1]?.method || "GET") as string).toUpperCase() === "GET",
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId("save-api-settings")).not.toBeDisabled();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-api-settings"));
    });

    await waitFor(
      () => {
        expect(postedBodies.length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
    await waitFor(
      () => {
        expect(providerGetCount).toBeGreaterThanOrEqual(2);
      },
      { timeout: 5000 },
    );

    expect(postedBodies[0]?.defaults?.chat).toEqual({ provider: "openai", model: "gpt-4o" });
    expect(postedBodies[0]?.defaults?.fast).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
    });
    expect(postedBodies[0]?.defaults?.task_summary).toEqual({
      provider: "anthropic",
      model: "claude-3-7-sonnet",
    });
    expect(postedBodies[0]?.defaults?.memory_background).toEqual({
      provider: "openai",
      model: "gpt-4.1-mini",
    });
    expect(postedBodies[0]?.defaults?.sub_agent).toEqual({
      provider: "openai",
      model: "gpt-4.1-mini",
    });
    expect(postedBodies[0]?.defaults?.vision).toEqual({
      provider: "openai",
      model: "gpt-4.1",
    });
    expect(postedBodies[0]?.features?.provider_model_ref).toBe(true);
  }, 15000);

  it("backfills legacy memory.background_model into defaults.memory_background on save", async () => {
    const { postedBodies } = setupProviderSettingsFetch(
      {
        provider: "openai",
        defaults: {
          chat: { provider: "openai", model: "gpt-4o" },
          fast: { provider: "openai", model: "gpt-4o-mini" },
        },
        providers: { openai: { api_key: "sk-masked" } },
      },
      {
        bambooConfig: {
          memory: {
            background_model: "legacy-memory-fast",
          },
        },
      },
    );

    render(<ProviderSettings />);

    await screen.findByTestId("save-api-settings");
    await waitForModelPreferenceValue("chat", "openai/gpt-4o");
    await waitForOpenAIApiKeyValue("sk-masked");
    await waitFor(() => {
      expect(screen.getByTestId("save-api-settings")).not.toBeDisabled();
    });

    const formElement = screen.getByTestId("save-api-settings").closest("form");
    expect(formElement).toBeTruthy();
    await act(async () => {
      fireEvent.submit(formElement as HTMLFormElement);
    });

    await waitFor(() => {
      expect(postedBodies.length).toBeGreaterThan(0);
    });

    expect(postedBodies[0]?.defaults?.memory_background).toEqual({
      provider: "openai",
      model: "legacy-memory-fast",
    });
    expect(postedBodies[0]?.features?.provider_model_ref).toBe(true);
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
      const isLegacyProviderEndpoint =
        path.includes("/bamboo/settings/provider") &&
        !path.includes("/bamboo/settings/provider-instances");

      if (method === "POST" && path.includes("/bamboo/copilot/auth/status")) {
        return jsonResponse({ authenticated: false });
      }

      if (method === "GET" && path.includes("/bamboo/provider-catalog")) {
        return jsonResponse({ models: useProviderStore.getState().catalog?.models ?? [] });
      }

      if (method === "GET" && path.includes("/bamboo/config")) {
        return jsonResponse({});
      }

      if (method === "GET" && isLegacyProviderEndpoint) {
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

      if (method === "POST" && isLegacyProviderEndpoint) {
        return jsonResponse({ success: true, provider: "openai" });
      }

      return jsonResponse({});
    });

    render(<ProviderSettings />);

    await screen.findByTestId("save-api-settings");
    await waitForModelPreferenceValue("chat", "openai/gpt-old");
    await waitForOpenAIApiKeyValue("sk-masked");
    await waitFor(() => {
      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/settings/provider") &&
            !call[0].includes("/bamboo/settings/provider-instances") &&
            ((call[1]?.method || "GET") as string).toUpperCase() === "GET",
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId("save-api-settings")).not.toBeDisabled();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-api-settings"));
    });

    await waitFor(
      () => {
        expect(useProviderStore.getState().selectedModelRef).toBeNull();
        const currentChat = useAppStore.getState().chats.find((chat) => chat.id === "session-1");
        expect(currentChat?.config.model).toBe("gpt-new");
        expect(currentChat?.config.model_ref).toEqual({ provider: "openai", model: "gpt-new" });
      },
      { timeout: 10000 },
    );
  }, 15000);

  it("runs server-side validate before saving and blocks save when invalid", async () => {
    (fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = url.toString();
      const isLegacyProviderEndpoint =
        path.includes("/bamboo/settings/provider") &&
        !path.includes("/bamboo/settings/provider-instances");

      if (method === "POST" && path.includes("/bamboo/copilot/auth/status")) {
        return jsonResponse({ authenticated: false });
      }

      if (method === "GET" && path.includes("/bamboo/provider-catalog")) {
        return jsonResponse({ models: useProviderStore.getState().catalog?.models ?? [] });
      }

      if (method === "GET" && path.includes("/bamboo/config")) {
        return jsonResponse({});
      }

      if (method === "GET" && isLegacyProviderEndpoint) {
        return jsonResponse({
          provider: "openai",
          defaults: {
            chat: { provider: "openai", model: "gpt-4o" },
          },
          providers: { openai: { api_key: "sk-masked", model: "gpt-4o" } },
        });
      }

      if (method === "POST" && path.includes("bamboo/config/validate")) {
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

      if (method === "POST" && isLegacyProviderEndpoint) {
        throw new Error("saveProviderConfig must not be called when validation fails");
      }

      return jsonResponse({});
    });

    render(<ProviderSettings />);

    await screen.findByTestId("save-api-settings");
    await waitForModelPreferenceValue("chat", "openai/gpt-4o");
    await waitForOpenAIApiKeyValue("sk-masked");
    await waitFor(() => {
      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/settings/provider") &&
            !call[0].includes("/bamboo/settings/provider-instances") &&
            ((call[1]?.method || "GET") as string).toUpperCase() === "GET",
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId("save-api-settings")).not.toBeDisabled();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-api-settings"));
    });

    await waitFor(
      () => {
        expect(
          (fetch as any).mock.calls.some(
            (call: any[]) =>
              call[0].includes("bamboo/config/validate") &&
              ((call[1]?.method || "GET") as string).toUpperCase() === "POST",
          ),
        ).toBe(true);
      },
      { timeout: 10000 },
    );

    expect(
      (fetch as any).mock.calls.some(
        (call: any[]) =>
          call[0].includes("/bamboo/settings/provider") &&
          !call[0].includes("/bamboo/settings/provider-instances") &&
          ((call[1]?.method || "GET") as string).toUpperCase() === "POST",
      ),
    ).toBe(false);

    expect(
      await screen.findByText("OpenAI API key is required", {}, { timeout: 10000 }),
    ).toBeInTheDocument();
  }, 15000);

  it("saves when validation passes (and refreshes provider config during apply)", async () => {
    let providerGetCount = 0;
    (fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = url.toString();
      const isLegacyProviderEndpoint =
        path.includes("/bamboo/settings/provider") &&
        !path.includes("/bamboo/settings/provider-instances");

      if (method === "POST" && path.includes("/bamboo/copilot/auth/status")) {
        return jsonResponse({ authenticated: false });
      }

      if (method === "GET" && path.includes("/bamboo/provider-catalog")) {
        return jsonResponse({ models: useProviderStore.getState().catalog?.models ?? [] });
      }

      if (method === "GET" && path.includes("/bamboo/config")) {
        return jsonResponse({});
      }

      if (method === "GET" && isLegacyProviderEndpoint) {
        providerGetCount += 1;
        return jsonResponse({
          provider: "openai",
          defaults: {
            chat: { provider: "openai", model: "gpt-4o" },
          },
          providers: { openai: { api_key: "sk-masked", model: "gpt-4o" } },
        });
      }

      if (method === "POST" && path.includes("bamboo/config/validate")) {
        return jsonResponse({ valid: true, errors: {} });
      }

      if (method === "POST" && isLegacyProviderEndpoint) {
        return jsonResponse({ success: true, provider: "openai" });
      }

      return jsonResponse({});
    });

    render(<ProviderSettings />);

    await screen.findByTestId("save-api-settings");
    await waitForModelPreferenceValue("chat", "openai/gpt-4o");
    await waitForOpenAIApiKeyValue("sk-masked");
    await waitFor(() => {
      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/settings/provider") &&
            !call[0].includes("/bamboo/settings/provider-instances") &&
            ((call[1]?.method || "GET") as string).toUpperCase() === "GET",
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId("save-api-settings")).not.toBeDisabled();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-api-settings"));
    });

    await waitFor(
      () => {
        expect(
          (fetch as any).mock.calls.some(
            (call: any[]) =>
              call[0].includes("bamboo/config/validate") &&
              ((call[1]?.method || "GET") as string).toUpperCase() === "POST",
          ),
        ).toBe(true);

        expect(
          (fetch as any).mock.calls.some(
            (call: any[]) =>
              call[0].includes("/bamboo/settings/provider") &&
              !call[0].includes("/bamboo/settings/provider-instances") &&
              ((call[1]?.method || "GET") as string).toUpperCase() === "POST",
          ),
        ).toBe(true);
      },
      { timeout: 10000 },
    );

    // One GET during initial loadConfig + one GET during apply (provider store refresh).
    await waitFor(
      () => {
        expect(providerGetCount).toBeGreaterThanOrEqual(2);
      },
      { timeout: 10000 },
    );
  }, 15000);

  it("blocks save when defaults.chat is missing (client-side required)", async () => {
    (fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = url.toString();

      if (method === "POST" && path.includes("/bamboo/copilot/auth/status")) {
        return jsonResponse({ authenticated: false });
      }

      if (method === "GET" && path.includes("/bamboo/provider-catalog")) {
        return jsonResponse({ models: useProviderStore.getState().catalog?.models ?? [] });
      }

      if (method === "GET" && path.includes("/bamboo/config")) {
        return jsonResponse({});
      }

      const isLegacyProviderEndpoint =
        path.includes("/bamboo/settings/provider") &&
        !path.includes("/bamboo/settings/provider-instances");

      // No defaults.chat → should be blocked by client-side validation
      if (method === "GET" && isLegacyProviderEndpoint) {
        return jsonResponse({
          provider: "openai",
          providers: { openai: { api_key: "sk-masked" } },
        });
      }

      if (method === "POST" && path.includes("/bamboo/config/validate")) {
        throw new Error("validate must not be called when defaults.chat is missing");
      }

      if (method === "POST" && isLegacyProviderEndpoint) {
        throw new Error("saveProviderConfig must not be called when defaults.chat is missing");
      }

      return jsonResponse({});
    });

    render(<ProviderSettings />);

    await screen.findByTestId("save-api-settings");
    await waitFor(() => {
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
      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/settings/provider") &&
            ((call[1]?.method || "GET") as string).toUpperCase() === "POST",
        ),
      ).toBe(false);
    });
  }, 15000);

  afterEach(async () => {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("updates the active provider reasoning effort for the selected provider", async () => {
    const { postedBodies } = setupProviderSettingsFetch({
      provider: "openai",
      defaults: {
        chat: { provider: "openai", model: "gpt-4o" },
      },
      providers: {
        openai: { api_key: "sk-openai", reasoning_effort: "low" },
        anthropic: { api_key: "sk-anthropic", reasoning_effort: "medium" },
      },
    });

    render(<ProviderSettings />);

    await screen.findByTestId("provider-select");
    await selectAntdOption("provider-select", "Anthropic");

    await waitFor(() => {
      expect(screen.getByTestId("active-provider-reasoning-effort").textContent).toContain(
        "Medium",
      );
    });

    await selectAntdOption("active-provider-reasoning-effort", "Max");

    await waitFor(() => {
      expect(postedBodies.length).toBeGreaterThan(0);
      const latestBody = postedBodies.at(-1) as any;
      expect(latestBody.provider).toBe("anthropic");
      expect(latestBody.providers?.anthropic?.reasoning_effort).toBe("max");
      expect(latestBody.providers?.openai?.reasoning_effort).toBe("low");
    });
  }, 15000);

  it("switches the model preference reasoning effort target when default chat model provider changes", async () => {
    const { postedBodies } = setupProviderSettingsFetch(
      {
        provider: "openai",
        defaults: {
          chat: { provider: "openai", model: "gpt-4o" },
          fast: { provider: "openai", model: "gpt-4o-mini" },
          sub_agent: { provider: "openai", model: "gpt-4.1-mini" },
          vision: { provider: "openai", model: "gpt-4.1" },
        },
        providers: {
          openai: { api_key: "sk-openai", reasoning_effort: "low" },
          anthropic: { api_key: "sk-anthropic", reasoning_effort: "medium" },
        },
      },
      {
        catalog: {
          providers: [],
          models: [
            {
              reference: { provider: "openai", model: "gpt-4o" },
              display_name: "OpenAI Default Model",
              provider_display_name: "OpenAI",
              capabilities: { supports_vision: false },
            },
            {
              reference: { provider: "openai", model: "gpt-4o-mini" },
              display_name: "OpenAI Fast Model",
              provider_display_name: "OpenAI",
              capabilities: { supports_vision: false },
            },
            {
              reference: { provider: "openai", model: "gpt-4.1-mini" },
              display_name: "OpenAI Sub Agent Model",
              provider_display_name: "OpenAI",
              capabilities: { supports_vision: false },
            },
            {
              reference: { provider: "openai", model: "gpt-4.1" },
              display_name: "OpenAI Vision Model",
              provider_display_name: "OpenAI",
              capabilities: { supports_vision: true },
            },
            {
              reference: { provider: "anthropic", model: "claude-3-7-sonnet" },
              display_name: "Anthropic Switch Model",
              provider_display_name: "Anthropic",
              capabilities: { supports_vision: false },
            },
            {
              reference: { provider: "anthropic", model: "claude-3-5-haiku" },
              display_name: "Anthropic Fast Model",
              provider_display_name: "Anthropic",
              capabilities: { supports_vision: false },
            },
            {
              reference: { provider: "anthropic", model: "claude-3-5-sonnet" },
              display_name: "Anthropic Sub Session Model",
              provider_display_name: "Anthropic",
              capabilities: { supports_vision: false },
            },
            {
              reference: { provider: "anthropic", model: "claude-3-7-sonnet-vision" },
              display_name: "Anthropic Vision Model",
              provider_display_name: "Anthropic",
              capabilities: { supports_vision: true },
            },
          ],
        },
      },
    );

    render(<ProviderSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("model-preference-chat-reasoning-effort").textContent).toContain(
        "Low",
      );
    });

    await selectModelPreferenceOption("chat", "Anthropic Switch Model");

    await waitFor(() => {
      expect(screen.getByTestId("model-preference-chat-reasoning-effort").textContent).toContain(
        "Medium",
      );
    });

    await selectAntdOption("model-preference-chat-reasoning-effort", "High");

    await waitFor(() => {
      expect(postedBodies.length).toBeGreaterThan(0);
      const latestBody = postedBodies.at(-1) as any;
      expect(latestBody.defaults?.chat).toEqual({
        provider: "anthropic",
        model: "claude-3-7-sonnet",
      });
      expect(latestBody.providers?.anthropic?.reasoning_effort).toBe("high");
      expect(latestBody.providers?.openai?.reasoning_effort).toBe("low");
    });
  }, 15000);

  it.each([
    {
      field: "fast",
      currentTitle: "openai/gpt-4o-mini",
      newOptionText: "Anthropic Fast Model",
      expectedModel: { provider: "anthropic", model: "claude-3-5-haiku" },
    },
    {
      field: "task_summary",
      currentTitle: "openai/gpt-4.1-mini",
      newOptionText: "Anthropic Task Summary Model",
      expectedModel: { provider: "anthropic", model: "claude-3-7-sonnet" },
    },
    {
      field: "memory_background",
      currentTitle: "openai/gpt-4o-mini",
      newOptionText: "Anthropic Fast Model",
      expectedModel: { provider: "anthropic", model: "claude-3-5-haiku" },
    },
    {
      field: "sub_agent",
      currentTitle: "openai/gpt-4.1-mini",
      newOptionText: "Anthropic Sub Agent Model",
      expectedModel: { provider: "anthropic", model: "claude-3-5-sonnet" },
    },
    {
      field: "vision",
      currentTitle: "openai/gpt-4.1",
      newOptionText: "Anthropic Vision Model",
      expectedModel: { provider: "anthropic", model: "claude-3-7-sonnet-vision" },
    },
  ])(
    "switches the $field model preference reasoning effort target when provider changes",
    async ({ field, currentTitle: _currentTitle, newOptionText, expectedModel }) => {
      const { postedBodies } = setupProviderSettingsFetch(
        {
          provider: "openai",
          defaults: {
            chat: { provider: "openai", model: "gpt-4o" },
            fast: { provider: "openai", model: "gpt-4o-mini" },
            task_summary: { provider: "openai", model: "gpt-4.1-mini" },
            memory_background: { provider: "openai", model: "gpt-4o-mini" },
            sub_agent: { provider: "openai", model: "gpt-4.1-mini" },
            vision: { provider: "openai", model: "gpt-4.1" },
          },
          providers: {
            openai: { api_key: "sk-openai", reasoning_effort: "low" },
            anthropic: { api_key: "sk-anthropic", reasoning_effort: "medium" },
          },
        },
        {
          catalog: {
            providers: [],
            models: [
              {
                reference: { provider: "openai", model: "gpt-4o" },
                display_name: "OpenAI Default Model",
                provider_display_name: "OpenAI",
                capabilities: { supports_vision: false },
              },
              {
                reference: { provider: "openai", model: "gpt-4o-mini" },
                display_name: "OpenAI Fast Model",
                provider_display_name: "OpenAI",
                capabilities: { supports_vision: false },
              },
              {
                reference: { provider: "openai", model: "gpt-4.1-mini" },
                display_name: "OpenAI Sub Session Model",
                provider_display_name: "OpenAI",
                capabilities: { supports_vision: false },
              },
              {
                reference: { provider: "openai", model: "gpt-4.1" },
                display_name: "OpenAI Vision Model",
                provider_display_name: "OpenAI",
                capabilities: { supports_vision: true },
              },
              {
                reference: { provider: "anthropic", model: "claude-3-7-sonnet" },
                display_name: "Anthropic Task Summary Model",
                provider_display_name: "Anthropic",
                capabilities: { supports_vision: false },
              },
              {
                reference: { provider: "anthropic", model: "claude-3-5-haiku" },
                display_name: "Anthropic Fast Model",
                provider_display_name: "Anthropic",
                capabilities: { supports_vision: false },
              },
              {
                reference: { provider: "anthropic", model: "claude-3-5-sonnet" },
                display_name: "Anthropic Sub Agent Model",
                provider_display_name: "Anthropic",
                capabilities: { supports_vision: false },
              },
              {
                reference: { provider: "anthropic", model: "claude-3-7-sonnet-vision" },
                display_name: "Anthropic Vision Model",
                provider_display_name: "Anthropic",
                capabilities: { supports_vision: true },
              },
            ],
          },
        },
      );

      render(<ProviderSettings />);

      const reasoningTestId = `model-preference-${field}-reasoning-effort`;

      await waitFor(() => {
        expect(screen.getByTestId(reasoningTestId).textContent).toContain("Low");
      });

      await selectModelPreferenceOption(field, newOptionText);

      await waitFor(() => {
        expect(screen.getByTestId(reasoningTestId).textContent).toContain("Medium");
      });

      await selectAntdOption(reasoningTestId, "Very high");

      await waitFor(() => {
        expect(postedBodies.length).toBeGreaterThan(0);
        const latestBody = postedBodies.at(-1) as any;
        expect(latestBody.defaults?.[field]).toEqual(expectedModel);
        expect(latestBody.providers?.anthropic?.reasoning_effort).toBe("xhigh");
        expect(latestBody.providers?.openai?.reasoning_effort).toBe("low");
      });
    },
    15000,
  );
});
