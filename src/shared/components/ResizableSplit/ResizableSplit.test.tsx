import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

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

  it("treats a persisted zero-width first pane as collapsed instead of falling back to 50/50", () => {
    render(
      <ResizableSplit
        layout="horizontal"
        sizesPx={[0, 0]}
        minFirstPx={0}
        minSecondPx={320}
        handleSizePx={0}
        first={<div data-testid="collapsed-first-pane">left</div>}
        second={<div data-testid="full-width-second-pane">right</div>}
      />,
    );

    const firstOuterPane = screen.getByTestId("collapsed-first-pane").parentElement?.parentElement;
    expect(firstOuterPane).toHaveStyle({ flex: "0 0 0px" });
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

  it("establishes a stable flex height context for pane content", () => {
    render(
      <ResizableSplit
        layout="horizontal"
        sizesPx={[600, 600]}
        first={<div data-testid="first-pane-content">left</div>}
        second={<div data-testid="second-pane-content">right</div>}
      />,
    );

    const firstContent = screen.getByTestId("first-pane-content");
    const secondContent = screen.getByTestId("second-pane-content");
    const firstOuterPane = firstContent.parentElement?.parentElement;
    const secondOuterPane = secondContent.parentElement?.parentElement;
    const firstContentWrapper = firstContent.parentElement;
    const secondContentWrapper = secondContent.parentElement;

    expect(firstOuterPane).toHaveStyle({
      display: "flex",
      overflow: "hidden",
    });
    expect(secondOuterPane).toHaveStyle({
      display: "flex",
      overflow: "hidden",
    });

    expect(firstContentWrapper).toHaveStyle({
      display: "flex",
      flexDirection: "column",
      height: "100%",
      overflow: "hidden",
    });
    expect(secondContentWrapper).toHaveStyle({
      display: "flex",
      flexDirection: "column",
      height: "100%",
      overflow: "hidden",
    });
  });
});
