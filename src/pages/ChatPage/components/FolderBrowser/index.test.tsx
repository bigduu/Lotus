import React from "react";
import { App as AntApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FolderBrowser } from ".";

const { mockBrowseFolder } = vi.hoisted(() => ({ mockBrowseFolder: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@services/workspace", () => ({
  workspaceService: { browseFolder: mockBrowseFolder },
}));

const renderBrowser = (props: Partial<React.ComponentProps<typeof FolderBrowser>> = {}) =>
  render(
    <AntApp>
      <FolderBrowser visible onClose={vi.fn()} onSelect={vi.fn()} {...props} />
    </AntApp>,
  );

beforeEach(() => {
  mockBrowseFolder.mockReset();
});

describe("FolderBrowser", () => {
  it("loads the home folder, navigates into a child, and selects the current path", async () => {
    mockBrowseFolder.mockImplementation(async (path?: string) => {
      if (path === "/home/repo") {
        return { current_path: "/home/repo", parent_path: "/home", folders: [] };
      }
      return {
        current_path: "/home",
        parent_path: "/",
        folders: [{ name: "Repo", path: "/home/repo" }],
      };
    });
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderBrowser({ onSelect, onClose });

    expect(await screen.findByText("Repo")).toBeInTheDocument();
    expect(mockBrowseFolder).toHaveBeenNthCalledWith(1, undefined);

    fireEvent.click(screen.getByRole("button", { name: /Repo/ }));
    await waitFor(() => expect(mockBrowseFolder).toHaveBeenCalledWith("/home/repo"));
    await waitFor(() => expect(screen.getAllByText("/home/repo").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: /chat\.folderBrowser\.selectCurrent/ }));
    expect(onSelect).toHaveBeenCalledWith("/home/repo");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports browse failures through the application message surface", async () => {
    mockBrowseFolder.mockRejectedValue(new Error("permission denied"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderBrowser();

    expect(await screen.findByText("chat.folderBrowser.readFolderError")).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalledWith(
      "chat.folderBrowser.readFolderError",
      expect.objectContaining({ message: "permission denied" }),
    );
    consoleSpy.mockRestore();
  });
});
