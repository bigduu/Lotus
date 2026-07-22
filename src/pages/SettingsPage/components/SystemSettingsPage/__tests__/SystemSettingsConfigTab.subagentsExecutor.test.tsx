import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App as AntdApp } from "antd";

import SystemSettingsConfigTab from "../SystemSettingsConfigTab";
import { serviceFactory } from "@services/common/ServiceFactory";

vi.mock("@services/common/ServiceFactory", () => ({
  serviceFactory: {
    getBambooConfig: vi.fn(),
    getBambooTools: vi.fn(),
    validateBambooConfigPatch: vi.fn(),
    detectCodexCli: vi.fn(),
    setBambooConfig: vi.fn(),
    getProxyAuthStatus: vi.fn(),
    setProxyAuth: vi.fn(),
    clearProxyAuth: vi.fn(),
  },
}));

const mockGetBambooConfig = vi.mocked(serviceFactory.getBambooConfig);
const mockGetBambooTools = vi.mocked(serviceFactory.getBambooTools);
const mockValidateBambooConfigPatch = vi.mocked(serviceFactory.validateBambooConfigPatch);
const mockDetectCodexCli = vi.mocked(serviceFactory.detectCodexCli);
const mockSetBambooConfig = vi.mocked(serviceFactory.setBambooConfig);
const mockGetProxyAuthStatus = vi.mocked(serviceFactory.getProxyAuthStatus);

describe("SystemSettingsConfigTab sub-agent executor settings", () => {
  const msgApi = {
    success: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBambooConfig.mockResolvedValue({
      http_proxy: "",
      https_proxy: "",
      memory: {
        auto_dream_enabled: false,
      },
      subagents: {
        max_concurrent: 8,
      },
    });
    mockGetBambooTools.mockResolvedValue({ tools: [] });
    mockGetProxyAuthStatus.mockResolvedValue({ configured: false, username: null });
    mockValidateBambooConfigPatch.mockResolvedValue({ valid: true, errors: {} });
    mockDetectCodexCli.mockResolvedValue({
      path: "/opt/homebrew/bin/codex",
      version: "codex-cli 0.144.5",
    });
    mockSetBambooConfig.mockResolvedValue({});
  });

  it("defaults to the built-in executor and hides the Claude Code fields", async () => {
    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    await screen.findByTestId("subagent-executor");
    expect(screen.queryByTestId("claude-code-binary")).not.toBeInTheDocument();
  });

  it("reveals and saves Claude Code executor fields once selected", async () => {
    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    const executorSelect = await screen.findByTestId("subagent-executor");
    fireEvent.mouseDown(within(executorSelect).getByRole("combobox"));
    fireEvent.click(await screen.findByTitle("Claude Code CLI"));

    const binaryInput = await screen.findByTestId("claude-code-binary");
    fireEvent.change(binaryInput, { target: { value: "/usr/local/bin/claude" } });

    const modelInput = screen.getByTestId("claude-code-model");
    fireEvent.change(modelInput, { target: { value: "claude-sonnet-4-5" } });

    const forwardEnvSelect = screen.getByTestId("claude-code-forward-env");
    const forwardEnvInput = forwardEnvSelect.querySelector("input") as HTMLInputElement;
    fireEvent.change(forwardEnvInput, { target: { value: "ANTHROPIC_API_KEY," } });

    const inheritToggle = screen.getByTestId("claude-code-inherit-user-config");
    fireEvent.click(inheritToggle);

    fireEvent.click(screen.getByTestId("save-subagent-settings"));

    await waitFor(() => {
      expect(mockSetBambooConfig).toHaveBeenCalledWith({
        subagents: {
          max_concurrent: 8,
          executor: "claude_code",
          claude_code_binary: "/usr/local/bin/claude",
          claude_code_model: "claude-sonnet-4-5",
          claude_code_permission_mode: undefined,
          claude_code_inherit_user_config: true,
          claude_code_forward_env: ["ANTHROPIC_API_KEY"],
          codex_binary: undefined,
          codex_model: undefined,
          codex_mode: undefined,
          codex_auth_mode: undefined,
          codex_base_url: undefined,
          codex_wire_api: undefined,
          codex_provider_key_ref: undefined,
          codex_forward_env: undefined,
          codex_sandbox: undefined,
          codex_approval_policy: undefined,
          codex_network_access: undefined,
          codex_allow_danger_bypass: undefined,
        },
      });
    });
  });

  it("sends an explicit bamboo_runtime executor when reverting from Claude Code to built-in", async () => {
    // The save patch is deep-merged server-side (bamboo-config's
    // deep_merge_json): an OMITTED key means "leave unchanged," not
    // "clear." So reverting away from a previously-saved claude_code
    // executor must send the concrete "bamboo_runtime" string, never
    // `undefined` (which would silently leave claude_code active).
    mockGetBambooConfig.mockResolvedValue({
      http_proxy: "",
      https_proxy: "",
      memory: { auto_dream_enabled: false },
      subagents: { max_concurrent: 8, executor: "claude_code" },
    });

    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    const executorSelect = await screen.findByTestId("subagent-executor");
    await screen.findByTestId("claude-code-binary");

    fireEvent.mouseDown(within(executorSelect).getByRole("combobox"));
    fireEvent.click(await screen.findByTitle("Built-in (Bamboo agent loop)"));

    fireEvent.click(screen.getByTestId("save-subagent-settings"));

    await waitFor(() => {
      const patch = mockSetBambooConfig.mock.calls.at(-1)?.[0];
      expect(patch?.subagents?.executor).toBe("bamboo_runtime");
    });
  });

  it("omits Claude Code fields from the patch when the built-in executor is active", async () => {
    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    await screen.findByTestId("subagent-executor");
    fireEvent.click(screen.getByTestId("save-subagent-settings"));

    await waitFor(() => {
      expect(mockSetBambooConfig).toHaveBeenCalledWith({
        subagents: {
          max_concurrent: 8,
          executor: undefined,
          claude_code_binary: undefined,
          claude_code_model: undefined,
          claude_code_permission_mode: undefined,
          claude_code_inherit_user_config: undefined,
          claude_code_forward_env: undefined,
          codex_binary: undefined,
          codex_model: undefined,
          codex_mode: undefined,
          codex_auth_mode: undefined,
          codex_base_url: undefined,
          codex_wire_api: undefined,
          codex_provider_key_ref: undefined,
          codex_forward_env: undefined,
          codex_sandbox: undefined,
          codex_approval_policy: undefined,
          codex_network_access: undefined,
          codex_allow_danger_bypass: undefined,
        },
      });
    });
  });

  it("detects Codex with the server preflight and saves the mapped defaults", async () => {
    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    const executorSelect = await screen.findByTestId("subagent-executor");
    fireEvent.mouseDown(within(executorSelect).getByRole("combobox"));
    fireEvent.click(await screen.findByTitle("Codex CLI"));

    expect(await screen.findByTestId("codex-executor-settings")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("codex-detect"));
    await screen.findByTestId("codex-detection-success");
    expect(mockDetectCodexCli).toHaveBeenCalledWith(undefined, "exec");
    expect(screen.getByTestId("codex-binary")).toHaveValue("/opt/homebrew/bin/codex");

    fireEvent.change(screen.getByTestId("codex-model"), {
      target: { value: "gpt-5.4" },
    });
    fireEvent.click(screen.getByTestId("save-subagent-settings"));

    await waitFor(() => {
      expect(mockSetBambooConfig).toHaveBeenCalledWith({
        subagents: {
          max_concurrent: 8,
          executor: "codex",
          claude_code_binary: undefined,
          claude_code_model: undefined,
          claude_code_permission_mode: undefined,
          claude_code_inherit_user_config: undefined,
          claude_code_forward_env: undefined,
          codex_binary: "/opt/homebrew/bin/codex",
          codex_model: "gpt-5.4",
          codex_mode: "exec",
          codex_auth_mode: "bamboo",
          codex_base_url: null,
          codex_wire_api: null,
          codex_provider_key_ref: null,
          codex_forward_env: [],
          codex_sandbox: null,
          codex_approval_policy: null,
          codex_network_access: false,
          codex_allow_danger_bypass: false,
        },
      });
    });
  });

  it("saves app-server mode with the mandatory parent approval policy", async () => {
    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    const executorSelect = await screen.findByTestId("subagent-executor");
    fireEvent.mouseDown(within(executorSelect).getByRole("combobox"));
    fireEvent.click(await screen.findByTitle("Codex CLI"));
    fireEvent.click(await screen.findByText("App server (interactive approvals)"));

    expect(screen.getByTestId("codex-mode")).toHaveTextContent(
      "App server (interactive approvals)",
    );
    fireEvent.click(screen.getByTestId("codex-detect"));
    await screen.findByTestId("codex-detection-success");
    expect(mockDetectCodexCli).toHaveBeenCalledWith(undefined, "app_server");
    fireEvent.click(screen.getByTestId("save-subagent-settings"));

    await waitFor(() => {
      const patch = mockSetBambooConfig.mock.calls.at(-1)?.[0];
      expect(patch?.subagents?.codex_mode).toBe("app_server");
      expect(patch?.subagents?.codex_approval_policy).toBe("on-request");
    });
  });

  it("saves custom-provider auth fields and renders structured validation feedback", async () => {
    mockValidateBambooConfigPatch.mockResolvedValue({
      valid: false,
      errors: {
        subagents: [
          {
            path: "subagents.codex_provider_key_ref",
            message: "codex_provider_key_ref has an invalid format",
          },
        ],
      },
    });

    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    const executorSelect = await screen.findByTestId("subagent-executor");
    fireEvent.mouseDown(within(executorSelect).getByRole("combobox"));
    fireEvent.click(await screen.findByTitle("Codex CLI"));
    fireEvent.click(await screen.findByText("Custom provider credential"));
    fireEvent.change(await screen.findByTestId("codex-base-url"), {
      target: { value: "https://provider.example/v1" },
    });
    fireEvent.change(screen.getByTestId("codex-provider-key-ref"), {
      target: { value: "not a credential ref" },
    });
    fireEvent.click(screen.getByTestId("save-subagent-settings"));

    const feedback = await screen.findByTestId("codex-validation-errors");
    expect(feedback).toHaveTextContent("subagents.codex_provider_key_ref");
    expect(feedback).toHaveTextContent("invalid format");
    expect(mockSetBambooConfig).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmation before enabling danger bypass", async () => {
    render(
      <AntdApp>
        <SystemSettingsConfigTab msgApi={msgApi} locale="en-US" onLocaleChange={() => undefined} />
      </AntdApp>,
    );

    const executorSelect = await screen.findByTestId("subagent-executor");
    fireEvent.mouseDown(within(executorSelect).getByRole("combobox"));
    fireEvent.click(await screen.findByTitle("Codex CLI"));

    const sandboxSelect = await screen.findByTestId("codex-sandbox");
    fireEvent.mouseDown(within(sandboxSelect).getByRole("combobox"));
    fireEvent.click(await screen.findByTitle("Danger: full filesystem access"));

    const bypass = screen.getByTestId("codex-danger-bypass");
    expect(bypass).not.toBeChecked();
    fireEvent.click(bypass);
    expect(bypass).not.toBeChecked();

    fireEvent.click(await screen.findByRole("button", { name: "Allow danger bypass" }));
    await waitFor(() => expect(bypass).toBeChecked());

    fireEvent.click(screen.getByTestId("save-subagent-settings"));
    await waitFor(() => {
      const patch = mockSetBambooConfig.mock.calls.at(-1)?.[0];
      expect(patch?.subagents?.codex_sandbox).toBe("danger-full-access");
      expect(patch?.subagents?.codex_allow_danger_bypass).toBe(true);
    });
  });
});
