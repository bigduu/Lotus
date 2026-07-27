import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type Layout = "horizontal" | "vertical";

export type ResizableSplitProps = {
  layout: Layout;
  first: React.ReactNode;
  second: React.ReactNode;
  /**
   * Persisted pixel sizes: [firstPx, secondPx].
   * If omitted, the split defaults to `defaultSplitRatio`.
   */
  sizesPx?: [number, number] | null;
  defaultSplitRatio?: number; // 0..1
  minFirstPx?: number;
  minSecondPx?: number;
  /**
   * Optional absolute upper bound (px) on the SECOND pane. Capping the second
   * pane keeps an auxiliary panel (e.g. the inspector) from ever growing larger
   * than the primary first pane.
   */
  maxSecondPx?: number;
  /**
   * Optional upper bound on the SECOND pane as a fraction (0..1) of the
   * container along the split axis. Applied together with `maxSecondPx` (the
   * smaller of the two wins) and adapts as the container resizes.
   */
  maxSecondFraction?: number;
  handleSizePx?: number;
  disabled?: boolean;
  onResizeEnd?: (sizes: [number, number]) => void;
  style?: React.CSSProperties;
  className?: string;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const getAxisSize = (el: HTMLElement, layout: Layout): number =>
  layout === "horizontal" ? el.clientWidth : el.clientHeight;

const getSplitBounds = (
  containerSize: number,
  minFirstPx: number,
  minSecondPx: number,
  maxSecondPx?: number,
  maxSecondFraction?: number,
): {
  minFirst: number;
  maxFirst: number;
  appliedMinFirst: number;
  appliedMinSecond: number;
} => {
  const safeContainerSize = Math.max(0, Math.round(containerSize));
  const safeMinFirstPx = Math.max(0, Math.round(minFirstPx));
  const safeMinSecondPx = Math.max(0, Math.round(minSecondPx));

  // If both min constraints cannot be satisfied, relax them so both panes
  // remain visible instead of clipping one pane out of view.
  if (safeMinFirstPx + safeMinSecondPx > safeContainerSize) {
    return {
      minFirst: 0,
      maxFirst: safeContainerSize,
      appliedMinFirst: 0,
      appliedMinSecond: 0,
    };
  }

  // Optional upper bound on the SECOND pane — absolute px and/or a fraction of
  // the container, whichever is smaller. Capping the second pane is equivalent
  // to raising the first pane's lower bound, which is how an auxiliary panel
  // (e.g. the inspector) is kept from ever overgrowing the primary pane.
  const secondCapPx = Math.min(
    Number.isFinite(maxSecondPx as number) ? (maxSecondPx as number) : Number.POSITIVE_INFINITY,
    maxSecondFraction && maxSecondFraction > 0
      ? safeContainerSize * maxSecondFraction
      : Number.POSITIVE_INFINITY,
  );

  const maxFirst = safeContainerSize - safeMinSecondPx;
  let minFirst = safeMinFirstPx;
  if (Number.isFinite(secondCapPx)) {
    minFirst = Math.max(minFirst, Math.ceil(safeContainerSize - secondCapPx));
  }
  // On a very narrow container the raised lower bound can cross the upper bound
  // and invert the range. Fall back to a centered split (chat ≥ inspector)
  // rather than the hard minimum so the primary pane still wins.
  if (minFirst > maxFirst) {
    minFirst = Math.min(maxFirst, Math.max(safeMinFirstPx, Math.floor(safeContainerSize / 2)));
  }

  return {
    minFirst,
    maxFirst,
    appliedMinFirst: safeMinFirstPx,
    appliedMinSecond: safeMinSecondPx,
  };
};

export const ResizableSplit: React.FC<ResizableSplitProps> = ({
  layout,
  first,
  second,
  sizesPx,
  defaultSplitRatio = 0.5,
  minFirstPx = 0,
  minSecondPx = 0,
  maxSecondPx,
  maxSecondFraction,
  handleSizePx = 6,
  disabled = false,
  onResizeEnd,
  style,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{
    pointerId: number;
    startPos: number;
    startFirstPx: number;
    containerSize: number;
  } | null>(null);

  // During dragging we update only local state to keep it responsive.
  const [liveFirstPx, setLiveFirstPx] = useState<number | null>(null);
  const [containerSize, setContainerSize] = useState(0);
  const [computedSplitRatio, setComputedSplitRatio] = useState<number | null>(null);

  const persistedFirstPx = useMemo(() => {
    if (!sizesPx) return null;
    const v = Number(sizesPx[0]);
    return Number.isFinite(v) ? v : null;
  }, [sizesPx]);

  const persistedSecondPx = useMemo(() => {
    if (!sizesPx) return null;
    const v = Number(sizesPx[1]);
    return Number.isFinite(v) ? v : null;
  }, [sizesPx]);

  const persistedSplitRatio = useMemo(() => {
    if (!sizesPx) return null;
    const first = Number(sizesPx[0]);
    const second = Number(sizesPx[1]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
    const total = first + second;
    // When either pane is being persisted as an absolute pixel width
    // (sidebar => [width, 0], collapsed sidebar => [0, 0], inspector => [0, width])
    // we should not derive a ratio.
    if (total <= 0 || first <= 0 || second <= 0) return null;
    return clamp(first / total, 0, 1);
  }, [sizesPx]);

  const absoluteFirstPanePx = useMemo(() => {
    if (persistedFirstPx === null || persistedSecondPx === null) return null;
    // Treat `[width, 0]` and `[0, 0]` as an explicit first-pane width.
    // A persisted zero is a real "fully collapsed" signal, not "unset".
    return persistedSecondPx <= 0 ? Math.max(0, persistedFirstPx) : null;
  }, [persistedFirstPx, persistedSecondPx]);

  const absoluteSecondPanePx = useMemo(() => {
    if (persistedFirstPx === null || persistedSecondPx === null) return null;
    return persistedSecondPx > 0 && persistedFirstPx <= 0 ? persistedSecondPx : null;
  }, [persistedFirstPx, persistedSecondPx]);

  // Measure the container so split sizes can adapt when the window changes.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerSize(getAxisSize(el, layout));
  }, [layout]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const syncContainerSize = () => {
      const nextSize = getAxisSize(el, layout);
      setContainerSize((prev) => (prev === nextSize ? prev : nextSize));
    };
    syncContainerSize();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(syncContainerSize);
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", syncContainerSize);
    return () => window.removeEventListener("resize", syncContainerSize);
  }, [layout]);

  // Keep one local ratio source and sync it from persisted props when provided.
  useEffect(() => {
    if (persistedSplitRatio !== null) {
      setComputedSplitRatio(persistedSplitRatio);
      return;
    }
    setComputedSplitRatio((prev) => prev ?? clamp(defaultSplitRatio, 0.1, 0.9));
  }, [defaultSplitRatio, persistedSplitRatio]);

  const computeBounds = useCallback(
    (size: number) => getSplitBounds(size, minFirstPx, minSecondPx, maxSecondPx, maxSecondFraction),
    [minFirstPx, minSecondPx, maxSecondPx, maxSecondFraction],
  );

  const bounds = useMemo(() => computeBounds(containerSize), [computeBounds, containerSize]);

  const fallbackRatio = clamp(defaultSplitRatio, 0.1, 0.9);
  const sourceRatio = computedSplitRatio ?? fallbackRatio;
  const ratioFirstPx = containerSize > 0 ? Math.round(containerSize * sourceRatio) : null;
  // When a valid ratio was derived from props (both sizesPx values > 0),
  // prefer the ratio so the split adapts to container resizes.
  // Otherwise prefer an absolute first-pane width (sidebar) or an absolute
  // second-pane width (inspector rail) when provided.
  const rawFirstPx =
    liveFirstPx ??
    (persistedSplitRatio !== null ? ratioFirstPx : null) ??
    absoluteFirstPanePx ??
    (absoluteSecondPanePx !== null && containerSize > 0
      ? containerSize - absoluteSecondPanePx
      : null) ??
    ratioFirstPx ??
    0;
  const effectiveFirstPx =
    containerSize > 0
      ? clamp(rawFirstPx, bounds.minFirst, bounds.maxFirst)
      : Math.max(0, Math.round(rawFirstPx));

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      const el = containerRef.current;
      if (!el) return;

      e.preventDefault();
      e.stopPropagation();

      const axisPos = layout === "horizontal" ? e.clientX : e.clientY;
      const containerSize = getAxisSize(el, layout);
      const nextBounds = computeBounds(containerSize);
      const startFirst = clamp(
        effectiveFirstPx || Math.round(containerSize * fallbackRatio),
        nextBounds.minFirst,
        nextBounds.maxFirst,
      );

      dragStartRef.current = {
        pointerId: e.pointerId,
        startPos: axisPos,
        startFirstPx: startFirst,
        containerSize,
      };

      try {
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture errors.
      }
    },
    [computeBounds, disabled, effectiveFirstPx, fallbackRatio, layout],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStartRef.current;
      if (!drag) return;
      if (e.pointerId !== drag.pointerId) return;

      e.preventDefault();
      e.stopPropagation();

      const axisPos = layout === "horizontal" ? e.clientX : e.clientY;
      const delta = axisPos - drag.startPos;

      const size = drag.containerSize;
      const nextBounds = computeBounds(size);
      const nextFirst = clamp(
        Math.round(drag.startFirstPx + delta),
        nextBounds.minFirst,
        nextBounds.maxFirst,
      );
      setLiveFirstPx(nextFirst);
    },
    [computeBounds, layout],
  );

  const finishDrag = useCallback(
    (pointerId: number) => {
      const drag = dragStartRef.current;
      if (!drag || drag.pointerId !== pointerId) return;

      const el = containerRef.current;
      const size = el ? getAxisSize(el, layout) : drag.containerSize;
      const firstPx = liveFirstPx ?? drag.startFirstPx;
      const nextBounds = computeBounds(size);
      const clampedFirst = clamp(firstPx, nextBounds.minFirst, nextBounds.maxFirst);
      const secondPx = Math.max(0, size - clampedFirst);

      setLiveFirstPx(null);
      if (size > 0) {
        setComputedSplitRatio(clamp(clampedFirst / size, 0, 1));
      }
      dragStartRef.current = null;

      onResizeEnd?.([clampedFirst, secondPx]);
    },
    [computeBounds, layout, liveFirstPx, onResizeEnd],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      finishDrag(e.pointerId);
    },
    [finishDrag],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      finishDrag(e.pointerId);
    },
    [finishDrag],
  );

  // Keyboard operation for the separator (ARIA window-splitter pattern,
  // #167): Arrow keys nudge the split ±10px (Shift ±50px) and commit
  // immediately, the same outcome as a finished pointer drag.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const isHorizontal = layout === "horizontal";
      const isAdjustKey =
        (isHorizontal && (e.key === "ArrowLeft" || e.key === "ArrowRight")) ||
        (!isHorizontal && (e.key === "ArrowUp" || e.key === "ArrowDown"));
      if (!isAdjustKey) return;

      e.preventDefault();
      e.stopPropagation();

      const el = containerRef.current;
      if (!el) return;
      const size = getAxisSize(el, layout);
      if (size <= 0) return;

      const nextBounds = computeBounds(size);
      const step = e.shiftKey ? 50 : 10;
      const sign = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
      const current = clamp(
        effectiveFirstPx || Math.round(size * fallbackRatio),
        nextBounds.minFirst,
        nextBounds.maxFirst,
      );
      const clampedFirst = clamp(current + sign * step, nextBounds.minFirst, nextBounds.maxFirst);
      const secondPx = Math.max(0, size - clampedFirst);

      setComputedSplitRatio(clamp(clampedFirst / size, 0, 1));
      onResizeEnd?.([clampedFirst, secondPx]);
    },
    [computeBounds, disabled, effectiveFirstPx, fallbackRatio, layout, onResizeEnd],
  );

  const isRow = layout === "horizontal";
  const handleCursor = disabled ? "default" : isRow ? "col-resize" : "row-resize";
  const handleThickness = Math.max(0, Math.round(handleSizePx));

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        display: "flex",
        flexDirection: isRow ? "row" : "column",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        position: "relative",
        ...style,
      }}
    >
      <div
        style={{
          flex: `0 0 ${effectiveFirstPx}px`,
          minWidth: isRow ? bounds.appliedMinFirst : 0,
          minHeight: isRow ? 0 : bounds.appliedMinFirst,
          overflow: "hidden",
          display: "flex",
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            height: "100%",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {first}
        </div>
      </div>

      <div
        style={{
          flex: "1 1 auto",
          minWidth: isRow ? bounds.appliedMinSecond : 0,
          minHeight: isRow ? 0 : bounds.appliedMinSecond,
          overflow: "hidden",
          display: "flex",
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            height: "100%",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {second}
        </div>
      </div>

      {handleThickness > 0 ? (
        <div
          role="separator"
          aria-orientation={isRow ? "vertical" : "horizontal"}
          aria-valuenow={Math.round(effectiveFirstPx)}
          aria-valuemin={Math.round(bounds.minFirst)}
          aria-valuemax={Math.round(bounds.maxFirst)}
          tabIndex={disabled ? undefined : 0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onKeyDown={handleKeyDown}
          style={{
            position: "absolute",
            top: isRow ? 0 : `${effectiveFirstPx - handleThickness / 2}px`,
            left: isRow ? `${effectiveFirstPx - handleThickness / 2}px` : 0,
            width: isRow ? `${handleThickness}px` : "100%",
            height: isRow ? "100%" : `${handleThickness}px`,
            cursor: handleCursor,
            touchAction: "none",
            background: "transparent",
            zIndex: 5,
          }}
        />
      ) : null}
    </div>
  );
};
