import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sanitizeInstanceConfigForForm } from "./providerInstanceUtils";
import { ProviderInstanceManager } from "./ProviderInstanceManager";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";
import type { ProviderInstance } from "@shared/types/providerConfig";

describe("sanitizeInstanceConfigForForm", () => {
  it("removes reserved top-level instance keys from config payloads", () => {
    expect(
      sanitizeInstanceConfigForForm({
        type: "",
        provider_type: "copilot",
        label: "GitHub Copilot",
        enabled: true,
        id: "inst-1",
        api_key_encrypted: "secret",
        headless_auth: false,
        reasoning_effort: "medium",
        responses_only_models: ["gpt-5*"],
      }),
    ).toEqual({
      headless_auth: false,
      reasoning_effort: "medium",
      responses_only_models: ["gpt-5*"],
    });
  });

  it("preserves valid provider-specific config used to repopulate edit forms", () => {
    expect(
      sanitizeInstanceConfigForForm({
        headless_auth: false,
        reasoning_effort: "max",
        responses_only_models: ["gpt-5*"],
      }),
    ).toEqual({
      headless_auth: false,
      reasoning_effort: "max",
      responses_only_models: ["gpt-5*"],
    });
  });

  it("returns an empty object for nullish config", () => {
    expect(sanitizeInstanceConfigForForm(undefined)).toEqual({});
    expect(sanitizeInstanceConfigForForm(null)).toEqual({});
  });
});

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

vi.mock("@services/config/SettingsService", () => ({
  settingsService: {
    startCopilotAuth: vi.fn(),
    completeCopilotAuth: vi.fn(),
    getCopilotAuthStatus: vi.fn(),
  },
}));

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

function getInputWithin(testId: string): HTMLInputElement {
  const field = screen.getByTestId(testId);
  const input = field instanceof HTMLInputElement ? field : field.querySelector("input");
  if (!input) throw new Error(`No <input> found within testid "${testId}"`);
  return input;
}

function getTextareaWithin(testId: string): HTMLTextAreaElement {
  const field = screen.getByTestId(testId);
  const textarea = field instanceof HTMLTextAreaElement ? field : field.querySelector("textarea");
  if (!textarea) throw new Error(`No <textarea> found within testid "${testId}"`);
  return textarea;
}

describe("ProviderInstanceManager — request_overrides_json field", () => {
  const onCreateInstance = vi.fn().mockResolvedValue(undefined);
  const onUpdateInstance = vi.fn().mockResolvedValue(undefined);
  const commonProps = {
    latestInstances: [],
    currentRevision: 7,
    credentialStatusById: {},
    onCreateInstance,
    onUpdateInstance,
    onDeleteInstance: vi.fn().mockResolvedValue(undefined),
    onSetDefaultInstance: vi.fn().mockResolvedValue(undefined),
    onClearInstanceCredential: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useProviderStore.setState({ loadProviderInstances: vi.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => {
    cleanup();
  });

  it("blocks save and surfaces a field-level error for invalid JSON, without crashing", async () => {
    render(<ProviderInstanceManager instances={[]} defaultInstanceId={null} {...commonProps} />);

    fireEvent.click(screen.getByTestId("add-provider-instance"));
    await selectAntdOption("instance-type-select", "OpenAI");

    fireEvent.change(getInputWithin("instance-api-key-input"), {
      target: { value: "sk-test-123" },
    });
    fireEvent.change(getTextareaWithin("request-overrides-textarea"), {
      target: { value: "{ not valid json" },
    });

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    // Field-level error rendered, save is blocked, and nothing crashes.
    await screen.findByText((content) =>
      content.startsWith("Invalid request_overrides JSON for OpenAI"),
    );
    expect(onCreateInstance).not.toHaveBeenCalled();
    // The modal is still open (create dialog title still present).
    expect(screen.getByText("Create Provider Instance")).toBeInTheDocument();
  }, 20000);

  it("round-trips valid JSON into config.request_overrides on create", async () => {
    render(<ProviderInstanceManager instances={[]} defaultInstanceId={null} {...commonProps} />);

    fireEvent.click(screen.getByTestId("add-provider-instance"));
    await selectAntdOption("instance-type-select", "OpenAI");

    fireEvent.change(getInputWithin("instance-api-key-input"), {
      target: { value: "sk-test-123" },
    });
    fireEvent.change(getTextareaWithin("request-overrides-textarea"), {
      target: { value: '{"common":{"headers":{"x-test":"1"}}}' },
    });

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => expect(onCreateInstance).toHaveBeenCalled());
    const payload = onCreateInstance.mock.calls[0]?.[0];
    expect(payload?.config.request_overrides).toEqual({ common: { headers: { "x-test": "1" } } });
    expect(onCreateInstance.mock.calls[0]?.[1]).toBe(7);
  }, 20000);

  it("prefills the textarea from an existing instance's request_overrides when editing", async () => {
    const instance: ProviderInstance = {
      id: "inst-1",
      type: "openai",
      label: "My OpenAI",
      enabled: true,
      config: {
        api_key: "must-not-be-prefilled",
        base_url: "https://api.openai.com/v1",
        request_overrides: { common: { headers: { "x-test": "1" } } },
      },
    };
    render(
      <ProviderInstanceManager
        instances={[instance]}
        defaultInstanceId={null}
        {...commonProps}
        credentialStatusById={{
          "inst-1": {
            credential_ref: "provider_instance.inst-1.api_key",
            configured: true,
            source: "user",
            updated_at: null,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("edit-provider-instance-inst-1"));

    await waitFor(() => {
      const textarea = getTextareaWithin("request-overrides-textarea");
      expect(textarea.value).toBe(
        JSON.stringify({ common: { headers: { "x-test": "1" } } }, null, 2),
      );
      expect(getInputWithin("instance-api-key-input")).toHaveValue("");
    });
  }, 20000);

  it("round-trips the edited JSON back into config.request_overrides on update", async () => {
    const instance: ProviderInstance = {
      id: "inst-1",
      type: "openai",
      label: "My OpenAI",
      enabled: true,
      config: {
        base_url: "https://api.openai.com/v1",
        request_overrides: { common: { headers: { "x-test": "1" } } },
      },
    };
    render(
      <ProviderInstanceManager
        instances={[instance]}
        defaultInstanceId={null}
        {...commonProps}
        credentialStatusById={{
          "inst-1": {
            credential_ref: "provider_instance.inst-1.api_key",
            configured: true,
            source: "user",
            updated_at: null,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("edit-provider-instance-inst-1"));

    // Wait for the modal's async prefill (afterOpenChange → setFieldsValue)
    // to actually land — the textarea node exists as soon as the type is
    // selected, well before Modal's CSS-motion "afterOpenChange" callback
    // populates it, so waiting on mere DOM presence races ahead of the
    // prefill and would submit a still-empty form.
    await waitFor(() => {
      expect(getTextareaWithin("request-overrides-textarea").value).toBe(
        JSON.stringify({ common: { headers: { "x-test": "1" } } }, null, 2),
      );
    });

    const textarea = getTextareaWithin("request-overrides-textarea");
    fireEvent.change(textarea, {
      target: { value: '{"common":{"headers":{"x-test":"2"}}}' },
    });

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => expect(onUpdateInstance).toHaveBeenCalled());
    const [, payload] = onUpdateInstance.mock.calls[0] ?? [];
    expect(payload?.config?.request_overrides).toEqual({ common: { headers: { "x-test": "2" } } });
  }, 20000);

  it("adopts a newer instance snapshot while the edit form is clean", async () => {
    const original: ProviderInstance = {
      id: "inst-1",
      type: "openai",
      label: "Original label",
      enabled: true,
      config: { base_url: "https://old.example/v1" },
    };
    const latest: ProviderInstance = {
      ...original,
      label: "Server label",
      config: { base_url: "https://new.example/v1" },
    };
    const { rerender } = render(
      <ProviderInstanceManager
        {...commonProps}
        instances={[original]}
        latestInstances={[original]}
        defaultInstanceId={null}
        currentRevision={7}
        credentialStatusById={{
          "inst-1": {
            credential_ref: "provider_instance.inst-1.api_key",
            configured: true,
            source: "user",
            updated_at: null,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("edit-provider-instance-inst-1"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("My OpenAI Instance")).toHaveValue("Original label"),
    );

    rerender(
      <ProviderInstanceManager
        {...commonProps}
        instances={[original]}
        latestInstances={[latest]}
        defaultInstanceId={null}
        currentRevision={8}
        credentialStatusById={{
          "inst-1": {
            credential_ref: "provider_instance.inst-1.api_key",
            configured: true,
            source: "user",
            updated_at: null,
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("My OpenAI Instance")).toHaveValue("Server label");
      expect(screen.getByPlaceholderText("https://api.openai.com/v1")).toHaveValue(
        "https://new.example/v1",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(onUpdateInstance).toHaveBeenCalled());
    expect(onUpdateInstance.mock.calls.at(-1)?.[2]).toBe(8);
  }, 20000);

  it("preserves a dirty credential draft and explicitly reapplies it over the latest snapshot", async () => {
    const original: ProviderInstance = {
      id: "inst-1",
      type: "openai",
      label: "Original label",
      enabled: true,
      config: { base_url: "https://old.example/v1" },
    };
    const latest: ProviderInstance = {
      ...original,
      label: "Server label",
      config: { base_url: "https://new.example/v1" },
    };
    const credentialStatusById = {
      "inst-1": {
        credential_ref: "provider_instance.inst-1.api_key",
        configured: true,
        source: "user" as const,
        updated_at: null,
      },
    };
    const { rerender } = render(
      <ProviderInstanceManager
        {...commonProps}
        instances={[original]}
        latestInstances={[original]}
        defaultInstanceId={null}
        currentRevision={7}
        credentialStatusById={credentialStatusById}
      />,
    );

    fireEvent.click(screen.getByTestId("edit-provider-instance-inst-1"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("My OpenAI Instance")).toHaveValue("Original label"),
    );
    fireEvent.change(screen.getByPlaceholderText("My OpenAI Instance"), {
      target: { value: "Local label" },
    });
    fireEvent.change(getInputWithin("instance-api-key-input"), {
      target: { value: "sk-local-replacement" },
    });

    rerender(
      <ProviderInstanceManager
        {...commonProps}
        instances={[original]}
        latestInstances={[latest]}
        defaultInstanceId={null}
        currentRevision={8}
        credentialStatusById={credentialStatusById}
      />,
    );

    expect(await screen.findByRole("button", { name: "Reapply local draft" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("My OpenAI Instance")).toHaveValue("Local label");
    expect(getInputWithin("instance-api-key-input")).toHaveValue("sk-local-replacement");

    fireEvent.click(screen.getByRole("button", { name: "Compare changes" }));
    const modalInfo = vi.mocked(AntApp.useApp().modal.info);
    expect(modalInfo).toHaveBeenCalled();
    const comparisonText = (modalInfo.mock.calls.at(-1)?.[0] as any).content.props.children[1].props
      .children;
    expect(comparisonText).not.toContain("sk-local-replacement");

    fireEvent.click(screen.getByRole("button", { name: "Reapply local draft" }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText("My OpenAI Instance")).toHaveValue("Local label");
      expect(screen.getByPlaceholderText("https://api.openai.com/v1")).toHaveValue(
        "https://new.example/v1",
      );
      expect(getInputWithin("instance-api-key-input")).toHaveValue("sk-local-replacement");
    });

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(onUpdateInstance).toHaveBeenCalled());
    const [, payload, expectedRevision] = onUpdateInstance.mock.calls.at(-1) ?? [];
    expect(expectedRevision).toBe(8);
    expect(payload).toMatchObject({
      label: "Local label",
      config: {
        api_key: "sk-local-replacement",
        base_url: "https://new.example/v1",
      },
    });
  }, 20000);

  it("keeps the stale draft open when the captured revision is rejected", async () => {
    const original: ProviderInstance = {
      id: "inst-1",
      type: "openai",
      label: "Original label",
      enabled: true,
      config: { base_url: "https://old.example/v1" },
    };
    const latest: ProviderInstance = {
      ...original,
      label: "Server label",
    };
    onUpdateInstance.mockRejectedValueOnce(new Error("revision conflict"));
    const { rerender } = render(
      <ProviderInstanceManager
        {...commonProps}
        instances={[original]}
        latestInstances={[original]}
        defaultInstanceId={null}
        currentRevision={7}
        credentialStatusById={{
          "inst-1": {
            credential_ref: "provider_instance.inst-1.api_key",
            configured: true,
            source: "user",
            updated_at: null,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("edit-provider-instance-inst-1"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("My OpenAI Instance")).toHaveValue("Original label"),
    );
    fireEvent.change(screen.getByPlaceholderText("My OpenAI Instance"), {
      target: { value: "Unsaved local label" },
    });
    rerender(
      <ProviderInstanceManager
        {...commonProps}
        instances={[original]}
        latestInstances={[latest]}
        defaultInstanceId={null}
        currentRevision={8}
        credentialStatusById={{
          "inst-1": {
            credential_ref: "provider_instance.inst-1.api_key",
            configured: true,
            source: "user",
            updated_at: null,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(onUpdateInstance).toHaveBeenCalled());
    expect(onUpdateInstance.mock.calls.at(-1)?.[2]).toBe(7);
    expect(screen.getByText("Edit Provider Instance")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("My OpenAI Instance")).toHaveValue("Unsaved local label");
  }, 20000);
});
