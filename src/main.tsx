import React from "react";
import ReactDOM from "react-dom/client";
import "antd/dist/reset.css"; // Import Ant Design CSS reset
import { i18nReady } from "@shared/i18n";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element for Bodhi app bootstrap");
}

const root = ReactDOM.createRoot(rootElement as HTMLElement);

// Vite surfaces a failed dynamic-import preload — a code-split chunk or its CSS
// could not be fetched — as a `vite:preloadError` event. This is typically a
// stale deploy (asset hashes rotated) or a transient CDN/tunnel error (e.g. one
// of many parallel preload requests reset over a Cloudflare tunnel), and shows
// up in the console as "Unable to preload CSS for …" / "Failed to fetch
// dynamically imported module". Left unhandled, the lazy chunk (e.g. the heavy
// mermaid bundle) simply fails to render. Reload once to pull the current
// assets; a short timestamp guard prevents a reload loop if the asset is truly
// gone (then the error is allowed to surface).
let preloadReloadAttempted = false;
window.addEventListener("vite:preloadError", (event) => {
  const GUARD_KEY = "bodhi_preload_reload_at";
  const now = Date.now();
  let last = 0;
  try {
    last = Number(window.sessionStorage.getItem(GUARD_KEY) ?? 0);
  } catch {
    last = preloadReloadAttempted ? now : 0;
  }
  if (now - last < 10_000) {
    return; // already reloaded recently — let it surface instead of looping
  }
  event.preventDefault();
  preloadReloadAttempted = true;
  try {
    window.sessionStorage.setItem(GUARD_KEY, String(now));
  } catch {
    // sessionStorage unavailable (private mode): the module flag still guards.
  }
  window.location.reload();
});

const renderBootstrapError = (error: unknown) => {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error || "Unknown startup error");

  console.error("[Bodhi] Failed to bootstrap app:", error);

  // NOTE: i18n is not yet initialized at this point (bootstrap failed before
  // i18nReady resolved), so these strings remain hardcoded in English.
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
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ maxWidth: 720, textAlign: "left" }}>
          <h2 style={{ margin: "0 0 12px" }}>Bodhi UI failed to start</h2>
          <p style={{ margin: 0, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{message}</p>
        </div>
      </div>
    </React.StrictMode>,
  );
};

const bootstrap = async () => {
  try {
    await i18nReady;
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
