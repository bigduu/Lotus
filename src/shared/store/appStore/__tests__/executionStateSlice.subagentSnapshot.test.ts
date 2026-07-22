import { describe, expect, it } from "vitest";

import type { SubagentSnapshotResponse } from "@services/chat/AgentService";
import { applyExecutionEvent } from "../slices/executionStateSlice";
import type { ExecutionMap } from "../slices/executionStateSlice";

const NOW = "2026-07-22T00:00:00Z";
const now = () => NOW;

const authoritativeSnapshot = (): SubagentSnapshotResponse => ({
  schema_version: 1,
  snapshot_seq: 50,
  approvals_revision: 4,
  generated_at: NOW,
  approvals: [
    {
      parent_session_id: "parent-1",
      child_session_id: "child-current",
      child_attempt: 2,
      request_id: "request-current",
      tool_name: "Bash",
      permission: "execute",
      resource: "cargo test",
      created_at: NOW,
      updated_at: NOW,
      version: 3,
      state: "pending",
    },
    {
      parent_session_id: "parent-1",
      child_session_id: "child-current",
      child_attempt: 2,
      request_id: "request-decided",
      tool_name: "Bash",
      permission: "execute",
      resource: "git status",
      created_at: NOW,
      updated_at: NOW,
      version: 4,
      state: "decision_recorded",
      approved: true,
    },
  ],
  children: [
    {
      parent_session_id: "parent-1",
      child_session_id: "child-current",
      root_session_id: "parent-1",
      child_attempt: 2,
      title: "Current child",
      status: "waiting_for_children",
      created_at: NOW,
      updated_at: NOW,
      last_seen_at: NOW,
      approval_request_ids: ["request-current", "request-decided"],
    },
  ],
});

describe("executionStateSlice authoritative sub-agent snapshot", () => {
  it("replaces stale queues/tree without changing parent phase or generation", () => {
    let map: ExecutionMap = {};
    map = applyExecutionEvent(map, { type: "markOptimisticStart", sessionId: "parent-1" }, now);
    map = applyExecutionEvent(
      map,
      {
        type: "enqueuePendingChildApproval",
        sessionId: "parent-1",
        payload: {
          childSessionId: "child-stale",
          requestId: "request-stale",
          toolName: null,
          permission: null,
          resource: null,
        },
      },
      now,
    );
    map = applyExecutionEvent(
      map,
      {
        type: "dequeuePendingChildApproval",
        sessionId: "parent-1",
        requestId: "request-current",
      },
      now,
    );
    map = applyExecutionEvent(
      map,
      {
        type: "applyChildProgress",
        sessionId: "parent-1",
        childId: "child-stale",
        patch: { status: "running" },
      },
      now,
    );
    map = applyExecutionEvent(
      map,
      {
        type: "applyChildProgress",
        sessionId: "parent-1",
        childId: "child-current",
        patch: { status: "running", outputPreview: "live preview" },
      },
      now,
    );
    const phase = map["parent-1"].phase;
    const generation = map["parent-1"].generation;

    map = applyExecutionEvent(
      map,
      { type: "replaceSubagentSnapshot", snapshot: authoritativeSnapshot() },
      now,
    );

    const parent = map["parent-1"];
    expect(parent.phase).toBe(phase);
    expect(parent.generation).toBe(generation);
    expect(parent.interaction.pendingChildApprovals.map((item) => item.requestId)).toEqual([
      "request-current",
    ]);
    expect(parent.interaction.resolvedChildApprovalRequestIds).not.toContain("request-current");
    expect(parent.interaction.pendingChildApprovals).not.toContainEqual(
      expect.objectContaining({ requestId: "request-decided" }),
    );
    expect(Object.keys(parent.children.byId)).toEqual(["child-current"]);
    expect(parent.children.byId["child-current"]).toMatchObject({
      title: "Current child",
      status: "waiting_children",
      outputPreview: "live preview",
      lastEventAt: NOW,
    });
    expect(parent.children.runningCount).toBe(0);
  });

  it("clears stale account-wide child state when the authoritative snapshot is empty", () => {
    let map: ExecutionMap = {};
    map = applyExecutionEvent(
      map,
      {
        type: "enqueuePendingChildApproval",
        sessionId: "parent-1",
        payload: {
          childSessionId: "child-1",
          requestId: "request-1",
          toolName: null,
          permission: null,
          resource: null,
        },
      },
      now,
    );
    map = applyExecutionEvent(
      map,
      {
        type: "applyChildProgress",
        sessionId: "parent-1",
        childId: "child-1",
        patch: { status: "running" },
      },
      now,
    );
    const empty = authoritativeSnapshot();
    empty.approvals = [];
    empty.children = [];

    map = applyExecutionEvent(map, { type: "replaceSubagentSnapshot", snapshot: empty }, now);

    expect(map["parent-1"].interaction.pendingChildApprovals).toEqual([]);
    expect(map["parent-1"].children).toEqual({ byId: {}, runningCount: 0 });
  });
});
