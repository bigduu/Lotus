import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Lightweight antd-compatible Typography primitives.
 * Drop-in replacement for `import { Typography } from "antd"`.
 *
 * Supported props (subset of antd's API):
 *   - Title: level (1-5)
 *   - Text: type ("secondary" | "success" | "warning" | "danger"), strong, italic, underline, code, mark, disabled
 *   - Paragraph: type, strong, italic, underline, disabled, ellipsis (boolean or { rows })
 *   - Link: href, target
 *
 * Not supported (gracefully ignored): copyable, editable.
 * Migrate those call-sites manually if encountered.
 */

type TextType = "secondary" | "success" | "warning" | "danger";

const typeClasses: Record<TextType, string> = {
  secondary: "text-muted-foreground",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
};

interface BaseProps {
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

interface TextProps extends BaseProps, React.HTMLAttributes<HTMLSpanElement> {
  type?: TextType;
  strong?: boolean;
  italic?: boolean;
  underline?: boolean;
  disabled?: boolean;
  code?: boolean;
  mark?: boolean;
  /** Truncate with ellipsis. antd's object form is accepted for compat (tooltip prop ignored). */
  ellipsis?: boolean | { tooltip?: React.ReactNode; rows?: number };
  /** Gracefully ignored — migrate to explicit clipboard UI if needed. */
  copyable?: unknown;
}

const Text = React.forwardRef<HTMLSpanElement, TextProps>(
  (
    {
      className,
      type,
      strong,
      italic,
      underline,
      disabled,
      code,
      mark,
      ellipsis,
      copyable: _copyable,
      children,
      style,
      ...rest
    },
    ref,
  ) => {
    if (code) {
      return (
        <code
          ref={ref as React.Ref<HTMLElement>}
          className={cn(
            "relative rounded bg-muted px-[0.35rem] py-[0.15rem] font-mono text-[0.9em]",
            className,
          )}
          {...(rest as React.HTMLAttributes<HTMLElement>)}
        >
          {children}
        </code>
      );
    }
    if (mark) {
      return (
        <mark
          className={cn("rounded bg-yellow-200 px-0.5 dark:bg-yellow-700/60", className)}
          {...(rest as React.HTMLAttributes<HTMLElement>)}
        >
          {children}
        </mark>
      );
    }
    const ellipsisOn = ellipsis === true || (typeof ellipsis === "object" && ellipsis !== null);
    const ellipsisStyle: React.CSSProperties | undefined = ellipsisOn
      ? {
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "inline-block",
          maxWidth: "100%",
          verticalAlign: "bottom",
        }
      : undefined;
    return (
      <span
        ref={ref}
        style={{ ...ellipsisStyle, ...style }}
        className={cn(
          type && typeClasses[type],
          strong && "font-semibold",
          italic && "italic",
          underline && "underline",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
        {...rest}
      >
        {children}
      </span>
    );
  },
);
Text.displayName = "Typography.Text";

interface TitleProps extends BaseProps, React.HTMLAttributes<HTMLHeadingElement> {
  level?: 1 | 2 | 3 | 4 | 5;
}

const levelClasses: Record<NonNullable<TitleProps["level"]>, string> = {
  1: "text-4xl font-semibold leading-tight tracking-tight",
  2: "text-3xl font-semibold leading-tight tracking-tight",
  3: "text-2xl font-semibold leading-snug",
  4: "text-xl font-semibold leading-snug",
  5: "text-lg font-semibold leading-snug",
};

const Title = React.forwardRef<HTMLHeadingElement, TitleProps>(
  ({ level = 1, className, children, ...rest }, ref) => {
    const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5";
    return (
      <Tag ref={ref} className={cn(levelClasses[level], className)} {...rest}>
        {children}
      </Tag>
    );
  },
);
Title.displayName = "Typography.Title";

interface ParagraphProps extends BaseProps, React.HTMLAttributes<HTMLParagraphElement> {
  type?: TextType;
  strong?: boolean;
  italic?: boolean;
  underline?: boolean;
  disabled?: boolean;
  ellipsis?: boolean | { rows?: number };
  /** Render paragraph content in code block style. */
  code?: boolean;
  /** Gracefully ignored. */
  copyable?: unknown;
}

const Paragraph = React.forwardRef<HTMLParagraphElement, ParagraphProps>(
  (
    {
      className,
      type,
      strong,
      italic,
      underline,
      disabled,
      ellipsis,
      code,
      copyable: _copyable,
      children,
      style,
      ...rest
    },
    ref,
  ) => {
    const rows = typeof ellipsis === "object" && ellipsis?.rows ? ellipsis.rows : undefined;
    const ellipsisStyle: React.CSSProperties | undefined =
      ellipsis === true
        ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
        : rows
          ? {
              display: "-webkit-box",
              WebkitLineClamp: rows,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }
          : undefined;
    return (
      <p
        ref={ref}
        style={{ ...ellipsisStyle, ...style }}
        className={cn(
          "leading-relaxed",
          type && typeClasses[type],
          strong && "font-semibold",
          italic && "italic",
          underline && "underline",
          disabled && "cursor-not-allowed opacity-50",
          code && "rounded bg-muted p-3 font-mono text-sm whitespace-pre-wrap",
          className,
        )}
        {...rest}
      >
        {children}
      </p>
    );
  },
);
Paragraph.displayName = "Typography.Paragraph";

interface LinkProps extends BaseProps, React.AnchorHTMLAttributes<HTMLAnchorElement> {
  type?: TextType;
  strong?: boolean;
  italic?: boolean;
  underline?: boolean;
  disabled?: boolean;
}

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  ({ className, type, strong, italic, underline, disabled, children, ...rest }, ref) => (
    <a
      ref={ref}
      className={cn(
        "text-primary underline-offset-4 hover:underline",
        type && typeClasses[type],
        strong && "font-semibold",
        italic && "italic",
        underline && "underline",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
);
Link.displayName = "Typography.Link";

export const Typography = Object.assign(
  ({ className, children, ...rest }: BaseProps & React.HTMLAttributes<HTMLDivElement>) => (
    <div className={className} {...rest}>
      {children}
    </div>
  ),
  { Title, Text, Paragraph, Link },
);

export { Title, Text, Paragraph, Link };
