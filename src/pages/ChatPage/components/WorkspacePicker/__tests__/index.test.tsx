import React from "react";
import { App as AntApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WorkspacePicker from "..";

const {
  mockBrowseFolder,
  mockGetPathSuggestions,
  mockGetRecentWorkspaces,
  mockValidateWorkspaceDebounced,
} = vi.hoisted(() => ({
  mockBrowseFolder: vi.fn(),
  mockGetPathSuggestions: vi.fn(),
  mockGetRecentWorkspaces: vi.fn(),
  mockValidateWorkspaceDebounced: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@pages/ChatPage/utils/workspaceValidator", () => ({
  workspaceValidator: { validateWorkspaceDebounced: mockValidateWorkspaceDebounced },
}));

vi.mock("@pages/ChatPage/services/RecentWorkspacesManager", () => ({
  recentWorkspacesManager: { getRecentWorkspaces: mockGetRecentWorkspaces },
}));

vi.mock("@services/workspace", () => ({
  workspaceService: {
    browseFolder: mockBrowseFolder,
    getPathSuggestions: mockGetPathSuggestions,
  },
}));

vi.mock("@pages/ChatPage/components/FolderBrowser", () => ({
  FolderBrowser: ({
    visible,
    onClose,
    onSelect,
  }: {
    visible: boolean;
    onClose: () => void;
    onSelect: (path: string) => void;
  }) =>
    visible ? (
      <div data-testid="folder-browser">
        <button onClick={() => onSelect("/chosen/from-browser")}>select folder</button>
        <button onClick={onClose}>close browser</button>
      </div>
    ) : null,
}));

const renderPicker = (props: React.ComponentProps<typeof WorkspacePicker> = {}) =>
  render(
    <AntApp>
      <WorkspacePicker {...props} />
    </AntApp>,
  );

beforeEach(() => {
  mockBrowseFolder.mockReset();
  mockGetRecentWorkspaces.mockReset();
  mockGetPathSuggestions.mockReset();
  mockValidateWorkspaceDebounced.mockReset();

  mockGetRecentWorkspaces.mockResolvedValue([
    { path: "/recent/repo", workspace_name: "Recent Repo", is_valid: true },
  ]);
  mockGetPathSuggestions.mockResolvedValue({
    suggestions: [{ path: "/home/user", name: "Home", suggestion_type: "home" }],
  });
  mockValidateWorkspaceDebounced.mockImplementation(
    (_path: string, callback: (result: Record<string, unknown>) => void) => {
      callback({ is_valid: true, workspace_name: "Validated Repo", file_count: 7 });
      return vi.fn();
    },
  );
});

describe("WorkspacePicker", () => {
  it("loads choices and sends typed or selected paths through validation", async () => {
    const onChange = vi.fn();
    const onValidationChange = vi.fn();
    renderPicker({ onChange, onValidationChange });

    expect(await screen.findByText("Recent Repo")).toBeInTheDocument();
    expect(await screen.findByText("Home")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("chat.workspace.placeholder"), {
      target: { value: "  /typed/repo  " },
    });

    expect(onChange).toHaveBeenCalledWith("  /typed/repo  ");
    expect(mockValidateWorkspaceDebounced).toHaveBeenCalledWith(
      "/typed/repo",
      expect.any(Function),
    );
    expect(onValidationChange).toHaveBeenCalledWith(
      expect.objectContaining({ is_valid: true, workspace_name: "Validated Repo" }),
    );
    expect(screen.getByText("Validated Repo", { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Recent Repo"));
    expect(onChange).toHaveBeenLastCalledWith("/recent/repo");
  });

  it("opens the folder browser, applies its selection, and respects disabled controls", async () => {
    const onChange = vi.fn();
    const { rerender } = renderPicker({ onChange });

    await waitFor(() => expect(mockGetRecentWorkspaces).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText("chat.workspace.browseFolder"));
    expect(screen.getByTestId("folder-browser")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "select folder" }));
    expect(onChange).toHaveBeenLastCalledWith("/chosen/from-browser");

    rerender(
      <AntApp>
        <WorkspacePicker disabled onChange={onChange} />
      </AntApp>,
    );
    expect(screen.getByPlaceholderText("chat.workspace.placeholder")).toBeDisabled();
    expect(screen.getByLabelText("chat.workspace.browseFolder")).toBeDisabled();
  });

  it("clears validation immediately for a whitespace-only path", async () => {
    const onValidationChange = vi.fn();
    renderPicker({ onValidationChange, showRecentWorkspaces: false, showSuggestions: false });

    fireEvent.change(screen.getByPlaceholderText("chat.workspace.placeholder"), {
      target: { value: "   " },
    });

    expect(onValidationChange).toHaveBeenCalledWith(null);
    expect(mockValidateWorkspaceDebounced).not.toHaveBeenCalled();
  });
});
