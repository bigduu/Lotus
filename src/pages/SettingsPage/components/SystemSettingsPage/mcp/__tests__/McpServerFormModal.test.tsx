import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServerCredentialStatus } from "@services/config/configSections";
import type { McpServerConfig } from "@services/mcp";
import { McpServerFormModal } from "../McpServerFormModal";

const editConfig = (
  name: string,
  env: Record<string, string> = { TOKEN: "" },
): McpServerConfig => ({
  id: "filesystem",
  name,
  enabled: true,
  transport: {
    type: "stdio",
    command: "npx",
    args: ["server"],
    env,
  },
  request_timeout_ms: 60_000,
  healthcheck_interval_ms: 30_000,
  allowed_tools: [],
  denied_tools: [],
});

const credentialStatus = (
  entries: Record<string, { configured: boolean; source: string | null }>,
): McpServerCredentialStatus => ({
  env: Object.fromEntries(
    Object.entries(entries).map(([name, status]) => [name, { ...status, updated_at: null }]),
  ),
  headers: {},
});

describe("McpServerFormModal", () => {
  let unhandledRejectionHandler: ((event: PromiseRejectionEvent) => void) | null;

  beforeEach(() => {
    unhandledRejectionHandler = null;
    // Guard against fake timer leakage from other test files in full-suite runs.
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (unhandledRejectionHandler) {
      window.removeEventListener("unhandledrejection", unhandledRejectionHandler);
    }
  });

  it("submits stdio server configuration", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<McpServerFormModal open mode="create" onCancel={vi.fn()} onSubmit={onSubmit} />);

    const serverIdInput = (await screen.findByPlaceholderText("filesystem")) as HTMLInputElement;
    const displayNameInput = screen.getByPlaceholderText("Filesystem MCP") as HTMLInputElement;
    const commandInput = screen.getByPlaceholderText("npx") as HTMLInputElement;

    // Let modal/form effects settle before user interaction.
    await waitFor(() => {
      expect(serverIdInput).toBeInTheDocument();
      expect(commandInput).toBeInTheDocument();
    });

    fireEvent.change(serverIdInput, {
      target: { value: "filesystem" },
    });

    fireEvent.change(displayNameInput, {
      target: { value: "Filesystem" },
    });

    fireEvent.change(commandInput, {
      target: { value: "npx" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled(), {
      timeout: 10000,
    });

    const submitted = onSubmit.mock.calls[0]?.[0];
    expect(submitted).toEqual(
      expect.objectContaining({
        id: "filesystem",
        name: "Filesystem",
        transport: expect.objectContaining({
          type: "stdio",
          command: "npx",
        }),
      }),
    );
  }, 20000);

  it("preserves form data when submission fails", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Connection failed"));
    const onCancel = vi.fn();

    // Suppress the unhandled rejection that occurs due to Modal's void handleSubmit() usage
    unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
      if (event.reason?.message === "Connection failed") {
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", unhandledRejectionHandler);

    render(<McpServerFormModal open mode="create" onCancel={onCancel} onSubmit={onSubmit} />);

    const serverIdInput = (await screen.findByPlaceholderText("filesystem")) as HTMLInputElement;
    const displayNameInput = screen.getByPlaceholderText("Filesystem MCP") as HTMLInputElement;
    const commandInput = screen.getByPlaceholderText("npx") as HTMLInputElement;

    await waitFor(() => {
      expect(serverIdInput).toBeInTheDocument();
      expect(commandInput).toBeInTheDocument();
    });

    // Fill out the form
    fireEvent.change(serverIdInput, {
      target: { value: "my-server" },
    });

    fireEvent.change(displayNameInput, {
      target: { value: "My Server" },
    });

    fireEvent.change(commandInput, {
      target: { value: "node" },
    });

    // Submit the form (it will fail)
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(
      () => {
        expect(onSubmit).toHaveBeenCalled();
      },
      { timeout: 10000 },
    );

    // Verify form data is preserved after error
    expect(serverIdInput.value).toBe("my-server");
    expect(displayNameInput.value).toBe("My Server");
    expect(commandInput.value).toBe("node");

    // Verify modal is still open (user can retry)
    expect(onCancel).not.toHaveBeenCalled();
  }, 20000);

  it("submits via JSON editor", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<McpServerFormModal open mode="create" onCancel={vi.fn()} onSubmit={onSubmit} />);

    // Switch to JSON mode
    fireEvent.click(screen.getByRole("radio", { name: /json/i }));

    // Wait for textarea to appear
    await waitFor(() => {
      expect(document.querySelector("textarea")).not.toBeNull();
    });

    const config = {
      id: "json-server",
      enabled: true,
      transport: {
        type: "stdio" as const,
        command: "node",
        args: ["server.js"],
        env: {},
      },
      request_timeout_ms: 60000,
      healthcheck_interval_ms: 30000,
      allowed_tools: [],
      denied_tools: [],
    };

    const textarea = document.querySelector("textarea");
    fireEvent.change(textarea!, {
      target: { value: JSON.stringify(config, null, 2) },
    });

    // Submit the form
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "json-server",
          transport: expect.objectContaining({
            type: "stdio",
            command: "node",
          }),
        }),
      );
    });
  });

  it("shows error for invalid JSON", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<McpServerFormModal open mode="create" onCancel={vi.fn()} onSubmit={onSubmit} />);

    // Switch to JSON mode
    fireEvent.click(screen.getByRole("radio", { name: /json/i }));

    await waitFor(() => {
      expect(document.querySelector("textarea")).not.toBeNull();
    });

    const textarea = document.querySelector("textarea");
    fireEvent.change(textarea!, {
      target: { value: "{ invalid json" },
    });

    // Submit the form
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("JSON Error")).toBeInTheDocument();
    });

    // Should not call onSubmit
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows credential status and explicit keep, replace, and clear semantics without masks", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const status = credentialStatus({
      USER_TOKEN: { configured: true, source: "user" },
      ENV_TOKEN: { configured: true, source: "environment" },
      MISSING_TOKEN: { configured: false, source: null },
    });

    render(
      <McpServerFormModal
        open
        mode="edit"
        initialConfig={editConfig("Filesystem", {
          USER_TOKEN: "****...****",
          ENV_TOKEN: "********",
          MISSING_TOKEN: "",
        })}
        latestConfig={editConfig("Filesystem")}
        currentRevision={7}
        credentialStatus={status}
        latestCredentialStatus={status}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(await screen.findByText("Configured")).toBeInTheDocument();
    expect(screen.getByText("From env")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getAllByText("Leave blank to keep the configured value.")).toHaveLength(2);
    expect(screen.queryByText("****...****")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /json/i }));
    const jsonEditor = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(jsonEditor.value).toContain('"USER_TOKEN": ""');
    expect(jsonEditor.value).not.toContain("****");
    expect(screen.getByText("Credential values are not displayed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /form/i }));
    const secretInputs = screen.getAllByPlaceholderText(
      "Blank keeps current; enter a value to replace",
    );
    fireEvent.change(secretInputs[0]!, { target: { value: "replacement" } });
    expect(
      await screen.findByText("Non-empty value will replace the credential on save."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear credential USER_TOKEN" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0].transport).toMatchObject({
      type: "stdio",
      env: {
        ENV_TOKEN: "",
        MISSING_TOKEN: "",
      },
    });
    expect(onSubmit.mock.calls[0]?.[1]).toBe(7);
  });

  it("reapplies a local draft over the latest revision and keeps the draft visible", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const base = editConfig("Base server", { TOKEN: "****...****" });
    const latest = editConfig("Remote server", { TOKEN: "" });
    const status = credentialStatus({
      TOKEN: { configured: true, source: "user" },
    });
    const view = render(
      <McpServerFormModal
        open
        mode="edit"
        initialConfig={base}
        latestConfig={base}
        currentRevision={7}
        credentialStatus={status}
        latestCredentialStatus={status}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const nameInput = (await screen.findByPlaceholderText("Filesystem MCP")) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Local draft" } });
    view.rerender(
      <McpServerFormModal
        open
        mode="edit"
        initialConfig={base}
        latestConfig={latest}
        currentRevision={8}
        credentialStatus={status}
        latestCredentialStatus={status}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(await screen.findByText("MCP settings changed externally")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compare changes" }));
    const comparison = screen.getByTestId("mcp-server-revision-comparison");
    expect(comparison).toHaveTextContent('"baseRevision": 7');
    expect(comparison).toHaveTextContent("Local draft");
    expect(comparison).toHaveTextContent("Remote server");
    expect(comparison).not.toHaveTextContent("****");

    fireEvent.click(screen.getByRole("button", { name: "Reapply draft" }));
    expect(nameInput).toHaveValue("Local draft");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "Local draft" }), 8),
    );
  });

  it("reloads the latest server and advances the edit base revision", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const base = editConfig("Base server");
    const latest = editConfig("Remote server");
    const view = render(
      <McpServerFormModal
        open
        mode="edit"
        initialConfig={base}
        latestConfig={base}
        currentRevision={7}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const nameInput = (await screen.findByPlaceholderText("Filesystem MCP")) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Discard me" } });
    view.rerender(
      <McpServerFormModal
        open
        mode="edit"
        initialConfig={base}
        latestConfig={latest}
        currentRevision={8}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Reload latest" }));
    expect(nameInput).toHaveValue("Remote server");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "Remote server" }), 8),
    );
  });
});
