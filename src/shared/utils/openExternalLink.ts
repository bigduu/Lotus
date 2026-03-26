import { isTauriEnvironment } from "../../utils/environment";

const openInBrowser = (url: string, options?: { allowLocationFallback?: boolean }): void => {
  if (typeof window === "undefined") {
    return;
  }

  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (popup) {
    popup.opener = null;
    return;
  }

  if (options?.allowLocationFallback ?? true) {
    // Browser fallback for environments that block popups.
    window.location.assign(url);
  }
};

export const openExternalLink = async (url: string): Promise<void> => {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    return;
  }

  const isDesktop = isTauriEnvironment();
  if (isDesktop) {
    const tauriInternals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ as
      | { invoke?: (...args: unknown[]) => Promise<unknown> }
      | undefined;
    const invoke = tauriInternals?.invoke;
    if (typeof invoke === "function") {
      try {
        await invoke("plugin:shell|open", { path: normalizedUrl });
        return;
      } catch (error) {
        console.warn(
          "[openExternalLink] Failed to open via Tauri shell plugin, falling back to browser open.",
          error,
        );
      }
    }

    // In desktop mode, never navigate the current webview as fallback.
    openInBrowser(normalizedUrl, { allowLocationFallback: false });
    return;
  }

  openInBrowser(normalizedUrl);
};
