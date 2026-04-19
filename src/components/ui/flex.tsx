import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * antd-compatible <Flex> replacement using Tailwind flex utilities.
 * Supports: vertical, gap (number | 'small'|'middle'|'large'), justify, align, wrap, flex.
 */

type FlexGap = number | "small" | "middle" | "large";

export interface FlexProps extends React.HTMLAttributes<HTMLDivElement> {
  vertical?: boolean;
  gap?: FlexGap;
  justify?:
    | "flex-start"
    | "flex-end"
    | "center"
    | "space-between"
    | "space-around"
    | "space-evenly"
    | "start"
    | "end";
  align?: "flex-start" | "flex-end" | "center" | "baseline" | "stretch" | "start" | "end";
  wrap?: boolean | "wrap" | "nowrap" | "wrap-reverse";
  flex?: string | number;
  component?: keyof React.JSX.IntrinsicElements;
}

const gapToPx = (g: FlexGap | undefined): number | undefined => {
  if (g === undefined) return undefined;
  if (typeof g === "number") return g;
  if (g === "small") return 8;
  if (g === "large") return 24;
  return 16; // middle
};

const justifyMap: Record<NonNullable<FlexProps["justify"]>, string> = {
  "flex-start": "justify-start",
  start: "justify-start",
  "flex-end": "justify-end",
  end: "justify-end",
  center: "justify-center",
  "space-between": "justify-between",
  "space-around": "justify-around",
  "space-evenly": "justify-evenly",
};

const alignMap: Record<NonNullable<FlexProps["align"]>, string> = {
  "flex-start": "items-start",
  start: "items-start",
  "flex-end": "items-end",
  end: "items-end",
  center: "items-center",
  baseline: "items-baseline",
  stretch: "items-stretch",
};

export const Flex = React.forwardRef<HTMLDivElement, FlexProps>(
  (
    {
      className,
      vertical = false,
      gap,
      justify,
      align,
      wrap,
      flex,
      component,
      style,
      children,
      ...rest
    },
    ref,
  ) => {
    const Comp = (component || "div") as React.ElementType;
    const wrapClass =
      wrap === true || wrap === "wrap"
        ? "flex-wrap"
        : wrap === "wrap-reverse"
          ? "flex-wrap-reverse"
          : wrap === "nowrap"
            ? "flex-nowrap"
            : "";
    const gapPx = gapToPx(gap);
    return (
      <Comp
        ref={ref}
        className={cn(
          "flex",
          vertical ? "flex-col" : "flex-row",
          justify && justifyMap[justify],
          align && alignMap[align],
          wrapClass,
          className,
        )}
        style={{
          ...(gapPx !== undefined ? { gap: gapPx } : {}),
          ...(flex !== undefined ? { flex } : {}),
          ...style,
        }}
        {...rest}
      >
        {children}
      </Comp>
    );
  },
);
Flex.displayName = "Flex";

export default Flex;
