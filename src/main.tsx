import React from "react";
import ReactDOM from "react-dom/client";
import "antd/dist/reset.css"; // Import Ant Design CSS reset
import "@shared/i18n";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element for Bodhi app bootstrap");
}

const root = ReactDOM.createRoot(rootElement as HTMLElement);

const renderBootstrapError = (error: unknown) => {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error || "Unknown startup error");

  console.error("[Bodhi] Failed to bootstrap app:", error);

  root.render(
    <React.StrictMode>
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--lotus-main-surface, #f6f6f6)",
          color: "var(--color-gray-800, #0f0f0f)",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ maxWidth: 720, textAlign: "left" }}>
          <h2 style={{ margin: "0 0 12px" }}>Bodhi UI failed to start</h2>
          <p style={{ margin: 0, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {message}
          </p>
        </div>
      </div>
    </React.StrictMode>,
  );
};

const bootstrap = async () => {
  try {
    const { default: App } = await import("./app/App");
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } catch (error) {
    renderBootstrapError(error);
  }
};

void bootstrap();
