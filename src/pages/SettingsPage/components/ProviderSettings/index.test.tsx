import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { message } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderSettings } from "./index";
import {
  buildProviderInstanceSettings,
  insertProviderInstance,
  removeProviderInstance,
} from "./providerSettingsPayload";
import type { ProviderSection } from "@services/config/configSections";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";
import { useAppStore } from "@shared/store/appStore";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { copyText } from "@shared/utils/clipboard";

// Mock fetch globally for HTTP API calls.
global.fetch = vi.fn();

vi.mock("@shared/utils/clipboard", () => ({ copyText: vi.fn() }));

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

function providerSectionFromConfig(config: Record<string, unknown>): ProviderSection {
  const configuredProviders =
    (config.providers as Record<string, Record<string, unknown>> | undefined) ?? {};
  const providers: Record<string, Record<string, unknown>> = {};
  const providerInstances: ProviderSection["provider_instances"] = {};
  const credentialProviders: ProviderSection["credential_status"]["providers"] = {};
  const credentialInstances: ProviderSection["credential_status"]["provider_instances"] = {};

  for (const [provider, rawConfig] of Object.entries(configuredProviders)) {
    const { api_key: apiKey, api_key_encrypted: encryptedKey, ...metadata } = rawConfig;
    providers[provider] = metadata;
    credentialProviders[provider as keyof typeof credentialProviders] = {
      credential_ref: `provider.${provider}.api_key`,
      configured: Boolean(apiKey || encryptedKey),
      source: apiKey || encryptedKey ? "user" : null,
      updated_at: null,
    };
    providerInstances[provider] = {
      provider_type: provider as ProviderSection["available_providers"][number],
      label: provider,
      enabled: true,
      ...metadata,
    };
    credentialInstances[provider] = {
      credential_ref: `provider_instances.${provider}.api_key`,
      configured: Boolean(apiKey || encryptedKey),
      source: apiKey || encryptedKey ? "user" : null,
      updated_at: null,
    };
  }

  const defaultInstanceId = String(
    config.default_provider_instance_id ?? config.provider ?? "openai",
  );

  return {
    provider: String(config.provider ?? "openai"),
    providers: providers as ProviderSection["providers"],
    defaults: (config.defaults as ProviderSection["defaults"] | undefined) ?? null,
    features: (config.features as ProviderSection["features"] | undefined) ?? {},
    provider_instances: providerInstances,
    default_provider_instance_id: providerInstances[defaultInstanceId]
      ? defaultInstanceId
      : (Object.keys(providerInstances)[0] ?? null),
    available_providers: Object.keys(configuredProviders) as ProviderSection["available_providers"],
    credential_status: {
      providers: credentialProviders,
      provider_instances: credentialInstances,
    },
  };
}

function sectionEnvelope<T>(data: T, revision: number) {
  return {
    data,
    revision,
    loaded_at: "2026-07-24T00:00:00Z",
    source_path: "bamboo.yaml",
    source_kind: "file",
    status: "healthy",
    last_error: null,
  };
}

function setupProviderSettingsFetch(
  initialConfig: Record<string, unknown>,
  options?: {
    catalog?: Record<string, unknown>;
    bambooConfig?: Record<string, unknown>;
    rejectProviderLoad?: { status?: number; body: Record<string, unknown> };
    rejectProviderSave?: { status?: number; body: Record<string, unknown> };
  },
) {
  const postedBodies: Array<Record<string, unknown>> = [];
  const credentialChangeBodies: Array<Record<string, unknown>> = [];
  const putRequests: Array<Record<string, unknown>> = [];
  let revision = 1;
  let currentSection = providerSectionFromConfig(deepClone(initialConfig));
  const catalog =
    options?.catalog ??
    (useProviderStore.getState().catalog as unknown as Record<string, unknown> | null) ??
    ({ providers: [], models: [] } satisfies Record<string, unknown>);
  const bambooConfig = options?.bambooConfig ?? {};

  useProviderStore.setState({ catalog: catalog as any, isCatalogFetching: false });

  (fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
    const method = (init?.method || "GET").toUpperCase();
    const path = url.toString();
    const isProviderSectionEndpoint = path.includes("/bamboo/config/provider-settings");

    if (method === "POST" && path.includes("/bamboo/copilot/auth/status")) {
      return jsonResponse({ authenticated: false });
    }

    if (method === "GET" && isProviderSectionEndpoint) {
      if (options?.rejectProviderLoad) {
        return jsonResponse(options.rejectProviderLoad.body, {
          ok: false,
          status: options.rejectProviderLoad.status ?? 503,
        });
      }
      return jsonResponse(sectionEnvelope(currentSection, revision));
    }

    if (method === "GET" && path.includes("/bamboo/config/sections/memory")) {
      return jsonResponse(sectionEnvelope((bambooConfig as any).memory ?? null, 1));
    }

    if (method === "GET" && path.includes("/bamboo/provider-catalog")) {
      return jsonResponse(catalog);
    }

    if (method === "GET" && path.includes("/bamboo/env-vars")) {
      return jsonResponse({ entries: [] });
    }

    if (method === "PUT" && isProviderSectionEndpoint) {
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      putRequests.push(deepClone(body));
      if (options?.rejectProviderSave) {
        return jsonResponse(options.rejectProviderSave.body, {
          ok: false,
          status: options.rejectProviderSave.status ?? 400,
        });
      }
      const data = deepClone(body.data as Record<string, unknown>);
      const credentialChanges =
        (body.credential_changes as Record<string, unknown> | undefined) ?? {};
      postedBodies.push(data);
      credentialChangeBodies.push(deepClone(credentialChanges));
      currentSection = data as unknown as ProviderSection;
      revision += 1;
      return jsonResponse(sectionEnvelope(currentSection, revision));
    }

    return jsonResponse({});
  });

  return {
    postedBodies,
    credentialChangeBodies,
    putRequests,
    getCurrentConfig: () => currentSection,
    publishExternal: (nextSection: ProviderSection) => {
      currentSection = deepClone(nextSection);
      revision += 1;
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          providers: {
            ...state.sections.providers,
            envelope: sectionEnvelope(currentSection, revision),
          },
        },
      }));
    },
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

describe("buildProviderInstanceSettings", () => {
  it("round-trips canonical provider fields without leaking fields across provider types", () => {
    const rawConfig = {
      api_key: "sk-test",
      base_url: "https://provider.example/v1",
      model: "primary-model",
      fast_model: "fast-model",
      vision_model: "vision-model",
      reasoning_effort: "high",
      responses_only_models: ["response-*"],
      request_overrides: { common: { headers: { "x-test": "1" } } },
      explicit_prompt_cache: true,
      thinking_replay_always: true,
      max_tokens: "4096",
      headless_auth: false,
      target_provider: "gemini",
    };

    const openai = buildProviderInstanceSettings("openai", "OpenAI", true, rawConfig);
    expect(openai.credential).toBe("sk-test");
    expect(openai.settings).toMatchObject({
      provider_type: "openai",
      explicit_prompt_cache: true,
      request_overrides: rawConfig.request_overrides,
    });
    expect(openai.settings).not.toHaveProperty("thinking_replay_always");
    expect(openai.settings).not.toHaveProperty("max_tokens");
    expect(openai.settings).not.toHaveProperty("headless_auth");
    expect(openai.settings).not.toHaveProperty("target_provider");

    const anthropic = buildProviderInstanceSettings("anthropic", undefined, true, rawConfig);
    expect(anthropic.settings).toMatchObject({
      provider_type: "anthropic",
      thinking_replay_always: true,
      max_tokens: 4096,
    });
    expect(anthropic.settings).not.toHaveProperty("explicit_prompt_cache");
    expect(anthropic.settings).not.toHaveProperty("headless_auth");
    expect(anthropic.settings).not.toHaveProperty("target_provider");

    const copilot = buildProviderInstanceSettings("copilot", undefined, true, rawConfig);
    expect(copilot.settings).toMatchObject({ provider_type: "copilot", headless_auth: false });
    expect(copilot.settings).not.toHaveProperty("explicit_prompt_cache");
    expect(copilot.settings).not.toHaveProperty("max_tokens");
    expect(copilot.settings).not.toHaveProperty("target_provider");

    const bodhi = buildProviderInstanceSettings("bodhi", undefined, true, rawConfig);
    expect(bodhi.settings).toMatchObject({ provider_type: "bodhi", target_provider: "gemini" });
    expect(bodhi.settings).not.toHaveProperty("explicit_prompt_cache");
    expect(bodhi.settings).not.toHaveProperty("max_tokens");
    expect(bodhi.settings).not.toHaveProperty("headless_auth");
  });

  it("atomically promotes the first instance to default without replacing a valid default", () => {
    const firstSettings = buildProviderInstanceSettings("copilot", undefined, true, {}).settings;
    const emptySection = providerSectionFromConfig({ provider: "anthropic", providers: {} });

    insertProviderInstance(emptySection, "copilot-main", firstSettings);
    expect(emptySection.default_provider_instance_id).toBe("copilot-main");

    const secondSettings = buildProviderInstanceSettings("openai", undefined, true, {}).settings;
    insertProviderInstance(emptySection, "openai-work", secondSettings);
    expect(emptySection.default_provider_instance_id).toBe("copilot-main");
  });

  it("deterministically promotes the next enabled instance when deleting the default", () => {
    const section = providerSectionFromConfig({
      provider: "openai",
      providers: {
        zebra: { provider_type: "openai", enabled: true, model: "gpt-zebra" },
        alpha: { provider_type: "anthropic", enabled: true, model: "claude-alpha" },
        disabled: { provider_type: "gemini", enabled: false },
      },
      default_provider_instance_id: "zebra",
      defaults: {
        chat: { provider: "zebra", model: "gpt-zebra" },
        fast: { provider: "zebra", model: "gpt-fast" },
        task_summary: { provider: "zebra", model: "gpt-summary" },
        vision: { provider: "zebra", model: "gpt-vision" },
        memory_background: { provider: "zebra", model: "gpt-memory" },
        planning: { provider: "zebra", model: "gpt-planning" },
        search: { provider: "zebra", model: "gpt-search" },
        code_review: { provider: "alpha", model: "claude-review" },
        sub_agent: { provider: "zebra", model: "gpt-subagent" },
        subagent_models: {
          coder: { provider: "zebra", model: "gpt-coder" },
          reviewer: { provider: "alpha", model: "claude-review" },
        },
      },
    });

    removeProviderInstance(section, "zebra");

    expect(section.default_provider_instance_id).toBe("alpha");
    expect(section.provider_instances).not.toHaveProperty("zebra");
    expect(section.defaults).toEqual({
      chat: { provider: "alpha", model: "claude-alpha" },
      code_review: { provider: "alpha", model: "claude-review" },
      subagent_models: {
        reviewer: { provider: "alpha", model: "claude-review" },
      },
    });
  });

  it("rejects deletion before mutating when the replacement has no chat model", () => {
    const section = providerSectionFromConfig({
      provider: "openai",
      providers: {
        current: { provider_type: "openai", enabled: true, model: "gpt-current" },
        replacement: { provider_type: "anthropic", enabled: true },
      },
      default_provider_instance_id: "current",
      defaults: {
        chat: { provider: "current", model: "gpt-current" },
      },
    });

    expect(() => removeProviderInstance(section, "current")).toThrow(/has a chat model/);
    expect(section.provider_instances).toHaveProperty("current");
    expect(section.default_provider_instance_id).toBe("current");
    expect(section.defaults?.chat).toEqual({ provider: "current", model: "gpt-current" });
  });

  it("rejects deleting the final enabled migrated instance before legacy aliases can reactivate", () => {
    const section = providerSectionFromConfig({
      provider: "openai",
      providers: {
        openai: { enabled: true, model: "gpt-4o" },
      },
      default_provider_instance_id: "openai",
      defaults: {
        chat: { provider: "openai", model: "gpt-4o" },
        code_review: { provider: "openai", model: "gpt-4.1" },
      },
    });
    const snapshot = deepClone(section);

    expect(() => removeProviderInstance(section, "openai")).toThrow(
      /no other enabled provider instance remains/,
    );

    expect(section).toEqual(snapshot);
    expect(section.provider).toBe("openai");
    expect(section.providers.openai?.model).toBe("gpt-4o");
  });
});

describe("ProviderSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
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

  it("shows Bamboo-compatible provider URLs and copies an individual URL", async () => {
    window.localStorage.setItem("copilot_backend_base_url", "https://bamboo.example.com/proxy/v1/");
    vi.mocked(copyText).mockResolvedValue(undefined);
    setupProviderSettingsFetch({
      provider: "openai",
      providers: { openai: { api_key: "sk-masked" } },
    });

    render(<ProviderSettings />);

    expect(await screen.findByTestId("bamboo-provider-api-guide")).toBeInTheDocument();
    expect(screen.getByTestId("bamboo-provider-api-openai")).toHaveTextContent(
      "https://bamboo.example.com/proxy/openai/v1",
    );
    expect(screen.getByTestId("bamboo-provider-api-anthropic")).toHaveTextContent(
      "https://bamboo.example.com/proxy/anthropic/v1",
    );
    expect(screen.getByTestId("bamboo-provider-api-gemini")).toHaveTextContent(
      "https://bamboo.example.com/proxy/gemini/v1beta",
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy OpenAI base URL" }));
    await waitFor(() =>
      expect(copyText).toHaveBeenCalledWith("https://bamboo.example.com/proxy/openai/v1"),
    );
  }, 40000);

  it("always renders only the provider instance manager", async () => {
    setupProviderSettingsFetch({
      provider: "openai",
      providers: { openai: { api_key: "configured-but-never-returned", model: "gpt-4o" } },
    });

    render(<ProviderSettings />);

    expect(await screen.findByTestId("add-provider-instance")).toBeInTheDocument();
    expect(screen.getByTestId("edit-provider-instance-openai")).toBeInTheDocument();
    expect(screen.queryByTestId("provider-select")).not.toBeInTheDocument();
    expect(screen.queryByTestId("api-key-input")).not.toBeInTheDocument();
    expect(screen.queryByText("Active provider")).not.toBeInTheDocument();
  }, 20000);

  it("surfaces provider instance load failures without falling back to legacy controls", async () => {
    setupProviderSettingsFetch(
      {
        provider: "openai",
        providers: { openai: { model: "gpt-4o" } },
      },
      {
        rejectProviderLoad: {
          status: 503,
          body: { error: "provider instances unavailable" },
        },
      },
    );

    render(<ProviderSettings />);

    const alert = await screen.findByTestId("provider-instances-load-error");
    expect(alert).toHaveTextContent(/provider instances unavailable|Failed to load/i);
    expect(screen.getByTestId("add-provider-instance")).toBeInTheDocument();
    expect(screen.queryByTestId("provider-select")).not.toBeInTheDocument();
    expect(screen.queryByTestId("api-key-input")).not.toBeInTheDocument();
  }, 20000);

  it("includes defaults in save payload so model preferences persist", async () => {
    const { postedBodies } = setupProviderSettingsFetch({
      provider: "openai",
      defaults: {
        chat: { provider: "openai", model: "gpt-4o" },
        fast: { provider: "openai", model: "gpt-4o-mini" },
        task_summary: { provider: "anthropic", model: "claude-3-7-sonnet" },
        memory_background: { provider: "openai", model: "gpt-4.1-mini" },
        sub_agent: { provider: "openai", model: "gpt-4.1-mini" },
        vision: { provider: "openai", model: "gpt-4.1" },
      },
      providers: { openai: { api_key: "configured-but-never-returned" } },
      features: { provider_model_ref: false },
    });

    render(<ProviderSettings />);

    await screen.findByTestId("save-api-settings");
    await waitForModelPreferenceValue("chat", "openai/gpt-4o");
    await waitFor(() => {
      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/config/provider-settings") &&
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
  }, 20000);

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
  }, 20000);

  it("clears selectedModelRef and syncs current session when defaults change", async () => {
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

    setupProviderSettingsFetch({
      provider: "openai",
      defaults: {
        chat: { provider: "openai", model: "gpt-old" },
      },
      providers: { openai: { api_key: "configured-but-never-returned" } },
    });

    render(<ProviderSettings />);

    await screen.findByTestId("save-api-settings");
    await waitForModelPreferenceValue("chat", "openai/gpt-old");
    await selectModelPreferenceOption("chat", "gpt-new");
    await waitForModelPreferenceValue("chat", "openai/gpt-new");
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
  }, 20000);

  it("keeps the server snapshot and surfaces canonical save validation errors", async () => {
    setupProviderSettingsFetch(
      {
        provider: "openai",
        defaults: {
          chat: { provider: "openai", model: "gpt-4o" },
        },
        providers: {
          openai: { api_key: "configured-but-never-returned", model: "gpt-4o" },
        },
      },
      {
        rejectProviderSave: {
          body: { error: "OpenAI API key is required" },
        },
      },
    );

    render(<ProviderSettings />);

    await screen.findByTestId("save-api-settings");
    await waitForModelPreferenceValue("chat", "openai/gpt-4o");
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
              call[0].includes("/bamboo/config/provider-settings") &&
              ((call[1]?.method || "GET") as string).toUpperCase() === "PUT",
          ),
        ).toBe(true);
      },
      { timeout: 10000 },
    );

    expect(useConfigSectionStore.getState().sections.providers.envelope?.revision).toBe(1);
    expect(message.error).toHaveBeenCalledWith(
      expect.stringContaining("OpenAI API key is required"),
    );
  }, 20000);

  it("preserves backend provider substrate while saving defaults through canonical CAS", async () => {
    const api = setupProviderSettingsFetch({
      provider: "openai",
      defaults: {
        chat: { provider: "openai", model: "gpt-4o" },
      },
      providers: {
        openai: { api_key: "configured-but-never-returned", model: "gpt-4o" },
      },
    });

    render(<ProviderSettings />);

    await screen.findByTestId("save-api-settings");
    await waitForModelPreferenceValue("chat", "openai/gpt-4o");
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
              call[0].includes("/bamboo/config/provider-settings") &&
              ((call[1]?.method || "GET") as string).toUpperCase() === "PUT",
          ),
        ).toBe(true);
      },
      { timeout: 10000 },
    );

    expect(useProviderStore.getState().providerConfig.defaults?.chat).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
    expect(useConfigSectionStore.getState().sections.providers.envelope?.revision).toBe(2);
    expect(api.postedBodies.at(-1)?.providers).toEqual({
      openai: { model: "gpt-4o" },
    });
    expect(api.credentialChangeBodies.at(-1)).toEqual({});
  }, 20000);

  it("adopts a newer provider snapshot while the form is clean", async () => {
    const api = setupProviderSettingsFetch({
      provider: "openai",
      defaults: {
        chat: { provider: "openai", model: "gpt-old" },
        fast: { provider: "openai", model: "gpt-4o-mini" },
      },
      providers: {
        openai: { api_key: "configured-but-never-returned", model: "gpt-old" },
      },
    });

    render(<ProviderSettings />);
    await waitForModelPreferenceValue("fast", "openai/gpt-4o-mini");

    const external = deepClone(api.getCurrentConfig());
    external.defaults = {
      ...external.defaults,
      fast: { provider: "openai", model: "gpt-4.1-mini" },
    };
    act(() => api.publishExternal(external));

    await waitForModelPreferenceValue("fast", "openai/gpt-4.1-mini");
    expect(screen.queryByRole("button", { name: "Reapply local draft" })).not.toBeInTheDocument();
  }, 20000);

  it("blocks save when defaults.chat is missing (client-side required)", async () => {
    setupProviderSettingsFetch({
      provider: "openai",
      providers: { openai: { api_key: "configured-but-never-returned" } },
    });

    render(<ProviderSettings />);

    await screen.findByTestId("save-api-settings");
    await waitFor(() => {
      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/config/provider-settings") &&
            ((call[1]?.method || "GET") as string).toUpperCase() === "GET",
        ),
      ).toBe(true);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-api-settings"));
    });

    await waitFor(() => {
      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/config/provider-settings") &&
            ((call[1]?.method || "GET") as string).toUpperCase() === "PUT",
        ),
      ).toBe(false);
    });
  }, 20000);

  afterEach(async () => {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

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
      expect(latestBody.provider_instances?.anthropic?.reasoning_effort).toBe("high");
      expect(latestBody.provider_instances?.openai?.reasoning_effort).toBe("low");
    });
  }, 20000);

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
        expect(latestBody.provider_instances?.anthropic?.reasoning_effort).toBe("xhigh");
        expect(latestBody.provider_instances?.openai?.reasoning_effort).toBe("low");
      });
    },
    20000,
  );
});
