import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SystemSettingsPermissionsTab from "../SystemSettingsPermissionsTab";

const mocks = vi.hoisted(() => ({
  getPermissionPolicy: vi.fn(),
  updatePermissionAskRules: vi.fn(),
  deletePermissionRule: vi.fn(),
  message: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  modal: {
    confirm: vi.fn(),
  },
}));

vi.mock("@services/config", () => ({
  settingsService: {
    getPermissionPolicy: mocks.getPermissionPolicy,
    updatePermissionAskRules: mocks.updatePermissionAskRules,
    deletePermissionRule: mocks.deletePermissionRule,
  },
}));

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    App: Object.assign(actual.App, {
      useApp: () => ({ message: mocks.message, modal: mocks.modal }),
    }),
  };
});

const policy = {
  revision: 7,
  loaded_at: "2026-07-31T00:00:00Z",
  source_path: "/tmp/permissions.json",
  source_kind: "primary",
  status: "valid",
  policy: {
    ask_rules: ["Bash(git push *)"],
    session_grant_duration_secs: 1800,
    durable_rules: [
      {
        id: "remembered:workspace:req-1",
        permission_type: "execute_command",
        effect: "allow",
        scope: "workspace",
        workspace_path: "/workspace/project",
        matcher: {
          id: "exact_resource",
          kind: "exact_resource",
          value: "git status",
        },
        source: "user",
      },
      {
        id: "deny-1",
        permission_type: "http_request",
        effect: "deny",
        scope: "global",
        matcher: {
          id: "origin",
          kind: "http_origin",
          value: "https://example.com",
        },
        source: "user",
      },
    ],
  },
};

describe("SystemSettingsPermissionsTab", () => {
  beforeEach(() => {
    mocks.getPermissionPolicy.mockReset();
    mocks.updatePermissionAskRules.mockReset();
    mocks.deletePermissionRule.mockReset();
    mocks.modal.confirm.mockReset();
    Object.values(mocks.message).forEach((mock) => mock.mockReset());
    mocks.getPermissionPolicy.mockResolvedValue(policy);
  });

  it("shows revisioned allow/deny policy groups without fabricating temporary grants", async () => {
    render(<SystemSettingsPermissionsTab />);

    expect(await screen.findByText("Policy revision 7")).toBeInTheDocument();
    expect(screen.getByText("exact_resource: git status")).toBeInTheDocument();
    expect(screen.getByText("http_origin: https://example.com")).toBeInTheDocument();
    expect(
      screen.getByText(/does not currently expose active temporary grants/i),
    ).toBeInTheDocument();
  });

  it("does not let a stale refresh roll back the inspected policy revision", async () => {
    mocks.getPermissionPolicy
      .mockResolvedValueOnce(policy)
      .mockResolvedValueOnce({ ...policy, revision: 6 });
    render(<SystemSettingsPermissionsTab />);

    expect(await screen.findByText("Policy revision 7")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => expect(mocks.getPermissionPolicy).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Policy revision 7")).toBeInTheDocument();
    expect(screen.queryByText("Policy revision 6")).not.toBeInTheDocument();
  });

  it("sends the inspected revision when adding an always-ask rule", async () => {
    mocks.updatePermissionAskRules.mockResolvedValue(["Bash(git push *)", "Bash(sudo *)"]);
    mocks.getPermissionPolicy.mockResolvedValueOnce(policy).mockResolvedValueOnce({
      ...policy,
      revision: 8,
      policy: {
        ...policy.policy,
        ask_rules: ["Bash(git push *)", "Bash(sudo *)"],
      },
    });
    render(<SystemSettingsPermissionsTab />);

    const input = await screen.findByPlaceholderText("e.g. Bash(rm -rf *)");
    fireEvent.change(input, { target: { value: "Bash(sudo *)" } });
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));

    await waitFor(() => {
      expect(mocks.updatePermissionAskRules).toHaveBeenCalledWith(
        ["Bash(git push *)", "Bash(sudo *)"],
        7,
      );
    });
    expect(await screen.findByText("Policy revision 8")).toBeInTheDocument();
  });

  it("shows backend validation failures inline and reloads canonical policy", async () => {
    mocks.updatePermissionAskRules.mockRejectedValue(new Error("invalid permission rule"));
    render(<SystemSettingsPermissionsTab />);

    const input = await screen.findByPlaceholderText("e.g. Bash(rm -rf *)");
    fireEvent.change(input, { target: { value: "Bash(invalid" } });
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));

    expect(await screen.findByText("invalid permission rule")).toBeInTheDocument();
    expect(mocks.getPermissionPolicy).toHaveBeenCalledTimes(2);
    expect(input).toHaveValue("Bash(invalid");
  });

  it("confirms and CAS-revokes a durable rule", async () => {
    mocks.deletePermissionRule.mockResolvedValue({
      ...policy,
      revision: 8,
      policy: { ...policy.policy, durable_rules: policy.policy.durable_rules.slice(1) },
    });
    render(<SystemSettingsPermissionsTab />);

    const revokeButtons = await screen.findAllByRole("button", { name: /revoke permission rule/i });
    fireEvent.click(revokeButtons[0]);
    expect(mocks.modal.confirm).toHaveBeenCalledTimes(1);

    const confirmation = mocks.modal.confirm.mock.calls[0][0];
    await act(async () => {
      await confirmation.onOk();
    });

    expect(mocks.deletePermissionRule).toHaveBeenCalledWith("remembered:workspace:req-1", 7);
    expect(mocks.message.success).toHaveBeenCalledWith("Permission rule revoked");
  });
});
