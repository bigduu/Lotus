import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import FileReferenceSelector from ".";
import type { WorkspaceFileEntry } from "@shared/types/workspace";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const files: WorkspaceFileEntry[] = [
  { name: "main.ts", path: "/repo/main.ts", is_directory: false },
  { name: "Map", path: "/repo/Map", is_directory: true },
  { name: "readme.md", path: "/repo/readme.md", is_directory: false },
];

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

describe("FileReferenceSelector", () => {
  it("filters by prefix and supports global keyboard selection and cancellation", () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    render(
      <FileReferenceSelector
        visible
        files={files}
        searchText="ma"
        loading={false}
        onSelect={onSelect}
        onCancel={onCancel}
      />,
    );

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(screen.getByText("main.ts")).toBeInTheDocument();
    expect(screen.getByText("Map")).toBeInTheDocument();
    expect(screen.queryByText("readme.md")).not.toBeInTheDocument();
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(files[1]);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("exposes project/close actions and prioritizes errors over the result list", () => {
    const onCancel = vi.fn();
    const onChangeProject = vi.fn();
    const { rerender } = render(
      <FileReferenceSelector
        visible
        files={files}
        searchText=""
        loading={false}
        error="Workspace unavailable"
        onSelect={vi.fn()}
        onCancel={onCancel}
        onChangeProject={onChangeProject}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Workspace unavailable");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /chat\.fileReference\.setProject/ }));
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(onChangeProject).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <FileReferenceSelector
        visible={false}
        files={files}
        searchText=""
        loading={false}
        onSelect={vi.fn()}
        onCancel={onCancel}
      />,
    );
    expect(screen.queryByText("chat.fileReference.title")).not.toBeInTheDocument();
  });
});
