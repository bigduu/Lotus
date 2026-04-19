import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * antd-compatible <Card> drop-in built on shadcn/ui primitives + Tailwind.
 * Accepts the subset of antd API used across the codebase:
 *   title, extra, bordered, hoverable, size, bodyStyle, headStyle,
 *   styles.body / styles.header, cover, actions, loading.
 *
 * Also exports the lower-level shadcn sub-components for new code:
 *   CardHeader, CardTitle, CardDescription, CardContent, CardFooter.
 */

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  extra?: React.ReactNode;
  bordered?: boolean;
  hoverable?: boolean;
  size?: "default" | "small";
  /** antd v5.20+ API: "outlined" | "borderless". Mapped to bordered internally. */
  variant?: "outlined" | "borderless";
  bodyStyle?: React.CSSProperties;
  headStyle?: React.CSSProperties;
  styles?: {
    body?: React.CSSProperties;
    header?: React.CSSProperties;
    cover?: React.CSSProperties;
    actions?: React.CSSProperties;
  };
  cover?: React.ReactNode;
  actions?: React.ReactNode[];
  loading?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      title,
      extra,
      bordered,
      variant,
      hoverable = false,
      size = "default",
      bodyStyle,
      headStyle,
      styles,
      cover,
      actions,
      loading,
      children,
      ...rest
    },
    ref,
  ) => {
    const isSmall = size === "small";
    const headerPadding = isSmall ? "px-3 py-2" : "px-5 py-3";
    const bodyPadding = isSmall ? "p-3" : "p-5";
    const hasHeader = Boolean(title || extra);
    const effectiveBordered =
      bordered !== undefined ? bordered : variant ? variant === "outlined" : true;

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-lg bg-card text-card-foreground",
          effectiveBordered && "border border-border",
          !effectiveBordered && "shadow-sm",
          hoverable && "transition-shadow hover:shadow-md",
          className,
        )}
        {...rest}
      >
        {cover && (
          <div className="overflow-hidden rounded-t-lg" style={styles?.cover}>
            {cover}
          </div>
        )}
        {hasHeader && (
          <div
            className={cn("flex items-center justify-between gap-3 border-b border-border", headerPadding)}
            style={{ ...headStyle, ...styles?.header }}
          >
            <div className={cn("min-w-0 flex-1 truncate font-semibold", isSmall ? "text-sm" : "text-base")}>
              {title}
            </div>
            {extra && <div className="shrink-0">{extra}</div>}
          </div>
        )}
        <div className={cn(bodyPadding)} style={{ ...bodyStyle, ...styles?.body }}>
          {loading ? <CardLoadingSkeleton /> : children}
        </div>
        {actions && actions.length > 0 && (
          <ul
            className="flex list-none items-center border-t border-border"
            style={styles?.actions}
          >
            {actions.map((action, i) => (
              <li
                key={i}
                className={cn(
                  "flex flex-1 items-center justify-center py-2 text-muted-foreground",
                  i > 0 && "border-l border-border",
                )}
              >
                {action}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);
Card.displayName = "Card";

const CardLoadingSkeleton: React.FC = () => (
  <div className="space-y-2">
    <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
    <div className="h-3 w-full animate-pulse rounded bg-muted" />
    <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
  </div>
);

// shadcn-style primitives (kept for new code that wants composable building blocks)
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("text-2xl font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
export default Card;
