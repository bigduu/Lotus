import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SystemSettingsEnvVarsTab from "../SystemSettingsEnvVarsTab";
import {
  ConfigConflictError,
  configSectionsService,
  type ConfigSectionEnvelope,
  type EnvMutationResult,
  type EnvSection,
} from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  const message = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
  };
  const modal = { confirm: vi.fn() };
  return {
    ...actual,
    message,
    App: Object.assign(actual.App, {
      useApp: () => ({ message, notification: message, modal }),
    }),
  };
});

const entries: EnvSection = [
  {
    name: "NODE_ENV",
    value: "production",
    secret: false,
    configured: true,
    description: "Node environment",
  },
  {
    name: "GITHUB_TOKEN",
    secret: true,
    credential_state: "configured",
    credential_ref: "env.GITHUB_TOKEN.value",
    source: "user",
    updated_at: null,
    configured: true,
    description: "GitHub PAT",
  },
  {
    name: "FROM_ENV",
    secret: true,
    credential_state: "from_env",
    credential_ref: "env.FROM_ENV.value",
    source: "environment",
    updated_at: null,
    configured: true,
    description: "Environment-owned token",
  },
  {
    name: "EMPTY_SECRET",
    secret: true,
    credential_state: "missing",
    configured: false,
  },
];

const envEnvelope = (
  revision: number,
  data: EnvSection = entries,
): ConfigSectionEnvelope<EnvSection> => ({
  data,
  revision,
  loaded_at: `2026-07-26T00:00:0${revision}Z`,
  source_path: "/tmp/env.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const mutationResult = (envelope: ConfigSectionEnvelope<EnvSection>): EnvMutationResult => ({
  envelope,
});

const openEditModal = async (name: string) => {
  const row = (await screen.findByText(name)).closest("tr");
  if (!row) throw new Error(`row for ${name} was not found`);
  fireEvent.click(row.querySelector<HTMLButtonElement>('button[aria-label="Edit"]')!);
  await screen.findByText("Edit Variable");
};

const publishEnvEnvelope = (envelope: ConfigSectionEnvelope<EnvSection>) => {
  act(() => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        env: {
          ...state.sections.env,
          envelope,
        },
      },
    }));
  });
};

describe("SystemSettingsEnvVarsTab", () => {
  let currentEnv: ConfigSectionEnvelope<EnvSection>;

  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
    currentEnv = envEnvelope(5);
    vi.spyOn(configSectionsService, "getSection").mockImplementation(async (section) => {
      if (section === "env") return currentEnv as never;
      throw new Error(`Unexpected section ${section}`);
    });
    vi.spyOn(configSectionsService, "upsertEnvVar").mockResolvedValue(
      mutationResult(envEnvelope(6)),
    );
    vi.spyOn(configSectionsService, "deleteEnvVar").mockResolvedValue(
      mutationResult(
        envEnvelope(
          6,
          entries.filter((entry) => entry.name !== "NODE_ENV"),
        ),
      ),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders the exact typed Env projection without retaining a mask", async () => {
    render(<SystemSettingsEnvVarsTab />);

    expect(await screen.findByText("NODE_ENV")).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByText("Configured")).toBeInTheDocument();
    expect(screen.getByText("From env")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.queryByText("****...****")).not.toBeInTheDocument();
    expect(configSectionsService.getSection).toHaveBeenCalledWith("env");
  });

  it("creates a variable through the store with the captured section revision", async () => {
    const save = vi.mocked(configSectionsService.upsertEnvVar);
    render(<SystemSettingsEnvVarsTab />);
    await screen.findByText("NODE_ENV");

    fireEvent.click(screen.getByText("Add Variable"));
    fireEvent.change(screen.getByPlaceholderText("GITHUB_TOKEN"), {
      target: { value: "NEW_SECRET" },
    });
    fireEvent.change(screen.getByPlaceholderText("Enter value"), {
      target: { value: "new-secret-value" },
    });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          name: "NEW_SECRET",
          credential_change: { action: "replace", value: "new-secret-value" },
          secret: true,
        }),
      ),
    );
    expect(JSON.stringify(useConfigSectionStore.getState().sections.env.envelope)).not.toContain(
      "new-secret-value",
    );
  });

  it("omits an untouched stored secret instead of sending a mask or empty keep value", async () => {
    const save = vi.mocked(configSectionsService.upsertEnvVar);
    render(<SystemSettingsEnvVarsTab />);
    await openEditModal("GITHUB_TOKEN");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[0]).toBe(5);
    expect(save.mock.calls[0]?.[1]).toEqual({
      name: "GITHUB_TOKEN",
      secret: true,
      description: "GitHub PAT",
    });
  });

  it("uses an explicit empty value when clearing a stored secret", async () => {
    const save = vi.mocked(configSectionsService.upsertEnvVar);
    render(<SystemSettingsEnvVarsTab />);
    await openEditModal("GITHUB_TOKEN");

    fireEvent.click(screen.getByRole("button", { name: "Clear stored value" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          name: "GITHUB_TOKEN",
          credential_change: { action: "clear" },
        }),
      ),
    );
  });

  it("shows an environment-owned secret as read-only until an explicit replacement", async () => {
    const save = vi.mocked(configSectionsService.upsertEnvVar);
    render(<SystemSettingsEnvVarsTab />);
    await openEditModal("FROM_ENV");

    expect(screen.getAllByText("From env").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/active value comes from the environment/i)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Enter new value or leave empty"), {
      target: { value: "explicit-replacement" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          name: "FROM_ENV",
          credential_change: { action: "replace", value: "explicit-replacement" },
        }),
      ),
    );
  });

  it("auto-adopts a newer clean typed snapshot", async () => {
    render(<SystemSettingsEnvVarsTab />);
    await openEditModal("NODE_ENV");

    publishEnvEnvelope(
      envEnvelope(
        6,
        entries.map((entry) =>
          entry.name === "NODE_ENV"
            ? { ...entry, value: "staging", description: "External metadata" }
            : entry,
        ),
      ),
    );

    expect(await screen.findByDisplayValue("staging")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Optional description")).toHaveValue("External metadata");
    expect(screen.queryByText("Environment variables changed externally")).not.toBeInTheDocument();
  });

  it("preserves, redacts, compares, and reapplies a dirty secret draft", async () => {
    const save = vi.mocked(configSectionsService.upsertEnvVar);
    render(<SystemSettingsEnvVarsTab />);
    await openEditModal("GITHUB_TOKEN");
    fireEvent.change(screen.getByPlaceholderText("Enter new value or leave empty"), {
      target: { value: "local-secret-replacement" },
    });
    fireEvent.change(screen.getByPlaceholderText("Optional description"), {
      target: { value: "Local metadata" },
    });

    const external = envEnvelope(
      6,
      entries.map((entry) =>
        entry.name === "GITHUB_TOKEN" ? { ...entry, description: "External metadata" } : entry,
      ),
    );
    publishEnvEnvelope(external);

    expect(await screen.findByText("Environment variables changed externally")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter new value or leave empty")).toHaveValue(
      "local-secret-replacement",
    );
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const comparison = screen.getByTestId("env-var-revision-comparison").textContent ?? "";
    expect(comparison).toContain("[replace requested]");
    expect(comparison).toContain("External metadata");
    expect(comparison).not.toContain("local-secret-replacement");
    expect(comparison).not.toContain("****...****");

    fireEvent.click(screen.getByRole("button", { name: "Reapply" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        6,
        expect.objectContaining({
          credential_change: {
            action: "replace",
            value: "local-secret-replacement",
          },
          description: "Local metadata",
        }),
      ),
    );
  });

  it("keeps a stale draft open and exposes the current section revision after 409", async () => {
    vi.mocked(configSectionsService.upsertEnvVar).mockRejectedValueOnce(
      new ConfigConflictError({
        expectedRevision: 5,
        currentRevision: 6,
        message: "revision conflict",
      }),
    );
    render(<SystemSettingsEnvVarsTab />);
    await openEditModal("GITHUB_TOKEN");
    fireEvent.change(screen.getByPlaceholderText("Enter new value or leave empty"), {
      target: { value: "preserved-local-secret" },
    });
    currentEnv = envEnvelope(
      6,
      entries.map((entry) =>
        entry.name === "GITHUB_TOKEN" ? { ...entry, description: "External metadata" } : entry,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Environment revision conflict")).toBeInTheDocument();
    expect(screen.getByText(/server is at revision 6/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter new value or leave empty")).toHaveValue(
      "preserved-local-secret",
    );
    expect(useConfigSectionStore.getState().sections.env.envelope?.revision).toBe(6);
  });

  it("deletes through the store with the current section revision", async () => {
    const remove = vi.mocked(configSectionsService.deleteEnvVar);
    render(<SystemSettingsEnvVarsTab />);
    const row = (await screen.findByText("NODE_ENV")).closest("tr");
    fireEvent.click(row!.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')!);
    fireEvent.click(await screen.findByRole("button", { name: "Yes" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("NODE_ENV", 5));
  });

  it("keeps last-known-good entries visible when a later section load fails", async () => {
    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          env: {
            ...state.sections.env,
            envelope: envEnvelope(5),
            error: "redacted env refresh failure",
          },
        },
      }));
    });
    render(<SystemSettingsEnvVarsTab />);

    expect(await screen.findByText("NODE_ENV")).toBeInTheDocument();
    expect(screen.getByText("redacted env refresh failure")).toBeInTheDocument();
  });
});
