import { describe, expect, it, vi } from "vitest";
import { BambooWorkflowMigrationClient } from "../clients";

describe("BambooWorkflowMigrationClient", () => {
  it("posts the encoded workflow id with only the trusted session scope", async () => {
    const post = vi.fn(async () => ({
      workflow_id: "review/legacy",
      outcome: "migrated" as const,
      source_preserved: true as const,
      catalog_revision: 8,
    }));
    const client = new BambooWorkflowMigrationClient(post);

    const result = await client.migrate("review/legacy", "session-561");

    expect(post).toHaveBeenCalledWith("bamboo/workflow-catalog/review%2Flegacy/migrate", {
      session_id: "session-561",
    });
    expect(result.source_preserved).toBe(true);
  });
});
