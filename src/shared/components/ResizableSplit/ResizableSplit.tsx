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

  return {
    minFirst: safeMinFirstPx,
    maxFirst: safeContainerSize - safeMinSecondPx,
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

  const persistedSplitRatio = useMemo(() => {
    if (!sizesPx) return null;
    const first = Number(sizesPx[0]);
    const second = Number(sizesPx[1]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
    const total = first + second;
    // When second is 0 the caller only cares about an absolute first-pane
    // pixel size (e.g. sidebar width).  Computing a ratio here would yield
    // 1.0, causing the first pane to fill the entire container on the next
    // render.  Return null so we fall back to persistedFirstPx instead.
    if (total <= 0 || second <= 0) return null;
    return clamp(first / total, 0, 1);
  }, [sizesPx]);

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

  const bounds = useMemo(
    () => getSplitBounds(containerSize, minFirstPx, minSecondPx),
    [containerSize, minFirstPx, minSecondPx],
  );

  const fallbackRatio = clamp(defaultSplitRatio, 0.1, 0.9);
  const sourceRatio = computedSplitRatio ?? fallbackRatio;
  const ratioFirstPx = containerSize > 0 ? Math.round(containerSize * sourceRatio) : null;
  // When a valid ratio was derived from props (both sizesPx values > 0),
  // prefer the ratio so the split adapts to container resizes.
  // Otherwise prefer the absolute persistedFirstPx (e.g. sidebar width).
  const rawFirstPx =
    liveFirstPx ??
    (persistedSplitRatio !== null ? ratioFirstPx : null) ??
    persistedFirstPx ??
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
      const nextBounds = getSplitBounds(containerSize, minFirstPx, minSecondPx);
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
    [disabled, effectiveFirstPx, fallbackRatio, layout, minFirstPx, minSecondPx],
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
      const nextBounds = getSplitBounds(size, minFirstPx, minSecondPx);
      const nextFirst = clamp(
        Math.round(drag.startFirstPx + delta),
        nextBounds.minFirst,
        nextBounds.maxFirst,
      );
      setLiveFirstPx(nextFirst);
    },
    [layout, minFirstPx, minSecondPx],
  );

  const finishDrag = useCallback(
    (pointerId: number) => {
      const drag = dragStartRef.current;
      if (!drag || drag.pointerId !== pointerId) return;

      const el = containerRef.current;
      const size = el ? getAxisSize(el, layout) : drag.containerSize;
      const firstPx = liveFirstPx ?? drag.startFirstPx;
      const nextBounds = getSplitBounds(size, minFirstPx, minSecondPx);
      const clampedFirst = clamp(firstPx, nextBounds.minFirst, nextBounds.maxFirst);
      const secondPx = Math.max(0, size - clampedFirst);

      setLiveFirstPx(null);
      if (size > 0) {
        setComputedSplitRatio(clamp(clampedFirst / size, 0, 1));
      }
      dragStartRef.current = null;

      onResizeEnd?.([clampedFirst, secondPx]);
    },
    [layout, liveFirstPx, minFirstPx, minSecondPx, onResizeEnd],
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
        <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>{first}</div>
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
        <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>{second}</div>
      </div>

      {handleThickness > 0 ? (
        <div
          role="separator"
          aria-orientation={isRow ? "vertical" : "horizontal"}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
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
