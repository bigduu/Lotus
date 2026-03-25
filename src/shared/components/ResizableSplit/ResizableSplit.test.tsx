import React from "react";
import { act, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { ResizableSplit } from "./ResizableSplit";

describe("ResizableSplit", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  let width = 1200;
  let height = 800;

  beforeEach(() => {
    width = 1200;
    height = 800;

    // Force the window resize fallback path so the test can deterministically
    // drive container size changes.
    (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = undefined;

    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      originalResizeObserver;
  });

  it("recomputes persisted split from ratio when the container shrinks", () => {
    render(
      <ResizableSplit
        layout="horizontal"
        sizesPx={[600, 600]}
        minFirstPx={240}
        minSecondPx={240}
        first={<div>left</div>}
        second={<div>right</div>}
      />,
    );

    const separator = screen.getByRole("separator");
    expect(separator).toHaveStyle({ left: "597px" });

    act(() => {
      width = 800;
      window.dispatchEvent(new Event("resize"));
    });

    expect(separator).toHaveStyle({ left: "397px" });
  });

  it("relaxes min pane constraints when the container is too small", () => {
    render(
      <ResizableSplit
        layout="horizontal"
        sizesPx={[600, 600]}
        minFirstPx={240}
        minSecondPx={240}
        first={<div>left</div>}
        second={<div>right</div>}
      />,
    );

    const separator = screen.getByRole("separator");

    act(() => {
      width = 420;
      window.dispatchEvent(new Event("resize"));
    });

    expect(separator).toHaveStyle({ left: "207px" });
  });
});
