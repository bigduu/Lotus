import { describe, expect, it } from "vitest";

import {
  mapActiveWorkflowReceipt,
  sessionSummaryToChatItem,
} from "../chatSessionSlice/messageMapping";

const publicReceipt = {
  id: "review",
  name: "Review",
  source: "project",
  revision: 12,
  version: "4",
  kind: "instruction",
  invoked_by: "model",
  activated_at: "2026-08-23T08:00:00Z",
  status: "active",
};

const summary = (...activeWorkflow: [] | [unknown]) => ({
  id: "session-1",
  kind: "root",
  title: "Session",
  title_version: 1,
  pinned: false,
  root_session_id: "session-1",
  spawn_depth: 0,
  model: "gpt-5",
  created_at: "2026-08-23T08:00:00Z",
  updated_at: "2026-08-23T08:00:00Z",
  last_activity_at: "2026-08-23T08:00:00Z",
  message_count: 0,
  has_attachments: false,
  is_running: false,
  ...(activeWorkflow.length > 0 ? { active_workflow: activeWorkflow[0] } : {}),
});

describe("active Workflow session receipt mapping", () => {
  it("maps the exact public allowlist and drops args, bodies, resources, and paths", () => {
    const mapped = mapActiveWorkflowReceipt({
      ...publicReceipt,
      args: { secret: "PRIVATE ARG" },
      body: "PRIVATE EXPANDED BODY",
      resources: ["/private/resource.md"],
      workspace_path: "/private/tmp/worktree",
      future_private_field: "PRIVATE FUTURE VALUE",
    });

    expect(mapped).toEqual({
      id: "review",
      name: "Review",
      source: "project",
      revision: 12,
      version: "4",
      kind: "instruction",
      invokedBy: "model",
      activatedAt: "2026-08-23T08:00:00Z",
      status: "active",
    });
    const serialized = JSON.stringify(mapped);
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("/private/");
    expect(serialized).not.toContain("args");
    expect(serialized).not.toContain("resources");
  });

  it("fails closed for malformed receipts", () => {
    expect(mapActiveWorkflowReceipt({ ...publicReceipt, revision: -1 })).toBeNull();
    expect(mapActiveWorkflowReceipt({ ...publicReceipt, revision: 0 })).toBeNull();
    expect(mapActiveWorkflowReceipt({ ...publicReceipt, invoked_by: "unknown" })).toBeNull();
    expect(mapActiveWorkflowReceipt({ ...publicReceipt, source: "legacy" })).toBeNull();
    expect(
      mapActiveWorkflowReceipt({ ...publicReceipt, source: "/private/workflow.md" }),
    ).toBeNull();
  });

  it("distinguishes an unhydrated list summary from authoritative detail null", () => {
    expect(sessionSummaryToChatItem(summary() as any)).not.toHaveProperty("activeWorkflow");
    expect(sessionSummaryToChatItem(summary(null) as any)).toHaveProperty("activeWorkflow", null);
    expect(sessionSummaryToChatItem(summary(publicReceipt) as any).activeWorkflow).toMatchObject({
      id: "review",
      invokedBy: "model",
    });
  });
});
