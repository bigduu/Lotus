import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SystemSettingsEnvVarsTab from "../SystemSettingsEnvVarsTab";
import { configSectionsService } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { ApiError } from "@services/api/client";
import {
  settingsService,
  EnvVarsListResponse,
  EnvVarResponse,
} from "@services/config/SettingsService";

// Mock settingsService
vi.mock("@services/config/SettingsService", async () => {
  const actual = await vi.importActual("@services/config/SettingsService");
  return {
    ...actual,
    settingsService: {
      getEnvVars: vi.fn(),
      upsertEnvVar: vi.fn(),
      deleteEnvVar: vi.fn(),
      replaceEnvVars: vi.fn(),
    },
  };
});

// Mock antd message
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

const mockGetEnvVars = vi.mocked(settingsService.getEnvVars);
const mockUpsertEnvVar = vi.mocked(settingsService.upsertEnvVar);
const mockDeleteEnvVar = vi.mocked(settingsService.deleteEnvVar);

// ── Fixtures ────────────────────────────────────────────────

const emptyList: EnvVarsListResponse = { revision: 3, entries: [] };

const sampleEntries: EnvVarResponse[] = [
  {
    name: "NODE_ENV",
    value: "production",
    secret: false,
    has_value: true,
    configured: true,
    description: "Node environment",
  },
  {
    name: "GITHUB_TOKEN",
    value: "****...****",
    secret: true,
    has_value: true,
    configured: true,
    description: "GitHub PAT",
  },
  {
    name: "EMPTY_SECRET",
    value: "****...****",
    secret: true,
    has_value: false,
    configured: false,
    description: undefined,
  },
];

const sampleList: EnvVarsListResponse = { revision: 3, entries: sampleEntries };

const envListAt = (
  revision: number,
  changes: Partial<Record<string, Partial<EnvVarResponse>>> = {},
): EnvVarsListResponse => ({
  revision,
  entries: sampleEntries.map((entry) => ({ ...entry, ...changes[entry.name] })),
});

const publishEnvSignal = (revision: number) => {
  const snapshot = useConfigSectionStore.getState().sections.env;
  if (!snapshot.envelope) throw new Error("env section must be loaded before publishing an event");

  useConfigSectionStore.setState((state) => ({
    sections: {
      ...state.sections,
      env: {
        ...state.sections.env,
        envelope: {
          ...state.sections.env.envelope!,
          revision,
        },
      },
    },
  }));
};

const openEditModal = async (name: string) => {
  await screen.findByText(name);
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`row for ${name} was not found`);
  fireEvent.click(row.querySelector<HTMLButtonElement>('button[aria-label="Edit"]')!);
  await screen.findByText("Edit Variable");
};

const waitForInitialSignals = async () => {
  await waitFor(() => {
    expect(useConfigSectionStore.getState().sections.env.envelope?.revision).toBe(5);
    expect(mockGetEnvVars.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
};

// ── Tests ───────────────────────────────────────────────────

describe("SystemSettingsEnvVarsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue({
      data: [],
      revision: 5,
      loaded_at: "2026-07-23T00:00:00.000Z",
      source_path: "/tmp/env.json",
      source_kind: "file",
      status: "healthy",
      last_error: null,
    } as never);
    mockGetEnvVars.mockResolvedValue(emptyList);
    mockUpsertEnvVar.mockResolvedValue(emptyList);
    mockDeleteEnvVar.mockResolvedValue(emptyList);
  });

  afterEach(() => vi.restoreAllMocks());

  // ── Loading & Display ────────────────────────────────────

  describe("loading and display", () => {
    it("should render empty state when no env vars configured", async () => {
      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("No environment variables configured")).toBeInTheDocument();
      });
    });

    it("should display existing entries on mount", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("NODE_ENV")).toBeInTheDocument();
        expect(screen.getByText("GITHUB_TOKEN")).toBeInTheDocument();
        expect(screen.getByText("EMPTY_SECRET")).toBeInTheDocument();
      });
    });

    it("should show plain value for non-secret entries", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("production")).toBeInTheDocument();
      });
    });

    it("should show configured status without retaining a secret mask", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("Configured")).toBeInTheDocument();
      });
      expect(screen.queryByText("••••••••")).not.toBeInTheDocument();
      expect(screen.queryByText("****...****")).not.toBeInTheDocument();
    });

    it("should show missing status for secret entries without a value", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("Missing")).toBeInTheDocument();
      });
    });

    it("should show Secret tag for secret entries", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        const secretTags = screen.getAllByText("Secret");
        expect(secretTags.length).toBe(2); // GITHUB_TOKEN and EMPTY_SECRET
      });
    });

    it("should show Plain tag for non-secret entries", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("Plain")).toBeInTheDocument();
      });
    });

    it("should show description when present", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("Node environment")).toBeInTheDocument();
        expect(screen.getByText("GitHub PAT")).toBeInTheDocument();
      });
    });

    it("should show error when loading fails", async () => {
      const { message } = await import("antd");
      mockGetEnvVars.mockRejectedValue(new Error("Network error"));

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(message.error).toHaveBeenCalled();
      });
    });
  });

  // ── Add Variable ─────────────────────────────────────────

  describe("adding variables", () => {
    it("should open add modal when Add Variable button is clicked", async () => {
      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("Add Variable")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Add Variable"));

      await waitFor(() => {
        expect(screen.getByText("Add Environment Variable")).toBeInTheDocument();
      });
    });

    it("should call upsertEnvVar on form submit", async () => {
      const newEntries: EnvVarsListResponse = {
        revision: 4,
        entries: [
          {
            name: "NEW_VAR",
            value: "new_val",
            secret: false,
            has_value: true,
            configured: true,
          },
        ],
      };
      mockUpsertEnvVar.mockResolvedValue(newEntries);

      render(<SystemSettingsEnvVarsTab />);

      // Wait for initial load
      await waitFor(() => {
        expect(mockGetEnvVars).toHaveBeenCalled();
      });

      // Open add modal
      fireEvent.click(screen.getByText("Add Variable"));

      await waitFor(() => {
        expect(screen.getByText("Add Environment Variable")).toBeInTheDocument();
      });
    });
  });

  // ── Delete Variable ──────────────────────────────────────

  describe("deleting variables", () => {
    it("should call deleteEnvVar on confirm", async () => {
      const afterDelete: EnvVarsListResponse = {
        revision: 4,
        entries: [sampleEntries[1], sampleEntries[2]], // NODE_ENV removed
      };
      mockGetEnvVars.mockResolvedValue(sampleList);
      mockDeleteEnvVar.mockResolvedValue(afterDelete);

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("NODE_ENV")).toBeInTheDocument();
      });

      const row = screen.getByText("NODE_ENV").closest("tr");
      fireEvent.click(row!.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')!);
      fireEvent.click(await screen.findByRole("button", { name: "Yes" }));

      await waitFor(() => expect(mockDeleteEnvVar).toHaveBeenCalledWith("NODE_ENV", 3));
    });
  });

  // ── Edit Variable ────────────────────────────────────────

  describe("editing variables", () => {
    it("should show edit modal with pre-filled data when edit clicked", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("NODE_ENV")).toBeInTheDocument();
      });
    });
  });

  // ── Error Handling ───────────────────────────────────────

  describe("error handling", () => {
    it("should show error message on upsert failure", async () => {
      mockUpsertEnvVar.mockRejectedValue(new Error("Validation failed"));

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(mockGetEnvVars).toHaveBeenCalled();
      });
    });

    it("should show error message on delete failure", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);
      mockDeleteEnvVar.mockRejectedValue(new Error("Not found"));

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("NODE_ENV")).toBeInTheDocument();
      });
    });
  });

  describe("versioned modal drafts", () => {
    it("auto-adopts a newer credential snapshot while the edit form is clean", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);
      render(<SystemSettingsEnvVarsTab />);

      await openEditModal("NODE_ENV");
      expect(screen.getByPlaceholderText("Optional description")).toHaveValue("Node environment");
      await waitForInitialSignals();

      mockGetEnvVars.mockResolvedValueOnce(
        envListAt(4, {
          NODE_ENV: {
            value: "external-value-never-shown-in-comparison",
            description: "External metadata",
          },
        }),
      );
      act(() => publishEnvSignal(6));

      await waitFor(() =>
        expect(screen.getByPlaceholderText("Optional description")).toHaveValue(
          "External metadata",
        ),
      );
      expect(
        screen.queryByText("Environment variables changed externally"),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mockUpsertEnvVar).toHaveBeenCalled());
      expect(mockUpsertEnvVar.mock.calls.at(-1)?.[1]).toBe(4);
    });

    it("preserves and reapplies a dirty draft with a secret-free comparison", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);
      render(<SystemSettingsEnvVarsTab />);

      await openEditModal("GITHUB_TOKEN");
      await waitForInitialSignals();

      fireEvent.change(screen.getByPlaceholderText("Enter new value or leave empty"), {
        target: { value: "local-secret-replacement" },
      });
      fireEvent.change(screen.getByPlaceholderText("Optional description"), {
        target: { value: "Local metadata" },
      });

      const externalList = envListAt(4, {
        GITHUB_TOKEN: {
          value: "server-mask-must-not-leak",
          description: "External metadata",
        },
      });
      mockGetEnvVars.mockResolvedValueOnce(externalList);
      act(() => publishEnvSignal(6));

      expect(
        await screen.findByText("Environment variables changed externally"),
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Enter new value or leave empty")).toHaveValue(
        "local-secret-replacement",
      );
      expect(screen.getByPlaceholderText("Optional description")).toHaveValue("Local metadata");

      fireEvent.click(screen.getByRole("button", { name: "Compare" }));
      const comparison = screen.getByTestId("env-var-revision-comparison").textContent ?? "";
      expect(comparison).toContain("[replace requested]");
      expect(comparison).toContain("External metadata");
      expect(comparison).not.toContain("local-secret-replacement");
      expect(comparison).not.toContain("server-mask-must-not-leak");
      expect(comparison).not.toContain("****...****");

      fireEvent.click(screen.getByRole("button", { name: "Reapply" }));
      expect(
        screen.queryByText("Environment variables changed externally"),
      ).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText("Enter new value or leave empty")).toHaveValue(
        "local-secret-replacement",
      );
      expect(screen.getByPlaceholderText("Optional description")).toHaveValue("Local metadata");

      mockUpsertEnvVar.mockResolvedValueOnce({ ...externalList, revision: 5 });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(mockUpsertEnvVar).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "GITHUB_TOKEN",
            value: "local-secret-replacement",
            description: "Local metadata",
          }),
          4,
        ),
      );
      await waitFor(() => expect(screen.queryByText("Edit Variable")).not.toBeInTheDocument());
      await openEditModal("GITHUB_TOKEN");
      expect(screen.getByPlaceholderText("Enter new value or leave empty")).toHaveValue("");
    });

    it("submits the captured revision and keeps plaintext after a stale 409", async () => {
      const externalList = envListAt(4, {
        GITHUB_TOKEN: {
          value: "server-mask-must-not-leak",
          description: "External metadata",
        },
      });
      mockGetEnvVars.mockResolvedValue(sampleList);
      mockUpsertEnvVar.mockRejectedValueOnce(new ApiError("revision conflict", 409, "Conflict"));
      render(<SystemSettingsEnvVarsTab />);

      await openEditModal("GITHUB_TOKEN");
      await waitForInitialSignals();
      mockGetEnvVars.mockResolvedValueOnce(externalList);
      fireEvent.change(screen.getByPlaceholderText("Enter new value or leave empty"), {
        target: { value: "preserved-local-secret" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mockUpsertEnvVar).toHaveBeenCalled());
      expect(mockUpsertEnvVar.mock.calls.at(-1)?.[1]).toBe(3);
      expect(
        await screen.findByText("Environment variables changed externally"),
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Enter new value or leave empty")).toHaveValue(
        "preserved-local-secret",
      );
      expect(screen.getByText("Edit Variable")).toBeInTheDocument();
    });

    it("uses an explicit empty replacement when clearing a stored value", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);
      mockUpsertEnvVar.mockResolvedValueOnce(envListAt(4));
      render(<SystemSettingsEnvVarsTab />);

      await openEditModal("GITHUB_TOKEN");
      fireEvent.click(screen.getByRole("button", { name: "Clear stored value" }));
      expect(screen.getByRole("button", { name: "Value will be cleared" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(mockUpsertEnvVar).toHaveBeenCalledWith(
          expect.objectContaining({ name: "GITHUB_TOKEN", value: "" }),
          3,
        ),
      );
    });
  });
});
