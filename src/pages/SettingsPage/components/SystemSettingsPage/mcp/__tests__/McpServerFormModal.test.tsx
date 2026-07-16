import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpServerFormModal } from "../McpServerFormModal";

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
});
