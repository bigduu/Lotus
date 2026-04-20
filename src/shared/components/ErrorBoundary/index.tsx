import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Typography, theme } from "antd";
import { ReloadOutlined, BugOutlined } from "@ant-design/icons";

const { Text, Paragraph } = Typography;

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback. When omitted the default card is rendered. */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** Identifier for logging (e.g. "ChatView", "Settings"). */
  name?: string;
  /** Callback when an error is caught. */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Generic React Error Boundary.
 *
 * Catches uncaught exceptions in the subtree and renders a recoverable
 * fallback UI instead of unmounting the entire application.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const label = this.props.name ?? "ErrorBoundary";
    console.error(`[${label}] Uncaught error:`, error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { fallback } = this.props;
    const error = this.state.error!;

    // Custom fallback — function or element
    if (typeof fallback === "function") {
      return fallback(error, this.handleReset);
    }
    if (fallback !== undefined) {
      return fallback;
    }

    // Default fallback card
    return <DefaultErrorFallback error={error} onReset={this.handleReset} />;
  }
}

/* ------------------------------------------------------------------ */
/*  Default fallback UI                                                */
/* ------------------------------------------------------------------ */

const DefaultErrorFallback: React.FC<{
  error: Error;
  onReset: () => void;
}> = ({ error, onReset }) => {
  const { token } = theme.useToken();
  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: token.paddingLG,
        minHeight: 200,
        textAlign: "center",
      }}
    >
      <BugOutlined
        style={{
          fontSize: 36,
          color: token.colorWarning,
        }}
      />

      <Text strong style={{ fontSize: 16 }}>
        Something went wrong
      </Text>

      <Text type="secondary" style={{ maxWidth: 420 }}>
        An unexpected error occurred in this section. You can try again or reload the page if the
        issue persists.
      </Text>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          onClick={onReset}
          aria-label="Retry rendering this section"
        >
          Try Again
        </Button>

        <Button
          type="text"
          size="small"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          aria-label="Toggle error details"
        >
          {showDetails ? "Hide Details" : "Show Details"}
        </Button>
      </div>

      {showDetails && (
        <Paragraph
          code
          copyable
          style={{
            maxWidth: 560,
            maxHeight: 200,
            overflow: "auto",
            fontSize: 12,
            textAlign: "left",
            marginTop: 8,
            background: token.colorFillTertiary,
            padding: token.paddingSM,
            borderRadius: token.borderRadius,
          }}
        >
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ""}
        </Paragraph>
      )}
    </div>
  );
};

export default ErrorBoundary;
