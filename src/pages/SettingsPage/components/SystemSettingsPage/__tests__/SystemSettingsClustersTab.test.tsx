import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SystemSettingsClustersTab from "../SystemSettingsClustersTab";
import {
  ConfigConflictError,
  configSectionsService,
  type ClusterCredentialFieldStatus,
  type ClusterFabricNode,
  type ClusterFabricSection,
  type ConfigSectionEnvelope,
} from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  const message = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
  };
  const modal = { confirm: vi.fn() };
  return {
    ...actual,
    message,
    App: Object.assign(actual.App, {
      useApp: () => ({ message, notification: message, modal }),
    }),
  };
});

const status = (state: ClusterCredentialFieldStatus["state"]): ClusterCredentialFieldStatus => ({
  state,
  source: state === "from_env" ? "environment" : state === "configured" ? "user" : null,
  updated_at: null,
});

const credentialStatus = (
  password: ClusterCredentialFieldStatus["state"] = "missing",
  privateKey: ClusterCredentialFieldStatus["state"] = "missing",
  passphrase: ClusterCredentialFieldStatus["state"] = "missing",
) => ({
  password: status(password),
  private_key: status(privateKey),
  passphrase: status(passphrase),
});

const sshNode: ClusterFabricNode = {
  id: "n1",
  label: "gpu-1",
  placement: {
    type: "ssh",
    host: "10.0.0.5",
    port: 22,
    username: "deploy",
    auth: { method: "password" },
  },
  trust_level: "trusted",
  deploy: { default_role: "worker" },
  state: null,
  enabled: true,
};

const inlineKeyNode: ClusterFabricNode = {
  ...sshNode,
  id: "n2",
  label: "key-1",
  placement: {
    type: "ssh",
    host: "10.0.0.6",
    port: 22,
    username: "deploy",
    auth: { method: "private_key" },
  },
};

const pathKeyNode: ClusterFabricNode = {
  ...inlineKeyNode,
  id: "n3",
  label: "path-1",
  placement: {
    type: "ssh",
    host: "10.0.0.7",
    port: 22,
    username: "deploy",
    auth: { method: "private_key", private_key_path: "~/.ssh/id_ed25519" },
  },
};

const keylessKeyNode: ClusterFabricNode = {
  ...inlineKeyNode,
  id: "n4",
  label: "keyless-1",
};

const clusterEnvelope = (
  revision: number,
  nodes: ClusterFabricNode[] = [],
  clusters: ClusterFabricSection["clusters"] = [],
  credentials: ClusterFabricSection["credential_status"] = {},
): ConfigSectionEnvelope<ClusterFabricSection> => ({
  data: { nodes, clusters, credential_status: credentials },
  revision,
  loaded_at: `2026-07-27T00:00:0${revision}Z`,
  source_path: "/tmp/cluster-fabric.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const mutationResult = (envelope: ConfigSectionEnvelope<ClusterFabricSection>) => ({ envelope });

const passwordInput = (): HTMLInputElement =>
  document.querySelector('input[type="password"]') as HTMLInputElement;

describe("SystemSettingsClustersTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders the typed cluster section without a parallel list or credential read", async () => {
    const getSection = vi
      .spyOn(configSectionsService, "getSection")
      .mockResolvedValue(clusterEnvelope(8) as never);

    render(<SystemSettingsClustersTab />);

    expect(await screen.findByText("No nodes registered")).toBeInTheDocument();
    expect(getSection).toHaveBeenCalledWith("cluster-fabric");
  });

  it("renders a secret-free node row with its live section state", async () => {
    const node: ClusterFabricNode = {
      ...sshNode,
      state: {
        status: "unreachable",
        worker_id: "node-n1",
        last_health: new Date().toISOString(),
        last_error: "worker gone",
      },
    };
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(
      clusterEnvelope(8, [node], [], { n1: credentialStatus("configured") }) as never,
    );

    render(<SystemSettingsClustersTab />);

    expect(await screen.findByText("gpu-1")).toBeInTheDocument();
    expect(screen.getByText("deploy@10.0.0.5:22")).toBeInTheDocument();
    expect(screen.getByText("unreachable")).toBeInTheDocument();
    expect(screen.getByText(/seen .*ago/)).toBeInTheDocument();
    expect(JSON.stringify(node)).not.toContain("****");
  });

  it("creates a node and its membership through one section-revision transaction", async () => {
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(clusterEnvelope(8) as never);
    const create = vi
      .spyOn(configSectionsService, "createClusterNode")
      .mockResolvedValue(
        mutationResult(
          clusterEnvelope(9, [sshNode], [{ name: "gpu", node_ids: ["n1"] }], {
            n1: credentialStatus("configured"),
          }),
        ),
      );

    render(<SystemSettingsClustersTab />);
    await screen.findByText("No nodes registered");
    fireEvent.click(screen.getByText("Add Node"));
    fireEvent.change(screen.getByPlaceholderText("gpu-1"), { target: { value: "gpu-1" } });
    fireEvent.change(screen.getByPlaceholderText("10.0.0.5"), {
      target: { value: "10.0.0.5" },
    });
    fireEvent.change(screen.getByPlaceholderText("deploy"), { target: { value: "deploy" } });
    fireEvent.change(passwordInput(), { target: { value: "s3cr3t" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(
      8,
      expect.objectContaining({
        label: "gpu-1",
        placement: {
          type: "ssh",
          host: "10.0.0.5",
          port: 22,
          username: "deploy",
          auth: { method: "password" },
        },
        credential_changes: {
          password: { action: "replace", value: "s3cr3t" },
          private_key: { action: "clear" },
          passphrase: { action: "clear" },
        },
        membership: { cluster_names: [] },
      }),
    );
    expect(JSON.stringify(create.mock.calls[0]?.[1].placement)).not.toContain("s3cr3t");
    expect(useConfigSectionStore.getState().sections["cluster-fabric"].envelope?.revision).toBe(9);
  });

  it("keeps an existing inline key explicitly without sending a mask or secret field", async () => {
    const before = clusterEnvelope(8, [inlineKeyNode], [], {
      n2: credentialStatus("missing", "configured"),
    });
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(before as never);
    const update = vi
      .spyOn(configSectionsService, "updateClusterNode")
      .mockResolvedValue(mutationResult(clusterEnvelope(9, [inlineKeyNode])));

    render(<SystemSettingsClustersTab />);
    await screen.findByText("key-1");
    fireEvent.click(screen.getByLabelText("Edit"));
    expect(await screen.findByText("Configured")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith(
      "n2",
      8,
      expect.objectContaining({
        placement: expect.objectContaining({ auth: { method: "private_key" } }),
        credential_changes: expect.objectContaining({
          password: { action: "clear" },
          private_key: { action: "keep" },
          passphrase: { action: "keep" },
        }),
      }),
    );
    expect(JSON.stringify(update.mock.calls[0]?.[2])).not.toContain("****");
  });

  it("clears an inline key when path-based authentication is authoritative", async () => {
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(
      clusterEnvelope(8, [pathKeyNode], [], {
        n3: credentialStatus("missing", "configured"),
      }) as never,
    );
    const update = vi
      .spyOn(configSectionsService, "updateClusterNode")
      .mockResolvedValue(mutationResult(clusterEnvelope(9, [pathKeyNode])));

    render(<SystemSettingsClustersTab />);
    await screen.findByText("path-1");
    fireEvent.click(screen.getByLabelText("Edit"));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[2]).toMatchObject({
      placement: {
        auth: { method: "private_key", private_key_path: "~/.ssh/id_ed25519" },
      },
      credential_changes: { private_key: { action: "clear" } },
    });
  });

  it("blocks a missing inline key instead of inventing a mask sentinel", async () => {
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(
      clusterEnvelope(8, [keylessKeyNode], [], {
        n4: credentialStatus("missing", "missing"),
      }) as never,
    );
    const update = vi.spyOn(configSectionsService, "updateClusterNode");

    render(<SystemSettingsClustersTab />);
    await screen.findByText("keyless-1");
    fireEvent.click(screen.getByLabelText("Edit"));
    fireEvent.click(screen.getByText("Save"));

    await screen.findByText("Provide a key file path or paste a private key", undefined, {
      timeout: 5000,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("uses the current cluster section revision for lifecycle actions", async () => {
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(
      clusterEnvelope(8, [sshNode], [], { n1: credentialStatus("configured") }) as never,
    );
    const run = vi
      .spyOn(configSectionsService, "runClusterNodeAction")
      .mockResolvedValue(mutationResult(clusterEnvelope(9, [sshNode])));

    render(<SystemSettingsClustersTab />);
    await screen.findByText("gpu-1");
    fireEvent.click(screen.getByText("Deploy"));

    await waitFor(() => expect(run).toHaveBeenCalledWith("n1", "deploy", 8));
  });

  it("auto-adopts a newer clean node snapshot", async () => {
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(
      clusterEnvelope(8, [sshNode], [], { n1: credentialStatus("configured") }) as never,
    );
    render(<SystemSettingsClustersTab />);
    await screen.findByText("gpu-1");
    fireEvent.click(screen.getByLabelText("Edit"));

    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          "cluster-fabric": {
            ...state.sections["cluster-fabric"],
            envelope: clusterEnvelope(9, [{ ...sshNode, label: "external-label" }], [], {
              n1: credentialStatus("configured"),
            }),
          },
        },
      }));
    });

    expect(await screen.findByDisplayValue("external-label")).toBeInTheDocument();
    expect(screen.queryByText("Cluster configuration changed externally")).not.toBeInTheDocument();
  });

  it("preserves, redacts, compares, and reapplies a dirty node draft", async () => {
    const initial = clusterEnvelope(8, [sshNode], [], {
      n1: credentialStatus("configured"),
    });
    const external = clusterEnvelope(9, [{ ...sshNode, label: "external-label" }], [], {
      n1: credentialStatus("configured"),
    });
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(initial as never);
    const update = vi
      .spyOn(configSectionsService, "updateClusterNode")
      .mockResolvedValue(
        mutationResult(clusterEnvelope(10, [{ ...sshNode, label: "local-label" }])),
      );

    render(<SystemSettingsClustersTab />);
    await screen.findByText("gpu-1");
    fireEvent.click(screen.getByLabelText("Edit"));
    fireEvent.change(screen.getByDisplayValue("gpu-1"), { target: { value: "local-label" } });
    fireEvent.change(passwordInput(), { target: { value: "local-secret" } });

    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          "cluster-fabric": {
            ...state.sections["cluster-fabric"],
            envelope: external,
          },
        },
      }));
    });

    expect(await screen.findByText("Cluster configuration changed externally")).toBeInTheDocument();
    expect(screen.getByDisplayValue("local-label")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Compare"));
    const comparison = await screen.findByTestId("cluster-revision-comparison");
    expect(comparison).toHaveTextContent("[replace requested]");
    expect(comparison).not.toHaveTextContent("local-secret");

    fireEvent.click(screen.getByText("Reapply"));
    await waitFor(() => expect(screen.getByDisplayValue("local-label")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[1]).toBe(9);
    expect(update.mock.calls[0]?.[2].credential_changes.password).toEqual({
      action: "replace",
      value: "local-secret",
    });
  });

  it("keeps a stale draft open and exposes the current revision after a 409", async () => {
    const initial = clusterEnvelope(8, [sshNode], [], {
      n1: credentialStatus("configured"),
    });
    const latest = clusterEnvelope(9, [{ ...sshNode, label: "winner" }], [], {
      n1: credentialStatus("configured"),
    });
    const getSection = vi
      .spyOn(configSectionsService, "getSection")
      .mockResolvedValueOnce(initial as never)
      .mockResolvedValue(latest as never);
    vi.spyOn(configSectionsService, "updateClusterNode").mockRejectedValueOnce(
      new ConfigConflictError({
        expectedRevision: 8,
        currentRevision: 9,
        message: "revision conflict",
      }),
    );

    render(<SystemSettingsClustersTab />);
    await screen.findByText("gpu-1");
    fireEvent.click(screen.getByLabelText("Edit"));
    fireEvent.change(screen.getByDisplayValue("gpu-1"), { target: { value: "loser-draft" } });
    fireEvent.click(screen.getByText("Save"));

    expect(await screen.findByText("Cluster revision conflict")).toBeInTheDocument();
    expect(screen.getByText(/expected revision 8/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("loser-draft")).toBeInTheDocument();
    expect(getSection).toHaveBeenCalledTimes(2);
  });

  it("supports an explicit passphrase clear without exposing environment credentials", async () => {
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(
      clusterEnvelope(8, [inlineKeyNode], [], {
        n2: credentialStatus("missing", "configured", "from_env"),
      }) as never,
    );
    const update = vi
      .spyOn(configSectionsService, "updateClusterNode")
      .mockResolvedValue(mutationResult(clusterEnvelope(9, [inlineKeyNode])));

    render(<SystemSettingsClustersTab />);
    await screen.findByText("key-1");
    fireEvent.click(screen.getByLabelText("Edit"));
    expect(await screen.findByText("From env")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear stored passphrase"));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[2].credential_changes.passphrase).toEqual({
      action: "clear",
    });
  });
});
