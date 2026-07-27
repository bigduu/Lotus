import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configSectionsService, type ProxyAuthStatus } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { NetworkSettingsCard } from "../NetworkSettingsCard";

const proxyStatus = (
  revision: number,
  configured: boolean,
  source: string | null = configured ? "user" : null,
): ProxyAuthStatus => ({
  section: {
    data: configured ? { proxy_auth_credential_ref: "proxy.default.auth" } : {},
    revision,
    loaded_at: "2026-07-27T00:00:00Z",
    source_path: "/tmp/core.json",
    source_kind: "file",
    status: "healthy",
    last_error: null,
  },
  credential_ref: configured ? "proxy.default.auth" : null,
  state: source === "environment" ? "from_env" : configured ? "configured" : "missing",
  configured,
  source,
  updated_at: null,
  revision,
  status: "healthy",
  source_kind: "file",
  source_path: "/tmp/core.json",
  loaded_at: "2026-07-27T00:00:00Z",
  last_error: null,
});

const renderCard = () =>
  render(
    <NetworkSettingsCard
      httpProxy=""
      httpsProxy=""
      onHttpProxyChange={vi.fn()}
      onHttpsProxyChange={vi.fn()}
      onReload={vi.fn()}
      onSave={vi.fn()}
      isLoading={false}
    />,
  );

describe("NetworkSettingsCard proxy credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
    vi.spyOn(configSectionsService, "getProxyAuthStatus").mockResolvedValue(proxyStatus(3, false));
    vi.spyOn(configSectionsService, "replaceProxyAuth").mockResolvedValue(proxyStatus(4, true));
    vi.spyOn(configSectionsService, "clearProxyAuth").mockResolvedValue(proxyStatus(4, false));
  });

  afterEach(() => vi.restoreAllMocks());

  it("preserves and compares a dirty replacement without exposing its password", async () => {
    renderCard();
    const username = (await screen.findByTestId("proxy-auth-username")) as HTMLInputElement;
    const password = screen.getByTestId("proxy-auth-password") as HTMLInputElement;
    fireEvent.change(username, { target: { value: "alice" } });
    fireEvent.change(password, { target: { value: "do-not-display" } });

    act(() => {
      useConfigSectionStore.setState({
        proxyAuthStatus: proxyStatus(4, true),
      });
    });

    expect(await screen.findByText(/changed externally/i)).toBeInTheDocument();
    expect(username).toHaveValue("alice");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const comparison = screen.getByTestId("proxy-auth-revision-comparison");
    expect(comparison).toHaveTextContent("[replace requested]");
    expect(comparison).not.toHaveTextContent("do-not-display");

    fireEvent.click(screen.getByTestId("proxy-auth-apply"));
    await waitFor(() =>
      expect(configSectionsService.replaceProxyAuth).toHaveBeenCalledWith(3, {
        username: "alice",
        password: "do-not-display",
      }),
    );
  });

  it("reapplies a dirty replacement onto the latest credential revision", async () => {
    renderCard();
    const username = await screen.findByTestId("proxy-auth-username");
    fireEvent.change(username, { target: { value: "alice" } });
    fireEvent.change(screen.getByTestId("proxy-auth-password"), {
      target: { value: "replacement" },
    });

    act(() => {
      useConfigSectionStore.setState({
        proxyAuthStatus: proxyStatus(4, true),
      });
    });

    fireEvent.click(await screen.findByRole("button", { name: "Reapply" }));
    expect(username).toHaveValue("alice");
    fireEvent.click(screen.getByTestId("proxy-auth-apply"));

    await waitFor(() =>
      expect(configSectionsService.replaceProxyAuth).toHaveBeenCalledWith(4, {
        username: "alice",
        password: "replacement",
      }),
    );
  });

  it("adopts a clean environment-sourced status without pre-filling credentials", async () => {
    renderCard();
    const username = (await screen.findByTestId("proxy-auth-username")) as HTMLInputElement;

    act(() => {
      useConfigSectionStore.setState({
        proxyAuthStatus: proxyStatus(4, true, "environment"),
      });
    });

    expect(await screen.findByText("From env")).toBeInTheDocument();
    expect(username).toHaveValue("");
    expect(screen.getByTestId("proxy-auth-password")).toHaveValue("");
    expect(screen.queryByText(/changed externally/i)).not.toBeInTheDocument();
  });
});
