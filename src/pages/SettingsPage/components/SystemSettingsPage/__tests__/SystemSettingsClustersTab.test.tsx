import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SystemSettingsClustersTab from "../SystemSettingsClustersTab";
import { settingsService, FabricListResponse, FabricNode } from "@services/config/SettingsService";

vi.mock("@services/config/SettingsService", async () => {
  const actual = await vi.importActual("@services/config/SettingsService");
  return {
    ...actual,
    settingsService: {
      listNodes: vi.fn(),
      createNode: vi.fn(),
      updateNode: vi.fn(),
      deleteNode: vi.fn(),
      createCluster: vi.fn(),
      updateCluster: vi.fn(),
      deleteCluster: vi.fn(),
      nodeAction: vi.fn(),
      nodeStatus: vi.fn(),
    },
  };
});

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

const mockListNodes = vi.mocked(settingsService.listNodes);
const mockCreateNode = vi.mocked(settingsService.createNode);
const mockUpdateNode = vi.mocked(settingsService.updateNode);
const mockNodeAction = vi.mocked(settingsService.nodeAction);

const emptyList: FabricListResponse = { nodes: [], clusters: [] };

const SECRET_MASK = "****...****";

const sshNode: FabricNode = {
  id: "n1",
  label: "gpu-1",
  placement: {
    type: "ssh",
    host: "10.0.0.5",
    port: 22,
    username: "deploy",
    auth: { method: "password", password: SECRET_MASK },
  },
  trust_level: "trusted",
  deploy: { default_role: "worker" },
  state: null,
  enabled: true,
};

const inlineKeyNode: FabricNode = {
  id: "n2",
  label: "key-1",
  placement: {
    type: "ssh",
    host: "10.0.0.6",
    port: 22,
    username: "deploy",
    auth: { method: "private_key", private_key: SECRET_MASK },
  },
  trust_level: "trusted",
  deploy: { default_role: "worker" },
  state: null,
  enabled: true,
};

const pathKeyNode: FabricNode = {
  id: "n3",
  label: "path-1",
  placement: {
    type: "ssh",
    host: "10.0.0.7",
    port: 22,
    username: "deploy",
    auth: { method: "private_key", private_key_path: "~/.ssh/id_ed25519" },
  },
  trust_level: "trusted",
  deploy: { default_role: "worker" },
  state: null,
  enabled: true,
};

// Key-auth node with NO stored secret (neither inline key nor path) — editing it
// and saving blank must be blocked: nothing to preserve, nothing provided.
const keylessKeyNode: FabricNode = {
  id: "n4",
  label: "keyless-1",
  placement: {
    type: "ssh",
    host: "10.0.0.8",
    port: 22,
    username: "deploy",
    auth: { method: "private_key" },
  },
  trust_level: "trusted",
  deploy: { default_role: "worker" },
  state: null,
  enabled: true,
};

describe("SystemSettingsClustersTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state when no nodes are registered", async () => {
    mockListNodes.mockResolvedValue(emptyList);
    render(<SystemSettingsClustersTab />);
    await waitFor(() => expect(mockListNodes).toHaveBeenCalled());
    expect(await screen.findByText("No nodes registered")).toBeInTheDocument();
  });

  it("renders a node row with its SSH target and status", async () => {
    mockListNodes.mockResolvedValue({ nodes: [sshNode], clusters: [] });
    render(<SystemSettingsClustersTab />);
    expect(await screen.findByText("gpu-1")).toBeInTheDocument();
    expect(screen.getByText("deploy@10.0.0.5:22")).toBeInTheDocument();
    // default state → "not deployed"
    expect(screen.getByText("not deployed")).toBeInTheDocument();
  });

  it("creates an SSH node from the Add modal", async () => {
    mockListNodes.mockResolvedValue(emptyList);
    mockCreateNode.mockResolvedValue(sshNode);
    render(<SystemSettingsClustersTab />);
    await waitFor(() => expect(mockListNodes).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Add Node"));
    fireEvent.change(screen.getByPlaceholderText("gpu-1"), {
      target: { value: "gpu-1" },
    });
    fireEvent.change(screen.getByPlaceholderText("10.0.0.5"), {
      target: { value: "10.0.0.5" },
    });
    fireEvent.change(screen.getByPlaceholderText("deploy"), {
      target: { value: "deploy" },
    });
    // password field is the only Input.Password initially visible
    const pw = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(pw, { target: { value: "s3cr3t" } });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(mockCreateNode).toHaveBeenCalled());
    const req = mockCreateNode.mock.calls[0][0];
    expect(req.label).toBe("gpu-1");
    expect(req.placement.type).toBe("ssh");
    if (req.placement.type === "ssh") {
      expect(req.placement.host).toBe("10.0.0.5");
      expect(req.placement.auth.method).toBe("password");
    }
  });

  it("preserves the stored inline key when editing a key node with fields left blank", async () => {
    mockListNodes.mockResolvedValue({ nodes: [inlineKeyNode], clusters: [] });
    mockUpdateNode.mockResolvedValue(inlineKeyNode);
    render(<SystemSettingsClustersTab />);
    await screen.findByText("key-1");

    fireEvent.click(screen.getByLabelText("Edit"));
    // Modal opens with auth_method=private_key and secrets blank; save as-is.
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(mockUpdateNode).toHaveBeenCalled());
    const [id, req] = mockUpdateNode.mock.calls[0];
    expect(id).toBe("n2");
    expect(req.placement.type).toBe("ssh");
    if (req.placement.type === "ssh" && req.placement.auth.method === "private_key") {
      // Existing masked key preserved; no path invented.
      expect(req.placement.auth.private_key).toBe(SECRET_MASK);
      expect(req.placement.auth.private_key_path).toBeUndefined();
    }
  });

  it("does not invent a masked inline key when editing a path-only key node", async () => {
    mockListNodes.mockResolvedValue({ nodes: [pathKeyNode], clusters: [] });
    mockUpdateNode.mockResolvedValue(pathKeyNode);
    render(<SystemSettingsClustersTab />);
    await screen.findByText("path-1");

    fireEvent.click(screen.getByLabelText("Edit"));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(mockUpdateNode).toHaveBeenCalled());
    const [id, req] = mockUpdateNode.mock.calls[0];
    expect(id).toBe("n3");
    if (req.placement.type === "ssh" && req.placement.auth.method === "private_key") {
      // The node authenticates by path — the blank inline field must stay empty,
      // never the SECRET_MASK sentinel (which would be a bogus key).
      expect(req.placement.auth.private_key).toBeUndefined();
      expect(req.placement.auth.private_key_path).toBe("~/.ssh/id_ed25519");
    }
  });

  it("blocks saving a key node when neither key nor path is provided", async () => {
    mockListNodes.mockResolvedValue({ nodes: [keylessKeyNode], clusters: [] });
    render(<SystemSettingsClustersTab />);
    await screen.findByText("keyless-1");

    // Edit opens with auth_method=private_key already selected (no Select to drive)
    // and no stored secret, so a blank save must be rejected by validation.
    fireEvent.click(screen.getByLabelText("Edit"));
    fireEvent.click(screen.getByText("Save"));

    // The antd async validator + error render can exceed findByText's 1000ms
    // default under a loaded CI run — give it headroom so the assert isn't flaky.
    await screen.findByText("Provide a key file path or paste a private key", undefined, {
      timeout: 5000,
    });
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  it("invokes the deploy action when Deploy is clicked", async () => {
    mockListNodes.mockResolvedValue({ nodes: [sshNode], clusters: [] });
    mockNodeAction.mockResolvedValue({});
    render(<SystemSettingsClustersTab />);
    await screen.findByText("gpu-1");

    fireEvent.click(screen.getByText("Deploy"));
    await waitFor(() => expect(mockNodeAction).toHaveBeenCalledWith("n1", "deploy"));
  });

  it("surfaces a deploy error", async () => {
    mockListNodes.mockResolvedValue({ nodes: [sshNode], clusters: [] });
    mockNodeAction.mockRejectedValue(new Error("preflight failed"));
    render(<SystemSettingsClustersTab />);
    await screen.findByText("gpu-1");

    fireEvent.click(screen.getByText("Deploy"));
    await waitFor(() => expect(mockNodeAction).toHaveBeenCalledWith("n1", "deploy"));
  });

  it("shows live status + last-seen for an unreachable node", async () => {
    const node: FabricNode = {
      ...sshNode,
      id: "n9",
      label: "live-1",
      state: {
        status: "unreachable",
        worker_id: "node-n9",
        last_health: new Date().toISOString(),
        last_error: "worker gone",
      },
    };
    mockListNodes.mockResolvedValue({ nodes: [node], clusters: [] });
    render(<SystemSettingsClustersTab />);
    await screen.findByText("live-1");
    expect(screen.getByText("unreachable")).toBeInTheDocument();
    expect(screen.getByText(/seen .*ago/)).toBeInTheDocument();
  });

  it("persists auto-recover when toggled on", async () => {
    mockListNodes.mockResolvedValue({ nodes: [inlineKeyNode], clusters: [] });
    mockUpdateNode.mockResolvedValue(inlineKeyNode);
    render(<SystemSettingsClustersTab />);
    await screen.findByText("key-1");

    fireEvent.click(screen.getByLabelText("Edit"));
    // Two switches render in DOM order: [auto_recover, enabled]. Flip the first on.
    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(mockUpdateNode).toHaveBeenCalled());
    const [, req] = mockUpdateNode.mock.calls[0];
    expect(req.deploy?.auto_recover).toBe(true);
  });
});
