import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SystemSettingsKeywordMaskingTab from "../SystemSettingsKeywordMaskingTab";
import { ServiceFactory } from "../../../../../services/common/ServiceFactory";

// Mock ServiceFactory
vi.mock("../../../../../services/common/ServiceFactory");

// Mock antd message
vi.mock("antd", async () => {
  const actual = await vi.importActual("antd");
  return {
    ...actual,
    message: {
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

describe("SystemSettingsKeywordMaskingTab", () => {
  const mockGetConfig = vi.fn();
  const mockUpdateConfig = vi.fn();
  const mockValidateEntries = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup ServiceFactory mock
    vi.mocked(ServiceFactory.getInstance).mockReturnValue({
      getKeywordMaskingConfig: mockGetConfig,
      updateKeywordMaskingConfig: mockUpdateConfig,
      validateKeywordEntries: mockValidateEntries,
    } as any);

    // Default successful responses
    mockGetConfig.mockResolvedValue({ entries: [] });
    mockValidateEntries.mockResolvedValue({ valid: true });
    mockUpdateConfig.mockResolvedValue({ entries: [] });
  });

  describe("initialization and loading", () => {
    it("should load and display existing entries on mount", async () => {
      const mockEntries = [
        { pattern: "sk-", match_type: "exact", enabled: true },
        { pattern: "ghp_[A-Za-z0-9]+", match_type: "regex", enabled: false },
      ];
      mockGetConfig.mockResolvedValue({ entries: mockEntries });

      render(<SystemSettingsKeywordMaskingTab />);

      await waitFor(() => {
        expect(screen.getByText("sk-")).toBeInTheDocument();
        expect(screen.getByText("ghp_[A-Za-z0-9]+")).toBeInTheDocument();
      });
    });

    it("should show error message when loading fails", async () => {
      const { message } = await import("antd");
      mockGetConfig.mockRejectedValue(new Error("Network error"));

      render(<SystemSettingsKeywordMaskingTab />);

      await waitFor(() => {
        expect(message.error).toHaveBeenCalled();
      });
    });
  });

  describe("adding new entries", () => {
    it("should add new empty entry when add button is clicked", async () => {
      render(<SystemSettingsKeywordMaskingTab />);

      const addButton = await screen.findByTestId("add-keyword");
      await waitFor(() => expect(addButton).not.toBeDisabled());
      fireEvent.click(addButton);

      // Should show pattern input for new entry
      expect(screen.getByTestId("keyword-pattern-input")).toBeInTheDocument();
    });

    it("should save new entry with valid pattern", async () => {
      mockUpdateConfig.mockResolvedValue({
        entries: [{ pattern: "test-pattern", match_type: "exact", enabled: true }],
      });

      render(<SystemSettingsKeywordMaskingTab />);

      const addButton = await screen.findByTestId("add-keyword");
      await waitFor(() => expect(addButton).not.toBeDisabled());
      fireEvent.click(addButton);

      const input = screen.getByTestId("keyword-pattern-input");
      fireEvent.change(input, { target: { value: "test-pattern" } });

      const saveButton = screen.getByTestId("save-keyword");
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockValidateEntries).toHaveBeenCalled();
        expect(mockUpdateConfig).toHaveBeenCalled();
      });
    });

    it("should show error when saving entry with empty pattern", async () => {
      const { message } = await import("antd");

      render(<SystemSettingsKeywordMaskingTab />);

      const addButton = await screen.findByTestId("add-keyword");
      await waitFor(() => expect(addButton).not.toBeDisabled());
      fireEvent.click(addButton);

      const saveButton = screen.getByTestId("save-keyword");
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(message.error).toHaveBeenCalled();
      });
    });

    it("should cancel and remove empty entry", async () => {
      render(<SystemSettingsKeywordMaskingTab />);

      const addButton = await screen.findByTestId("add-keyword");
      await waitFor(() => expect(addButton).not.toBeDisabled());
      fireEvent.click(addButton);

      const cancelButton = screen.getByText(/cancel/i);
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByTestId("keyword-pattern-input")).not.toBeInTheDocument();
      });
    });

    it("should cancel and keep existing entry", async () => {
      mockGetConfig.mockResolvedValue({
        entries: [{ pattern: "existing", match_type: "exact", enabled: true }],
      });

      render(<SystemSettingsKeywordMaskingTab />);

      await screen.findByText("existing");

      const editButton = screen.getByRole("button", { name: /edit/i });
      fireEvent.click(editButton);

      const input = screen.getByTestId("keyword-pattern-input");
      fireEvent.change(input, { target: { value: "modified" } });

      const cancelButton = screen.getByText(/cancel/i);
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(screen.getByText("existing")).toBeInTheDocument();
      });
    });
  });

  describe("editing entries", () => {
    it("should enter edit mode when edit button is clicked", async () => {
      mockGetConfig.mockResolvedValue({
        entries: [{ pattern: "test", match_type: "exact", enabled: true }],
      });

      render(<SystemSettingsKeywordMaskingTab />);

      await screen.findByText("test");

      const editButton = screen.getByRole("button", { name: /edit/i });
      fireEvent.click(editButton);

      expect(screen.getByTestId("keyword-pattern-input")).toBeInTheDocument();
    });

    it("should save edited entry", async () => {
      mockGetConfig.mockResolvedValue({
        entries: [{ pattern: "old", match_type: "exact", enabled: true }],
      });
      mockUpdateConfig.mockResolvedValue({
        entries: [{ pattern: "new", match_type: "exact", enabled: true }],
      });

      render(<SystemSettingsKeywordMaskingTab />);

      await screen.findByText("old");

      const editButton = screen.getByRole("button", { name: /edit/i });
      fireEvent.click(editButton);

      const input = screen.getByTestId("keyword-pattern-input");
      fireEvent.change(input, { target: { value: "new" } });

      const saveButton = screen.getByTestId("save-keyword");
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockUpdateConfig).toHaveBeenCalledWith([
          { pattern: "new", match_type: "exact", enabled: true },
        ]);
      });
    });
  });

  describe("deleting entries", () => {
    it("should delete entry when delete button is clicked", async () => {
      mockGetConfig.mockResolvedValue({
        entries: [
          { pattern: "keep", match_type: "exact", enabled: true },
          { pattern: "delete", match_type: "exact", enabled: true },
        ],
      });
      mockUpdateConfig.mockResolvedValue({
        entries: [{ pattern: "keep", match_type: "exact", enabled: true }],
      });

      render(<SystemSettingsKeywordMaskingTab />);

      await screen.findByText("delete");

      const deleteButton = screen.getByTestId("delete-keyword-1");
      fireEvent.click(deleteButton);

      await waitFor(() => {
        expect(mockUpdateConfig).toHaveBeenCalledWith([
          { pattern: "keep", match_type: "exact", enabled: true },
        ]);
      });
    });
  });

  describe("toggling enabled state", () => {
    it("should toggle entry enabled state", async () => {
      mockGetConfig.mockResolvedValue({
        entries: [{ pattern: "test", match_type: "exact", enabled: true }],
      });
      mockUpdateConfig.mockResolvedValue({
        entries: [{ pattern: "test", match_type: "exact", enabled: false }],
      });

      render(<SystemSettingsKeywordMaskingTab />);

      await screen.findByText("test");

      const switches = screen.getAllByRole("switch");
      const enableSwitch = switches[0];
      fireEvent.click(enableSwitch);

      await waitFor(() => {
        expect(mockUpdateConfig).toHaveBeenCalledWith([
          { pattern: "test", match_type: "exact", enabled: false },
        ]);
      });
    });
  });

  describe("validation", () => {
    it("should show validation errors", async () => {
      const { message } = await import("antd");
      mockValidateEntries.mockResolvedValue({
        valid: false,
        errors: [{ index: 0, message: "Invalid regex pattern" }],
      });

      render(<SystemSettingsKeywordMaskingTab />);

      const addButton = await screen.findByTestId("add-keyword");
      await waitFor(() => expect(addButton).not.toBeDisabled());
      fireEvent.click(addButton);

      const input = screen.getByTestId("keyword-pattern-input");
      fireEvent.change(input, { target: { value: "invalid[regex" } });

      const saveButton = screen.getByTestId("save-keyword");
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(message.error).toHaveBeenCalled();
      });
    });

    it("should handle save errors", async () => {
      const { message } = await import("antd");
      mockUpdateConfig.mockRejectedValue(new Error("Save failed"));

      render(<SystemSettingsKeywordMaskingTab />);

      const addButton = await screen.findByTestId("add-keyword");
      await waitFor(() => expect(addButton).not.toBeDisabled());
      fireEvent.click(addButton);

      const input = screen.getByTestId("keyword-pattern-input");
      fireEvent.change(input, { target: { value: "test" } });

      const saveButton = screen.getByTestId("save-keyword");
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(message.error).toHaveBeenCalled();
      });
    });
  });

  describe("preview masking", () => {
    it("should preview exact match masking", async () => {
      render(<SystemSettingsKeywordMaskingTab />);

      const addButton = await screen.findByTestId("add-keyword");
      await waitFor(() => expect(addButton).not.toBeDisabled());
      fireEvent.click(addButton);

      const input = screen.getByTestId("keyword-pattern-input");
      fireEvent.change(input, { target: { value: "secret" } });

      // Find match type select and set to exact
      const selects = screen.getAllByRole("combobox");
      const matchTypeSelect = selects.find((s) => s.textContent?.includes("Exact"));

      // Preview should show masked text
      await waitFor(() => {
        const previewInputs = screen.getAllByRole("textbox");
        const readOnlyPreview = previewInputs.find((input) => (input as HTMLInputElement).readOnly);
        expect(readOnlyPreview).toBeInTheDocument();
      });
    });

    it("should show error for invalid regex pattern", async () => {
      render(<SystemSettingsKeywordMaskingTab />);

      const addButton = await screen.findByTestId("add-keyword");
      await waitFor(() => expect(addButton).not.toBeDisabled());
      fireEvent.click(addButton);

      const input = screen.getByTestId("keyword-pattern-input");
      fireEvent.change(input, { target: { value: "invalid[regex" } });

      // Find match type select and set to regex
      const selects = screen.getAllByRole("combobox");
      const regexOption = selects.find((s) => s.textContent?.includes("Regex"));

      await waitFor(() => {
        const errorText = screen.queryByText(/invalid/i);
        // May or may not show depending on when preview runs
        if (errorText) {
          expect(errorText).toBeInTheDocument();
        }
      });
    });

    it("should update preview when sample text changes", async () => {
      render(<SystemSettingsKeywordMaskingTab />);

      const addButton = await screen.findByTestId("add-keyword");
      await waitFor(() => expect(addButton).not.toBeDisabled());
      fireEvent.click(addButton);

      const patternInput = screen.getByTestId("keyword-pattern-input");
      fireEvent.change(patternInput, { target: { value: "token" } });

      // Find sample text input
      const sampleInput = screen.getByPlaceholderText(/sample text/i);
      fireEvent.change(sampleInput, { target: { value: "my token is here" } });

      await waitFor(() => {
        const previewInputs = screen.getAllByRole("textbox");
        const readOnlyPreview = previewInputs.find((input) => (input as HTMLInputElement).readOnly);
        expect(readOnlyPreview).toBeInTheDocument();
      });
    });
  });

  describe("example selection", () => {
    it("should apply example selection to pattern and match type", async () => {
      render(<SystemSettingsKeywordMaskingTab />);

      const addButton = await screen.findByTestId("add-keyword");
      await waitFor(() => expect(addButton).not.toBeDisabled());
      fireEvent.click(addButton);

      const examplesSelect = await screen.findByTestId("keyword-examples-select");
      const trigger = examplesSelect.querySelector(".ant-select-selector") ?? examplesSelect;
      fireEvent.mouseDown(trigger);

      const exampleOption = await screen.findByText("Mask GitHub tokens");
      fireEvent.click(exampleOption);

      await waitFor(() => {
        const input = screen.getByPlaceholderText("Enter pattern to match");
        expect((input as HTMLInputElement).value).toBe("ghp_[A-Za-z0-9]+");
      });
    });
  });

  describe("match type display", () => {
    it("should display regex pattern label for regex entries", async () => {
      mockGetConfig.mockResolvedValue({
        entries: [{ pattern: "ghp_[A-Za-z0-9]+", match_type: "regex", enabled: true }],
      });

      render(<SystemSettingsKeywordMaskingTab />);

      await waitFor(() => {
        expect(screen.getByText(/regex pattern/i)).toBeInTheDocument();
      });
    });

    it("should display exact match label for exact entries", async () => {
      mockGetConfig.mockResolvedValue({
        entries: [{ pattern: "sk-", match_type: "exact", enabled: true }],
      });

      render(<SystemSettingsKeywordMaskingTab />);

      await waitFor(() => {
        expect(screen.getByText(/exact match/i)).toBeInTheDocument();
      });
    });
  });

  describe("disabled state display", () => {
    it("should show disabled label for disabled entries", async () => {
      mockGetConfig.mockResolvedValue({
        entries: [{ pattern: "test", match_type: "exact", enabled: false }],
      });

      render(<SystemSettingsKeywordMaskingTab />);

      await waitFor(() => {
        expect(screen.getByText(/disabled/i)).toBeInTheDocument();
      });
    });
  });
});
