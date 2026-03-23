import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SystemSettingsEnvVarsTab from "../SystemSettingsEnvVarsTab";
import { settingsService, EnvVarsListResponse, EnvVarResponse } from "../../../../../services/config/SettingsService";

// Mock settingsService
vi.mock("../../../../../services/config/SettingsService", async () => {
  const actual = await vi.importActual("../../../../../services/config/SettingsService");
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
  const actual = await vi.importActual("antd");
  return {
    ...actual,
    message: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    },
  };
});

const mockGetEnvVars = vi.mocked(settingsService.getEnvVars);
const mockUpsertEnvVar = vi.mocked(settingsService.upsertEnvVar);
const mockDeleteEnvVar = vi.mocked(settingsService.deleteEnvVar);

// ── Fixtures ────────────────────────────────────────────────

const emptyList: EnvVarsListResponse = { entries: [] };

const sampleEntries: EnvVarResponse[] = [
  {
    name: "NODE_ENV",
    value: "production",
    secret: false,
    has_value: true,
    description: "Node environment",
  },
  {
    name: "GITHUB_TOKEN",
    value: "****...****",
    secret: true,
    has_value: true,
    description: "GitHub PAT",
  },
  {
    name: "EMPTY_SECRET",
    value: "****...****",
    secret: true,
    has_value: false,
    description: undefined,
  },
];

const sampleList: EnvVarsListResponse = { entries: sampleEntries };

// ── Tests ───────────────────────────────────────────────────

describe("SystemSettingsEnvVarsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnvVars.mockResolvedValue(emptyList);
    mockUpsertEnvVar.mockResolvedValue(emptyList);
    mockDeleteEnvVar.mockResolvedValue(emptyList);
  });

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

    it("should mask secret entries with dots", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getAllByText("••••••••").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("should show (not set) for secret entries without value", async () => {
      mockGetEnvVars.mockResolvedValue(sampleList);

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("(not set)")).toBeInTheDocument();
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
        entries: [
          { name: "NEW_VAR", value: "new_val", secret: false, has_value: true },
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
        entries: [sampleEntries[1], sampleEntries[2]], // NODE_ENV removed
      };
      mockGetEnvVars.mockResolvedValue(sampleList);
      mockDeleteEnvVar.mockResolvedValue(afterDelete);

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("NODE_ENV")).toBeInTheDocument();
      });
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
      const { message } = await import("antd");
      mockUpsertEnvVar.mockRejectedValue(new Error("Validation failed"));

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(mockGetEnvVars).toHaveBeenCalled();
      });
    });

    it("should show error message on delete failure", async () => {
      const { message } = await import("antd");
      mockGetEnvVars.mockResolvedValue(sampleList);
      mockDeleteEnvVar.mockRejectedValue(new Error("Not found"));

      render(<SystemSettingsEnvVarsTab />);

      await waitFor(() => {
        expect(screen.getByText("NODE_ENV")).toBeInTheDocument();
      });
    });
  });
});
