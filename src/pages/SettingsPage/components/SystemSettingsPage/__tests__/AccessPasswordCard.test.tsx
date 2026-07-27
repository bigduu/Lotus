import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccessPasswordCard from "../AccessPasswordCard";
import {
  ConfigConflictError,
  configSectionsService,
  type AccessControlSection,
  type AccessMutationResult,
  type ConfigSectionEnvelope,
  type CredentialStatus,
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

const credentialsEnvelope = (
  revision: number,
  source: CredentialStatus["source"] = "user",
): ConfigSectionEnvelope<CredentialStatus[]> => ({
  data: [
    {
      credential_ref: "access.root.password",
      configured: true,
      source,
      updated_at: null,
    },
  ],
  revision,
  loaded_at: "2026-07-26T00:01:00Z",
  source_path: "/tmp/credentials.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const runtimeStatus = (localBypass: boolean) => ({
  password_enabled: true,
  local_bypass: localBypass,
  requires_password: !localBypass,
});

const mutationResult = (
  sectionRevision: number,
  credentialRevision: number,
  localBypass = true,
): AccessMutationResult => ({
  envelope: accessEnvelope(sectionRevision),
  credentials: credentialsEnvelope(credentialRevision),
  runtime: runtimeStatus(localBypass),
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
  let currentCredentials: ConfigSectionEnvelope<CredentialStatus[]>;
  let currentRuntime: ReturnType<typeof runtimeStatus>;

  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
    currentAccess = accessEnvelope(4);
    currentCredentials = credentialsEnvelope(20);
    currentRuntime = runtimeStatus(true);
    vi.spyOn(configSectionsService, "getSection").mockImplementation(async (section) => {
      if (section === "access-control") return currentAccess as never;
      if (section === "credentials") return currentCredentials as never;
      throw new Error(`Unexpected section ${section}`);
    });
    vi.spyOn(configSectionsService, "getAccessRuntimeStatus").mockImplementation(
      async () => currentRuntime,
    );
    vi.spyOn(configSectionsService, "replaceAccessPassword").mockResolvedValue(
      mutationResult(5, 21),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("uses the typed Access and credential snapshots as settings truth", async () => {
    render(<AccessPasswordCard msgApi={msgApi} />);

    expect(await screen.findByText("Access password enabled")).toBeInTheDocument();
    expect(screen.getByText("Configured")).toBeInTheDocument();
    expect(screen.getByText(/local connection/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Current Password")).not.toBeInTheDocument();
    expect(configSectionsService.getSection).toHaveBeenCalledWith("access-control");
    expect(configSectionsService.getSection).toHaveBeenCalledWith("credentials");
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
        new_password: "replacement-secret",
      }),
    );
    expect(msgApi.success).toHaveBeenCalled();
    expect(JSON.stringify(useConfigSectionStore.getState())).not.toContain("current-secret");
    expect(JSON.stringify(useConfigSectionStore.getState())).not.toContain("replacement-secret");
  });

  it("shows an environment-owned verifier as read-only until explicit replacement", async () => {
    currentCredentials = credentialsEnvelope(20, "environment");
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
        expect.objectContaining({ new_password: "replacement-secret" }),
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
          credentials: {
            ...state.sections.credentials,
            envelope: credentialsEnvelope(20),
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
