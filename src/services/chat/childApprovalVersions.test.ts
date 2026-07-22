import { beforeEach, describe, expect, it } from "vitest";

import {
  acceptChildApprovalVersion,
  childApprovalVersionKey,
  replaceChildApprovalVersions,
} from "./childApprovalVersions";

describe("child approval version coordinates", () => {
  beforeEach(() => replaceChildApprovalVersions([]));

  it("isolates reused request ids by child attempt", () => {
    const first = childApprovalVersionKey("parent", "child", 1, "request");
    const retry = childApprovalVersionKey("parent", "child", 2, "request");

    expect(acceptChildApprovalVersion(first, 4)).toBe(true);
    expect(acceptChildApprovalVersion(first, 3)).toBe(false);
    expect(acceptChildApprovalVersion(retry, 1)).toBe(true);
  });

  it("seeds unresolved versions from the authoritative snapshot", () => {
    replaceChildApprovalVersions([
      {
        parent_session_id: "parent",
        child_session_id: "child",
        child_attempt: 3,
        request_id: "request",
        tool_name: "Bash",
        permission: "execute",
        resource: "cargo test",
        created_at: "2026-07-22T00:00:00Z",
        updated_at: "2026-07-22T00:00:00Z",
        version: 5,
        state: "pending",
      },
    ]);
    const key = childApprovalVersionKey("parent", "child", 3, "request");

    expect(acceptChildApprovalVersion(key, 5)).toBe(false);
    expect(acceptChildApprovalVersion(key, 6)).toBe(true);
  });
});
