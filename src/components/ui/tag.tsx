import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * antd-compatible <Tag> replacement using Tailwind.
 * Supports: color (preset string, hex, or rgb), closable, onClose, icon, bordered, children.
 */

type PresetColor =
  | "magenta"
  | "red"
  | "volcano"
  | "orange"
  | "gold"
  | "lime"
  | "green"
  | "cyan"
  | "blue"
  | "geekblue"
  | "purple"
  | "success"
  | "processing"
  | "error"
  | "warning"
  | "default";

const presetStyles: Record<PresetColor, { bg: string; fg: string; border: string }> = {
  magenta: { bg: "rgb(255, 240, 246)", fg: "rgb(196, 29, 127)", border: "rgb(255, 173, 210)" },
  red: { bg: "rgb(255, 241, 240)", fg: "rgb(207, 19, 34)", border: "rgb(255, 163, 158)" },
  volcano: { bg: "rgb(255, 242, 232)", fg: "rgb(217, 54, 24)", border: "rgb(255, 187, 150)" },
  orange: { bg: "rgb(255, 247, 230)", fg: "rgb(212, 107, 8)", border: "rgb(255, 213, 145)" },
  gold: { bg: "rgb(255, 251, 230)", fg: "rgb(212, 160, 10)", border: "rgb(255, 229, 143)" },
  lime: { bg: "rgb(252, 255, 230)", fg: "rgb(124, 179, 5)", border: "rgb(235, 255, 139)" },
  green: { bg: "rgb(246, 255, 237)", fg: "rgb(56, 158, 13)", border: "rgb(183, 235, 143)" },
  cyan: { bg: "rgb(230, 255, 251)", fg: "rgb(8, 151, 156)", border: "rgb(135, 232, 222)" },
  blue: { bg: "rgb(230, 247, 255)", fg: "rgb(9, 88, 217)", border: "rgb(145, 202, 255)" },
  geekblue: { bg: "rgb(240, 245, 255)", fg: "rgb(29, 57, 196)", border: "rgb(173, 198, 255)" },
  purple: { bg: "rgb(249, 240, 255)", fg: "rgb(83, 29, 171)", border: "rgb(211, 173, 247)" },
  success: { bg: "rgb(246, 255, 237)", fg: "rgb(56, 158, 13)", border: "rgb(183, 235, 143)" },
  processing: { bg: "rgb(230, 247, 255)", fg: "rgb(9, 88, 217)", border: "rgb(145, 202, 255)" },
  error: { bg: "rgb(255, 241, 240)", fg: "rgb(207, 19, 34)", border: "rgb(255, 163, 158)" },
  warning: { bg: "rgb(255, 247, 230)", fg: "rgb(212, 107, 8)", border: "rgb(255, 213, 145)" },
  default: { bg: "rgb(250, 250, 250)", fg: "rgb(59, 59, 59)", border: "rgb(217, 217, 217)" },
};

export interface TagProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "onClose"> {
  color?: PresetColor | string;
  closable?: boolean;
  onClose?: (event: React.MouseEvent<HTMLSpanElement>) => void;
  icon?: React.ReactNode;
  bordered?: boolean;
  closeIcon?: React.ReactNode;
}

const isPresetColor = (c?: string): c is PresetColor =>
  !!c && Object.prototype.hasOwnProperty.call(presetStyles, c);

export const Tag = React.forwardRef<HTMLSpanElement, TagProps>(
  (
    {
      className,
      color,
      closable = false,
      onClose,
      icon,
      bordered = true,
      closeIcon,
      style,
      children,
      ...rest
    },
    ref,
  ) => {
    const preset = isPresetColor(color) ? presetStyles[color] : null;
    const customColor = color && !preset ? color : null;

    const inlineStyle: React.CSSProperties = {
      ...(preset
        ? {
            backgroundColor: preset.bg,
            color: preset.fg,
            borderColor: bordered ? preset.border : "transparent",
          }
        : customColor
          ? { backgroundColor: customColor, color: "#fff", borderColor: customColor }
          : {}),
      ...style,
    };

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs leading-5",
          bordered && "border",
          !preset && !customColor && "bg-muted text-muted-foreground border-border",
          className,
        )}
        style={inlineStyle}
        {...rest}
      >
        {icon && <span className="inline-flex shrink-0">{icon}</span>}
        <span className="truncate">{children}</span>
        {closable && (
          <span
            role="button"
            aria-label="close"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClose?.(e);
            }}
            className="ml-0.5 cursor-pointer text-current opacity-60 hover:opacity-100"
          >
            {closeIcon || "×"}
          </span>
        )}
      </span>
    );
  },
);
Tag.displayName = "Tag";

export default Tag;
