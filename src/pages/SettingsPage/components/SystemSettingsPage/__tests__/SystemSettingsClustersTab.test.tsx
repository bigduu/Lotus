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
const mockNodeAction = vi.mocked(settingsService.nodeAction);

const emptyList: FabricListResponse = { nodes: [], clusters: [] };

const sshNode: FabricNode = {
  id: "n1",
  label: "gpu-1",
  placement: {
    type: "ssh",
    host: "10.0.0.5",
    port: 22,
    username: "deploy",
    auth: { method: "password", password: "****...****" },
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
});
