import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccessPasswordCard from "../AccessPasswordCard";
import {
  ConfigConflictError,
  configSectionsService,
  type AccessControlSection,
  type AccessMutationResult,
  type ConfigSectionEnvelope,
} from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";

const accessEnvelope = (
  revision: number,
  data: AccessControlSection = {
    password_enabled: true,
    password_credential_ref: "access.root.password",
    password_configured: true,
    updated_at: null,
    devices: [],
  },
): ConfigSectionEnvelope<AccessControlSection> => ({
  data,
  revision,
  loaded_at: `2026-07-26T00:00:0${revision}Z`,
  source_path: "/tmp/access-control.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const runtimeStatus = (localBypass: boolean, source: string | null = "user", revision = 4) => ({
  password_enabled: true,
  local_bypass: localBypass,
  requires_password: !localBypass,
  revision,
  status: "healthy" as const,
  source_kind: "file" as const,
  loaded_at: "2026-07-26T00:01:00Z",
  last_error: null,
  password_configured: true,
  credential_state: source === "environment" ? ("from_env" as const) : ("configured" as const),
  credential_ref: "access.root.password",
  credential_source: source,
  credential_updated_at: null,
});

const mutationResult = (sectionRevision: number): AccessMutationResult => ({
  envelope: accessEnvelope(sectionRevision),
  credential: {
    credential_ref: "access.root.password",
    configured: true,
    state: "configured",
    source: "user",
    updated_at: null,
  },
});

const fillPassword = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

describe("AccessPasswordCard", () => {
  const msgApi = {
    success: vi.fn(),
    error: vi.fn(),
  };
  let currentAccess: ConfigSectionEnvelope<AccessControlSection>;
  let currentRuntime: ReturnType<typeof runtimeStatus>;

  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
    currentAccess = accessEnvelope(4);
    currentRuntime = runtimeStatus(true);
    vi.spyOn(configSectionsService, "getSection").mockImplementation(async (section) => {
      if (section === "access-control") return currentAccess as never;
      throw new Error(`Unexpected section ${section}`);
    });
    vi.spyOn(configSectionsService, "getAccessRuntimeStatus").mockImplementation(
      async () => currentRuntime,
    );
    vi.spyOn(configSectionsService, "replaceAccessPassword").mockResolvedValue(mutationResult(5));
    vi.spyOn(configSectionsService, "clearAccessPassword").mockResolvedValue({
      envelope: accessEnvelope(5, {
        password_enabled: false,
        password_credential_ref: null,
        password_configured: false,
        updated_at: null,
        devices: [],
      }),
      credential: {
        credential_ref: null,
        configured: false,
        state: "missing",
        source: null,
        updated_at: null,
      },
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("uses the typed Access section and exact status projection as settings truth", async () => {
    render(<AccessPasswordCard msgApi={msgApi} />);

    expect(await screen.findByText("Access password enabled")).toBeInTheDocument();
    expect(screen.getByText("Configured")).toBeInTheDocument();
    expect(screen.getByText(/local connection/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Current Password")).not.toBeInTheDocument();
    expect(configSectionsService.getSection).toHaveBeenCalledWith("access-control");
  });

  it("replaces a remote password through the store with the captured section revision", async () => {
    currentRuntime = runtimeStatus(false);
    const replace = vi.mocked(configSectionsService.replaceAccessPassword);
    render(<AccessPasswordCard msgApi={msgApi} />);

    await screen.findByLabelText("Current Password");
    fillPassword("Current Password", "current-secret");
    fillPassword("New Password", "replacement-secret");
    fillPassword("Confirm Password", "replacement-secret");
    fireEvent.click(screen.getByRole("button", { name: "Update Access Password" }));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(4, {
        current_password: "current-secret",
        value: "replacement-secret",
      }),
    );
    expect(msgApi.success).toHaveBeenCalled();
    expect(JSON.stringify(useConfigSectionStore.getState())).not.toContain("current-secret");
    expect(JSON.stringify(useConfigSectionStore.getState())).not.toContain("replacement-secret");
  });

  it("clears the password through an explicit Access section mutation", async () => {
    const clear = vi.mocked(configSectionsService.clearAccessPassword);
    render(<AccessPasswordCard msgApi={msgApi} />);
    await screen.findByLabelText("New Password");

    fireEvent.click(screen.getByRole("button", { name: "Clear password" }));
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => expect(clear).toHaveBeenCalledWith(4, {}));
    expect(msgApi.success).toHaveBeenCalledWith("Access password cleared");
  });

  it("shows an environment-owned verifier as read-only until explicit replacement", async () => {
    currentRuntime = runtimeStatus(true, "environment");
    render(<AccessPasswordCard msgApi={msgApi} />);

    expect(await screen.findByText("From env")).toBeInTheDocument();
    expect(screen.getByText(/active verifier comes from the environment/i)).toBeInTheDocument();
  });

  it("preserves and redacts a dirty draft across an external section revision", async () => {
    const replace = vi.mocked(configSectionsService.replaceAccessPassword);
    render(<AccessPasswordCard msgApi={msgApi} />);
    await screen.findByLabelText("New Password");
    fillPassword("New Password", "replacement-secret");
    fillPassword("Confirm Password", "replacement-secret");

    currentAccess = accessEnvelope(5);
    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          "access-control": {
            ...state.sections["access-control"],
            envelope: currentAccess,
          },
        },
      }));
    });

    expect(
      await screen.findByText("Access-control configuration changed externally"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New Password")).toHaveValue("replacement-secret");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const comparison = screen.getByTestId("access-password-revision-comparison").textContent ?? "";
    expect(comparison).toContain("[replace requested]");
    expect(comparison).not.toContain("replacement-secret");

    fireEvent.click(screen.getByRole("button", { name: "Reapply" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Update Access Password" })).toBeEnabled(),
    );
    expect(screen.getByLabelText("New Password")).toHaveValue("replacement-secret");
    fireEvent.click(screen.getByRole("button", { name: "Update Access Password" }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ value: "replacement-secret" }),
      ),
    );
  });

  it("keeps password fields open and exposes the current revision after 409", async () => {
    vi.mocked(configSectionsService.replaceAccessPassword).mockRejectedValueOnce(
      new ConfigConflictError({
        expectedRevision: 4,
        currentRevision: 5,
        message: "revision conflict",
      }),
    );
    render(<AccessPasswordCard msgApi={msgApi} />);
    await screen.findByLabelText("New Password");
    fillPassword("New Password", "replacement-secret");
    fillPassword("Confirm Password", "replacement-secret");
    currentAccess = accessEnvelope(5);
    fireEvent.click(screen.getByRole("button", { name: "Update Access Password" }));

    expect(await screen.findByText("Access-control revision conflict")).toBeInTheDocument();
    expect(screen.getByText(/server is at revision 5/i)).toBeInTheDocument();
    expect(screen.getByLabelText("New Password")).toHaveValue("replacement-secret");
    expect(screen.getByRole("button", { name: "Update Access Password" })).toBeDisabled();
  });

  it("keeps last-known-good access metadata visible when a refresh fails", async () => {
    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          "access-control": {
            ...state.sections["access-control"],
            envelope: accessEnvelope(4),
            error: "redacted access refresh failure",
          },
        },
        accessRuntimeStatus: runtimeStatus(true),
      }));
    });
    render(<AccessPasswordCard msgApi={msgApi} />);

    expect(await screen.findByText("Access password enabled")).toBeInTheDocument();
    expect(screen.getByText("redacted access refresh failure")).toBeInTheDocument();
  });
});
