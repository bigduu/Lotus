import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * antd-compatible <Space> replacement using Tailwind flex utilities.
 * Supports: direction, size (number | 'small'|'middle'|'large'), align, wrap, split.
 */

type SpaceSize = number | "small" | "middle" | "large";

export interface SpaceProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: "horizontal" | "vertical";
  size?: SpaceSize | [SpaceSize, SpaceSize];
  align?: "start" | "end" | "center" | "baseline";
  wrap?: boolean;
  split?: React.ReactNode;
}

const sizeToPx = (s: SpaceSize | undefined): number => {
  if (typeof s === "number") return s;
  if (s === "small") return 8;
  if (s === "large") return 24;
  return 16; // middle (default)
};

const alignMap: Record<NonNullable<SpaceProps["align"]>, string> = {
  start: "items-start",
  end: "items-end",
  center: "items-center",
  baseline: "items-baseline",
};

export const Space = React.forwardRef<HTMLDivElement, SpaceProps>(
  (
    {
      className,
      direction = "horizontal",
      size = "small",
      align,
      wrap = false,
      split,
      style,
      children,
      ...rest
    },
    ref,
  ) => {
    const isVertical = direction === "vertical";
    const [hSize, vSize] = Array.isArray(size) ? size : [size, size];
    const gapPx = isVertical ? sizeToPx(vSize) : sizeToPx(hSize);

    const items = React.Children.toArray(children).filter((c) => c !== null && c !== undefined);
    const rendered = split
      ? items.flatMap((child, i) =>
          i < items.length - 1 ? [child, <React.Fragment key={`__sp_${i}`}>{split}</React.Fragment>] : [child],
        )
      : items;

    return (
      <div
        ref={ref}
        className={cn(
          "inline-flex",
          isVertical ? "flex-col" : "flex-row",
          wrap && "flex-wrap",
          align && alignMap[align],
          !align && !isVertical && "items-center",
          className,
        )}
        style={{ gap: gapPx, ...style }}
        {...rest}
      >
        {rendered}
      </div>
    );
  },
);
Space.displayName = "Space";

export default Space;
