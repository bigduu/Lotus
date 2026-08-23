import { describe, expect, it, vi } from "vitest";
import type { WorkflowCatalogAdapter } from "../catalogAdapters";
import { WorkflowCatalogQuery } from "../catalogQuery";
import type { WorkflowCatalogView } from "../domain";

const view = (revision: number): WorkflowCatalogView => ({
  revision,
  items: [],
  diagnostics: [],
  capabilities: {
    mode: "typed",
    clone: false,
    edit: false,
    activate: false,
    run: false,
    cancel: false,
  },
});

describe("WorkflowCatalogQuery", () => {
  it("uses a session-scoped cache and accepts duplicate or lower event revisions", async () => {
    let now = 1_000;
    const load = vi
      .fn<WorkflowCatalogAdapter["load"]>()
      .mockResolvedValueOnce(view(1))
      .mockResolvedValueOnce(view(2))
      .mockResolvedValueOnce(view(3))
      .mockResolvedValueOnce(view(4))
      .mockResolvedValueOnce(view(5));
    const query = new WorkflowCatalogQuery({ load }, 30_000, () => now);
    const listener = vi.fn();
    const unsubscribe = query.subscribe(listener);

    await expect(query.load({ sessionId: "session-a" })).resolves.toMatchObject({ revision: 1 });
    await expect(query.load({ sessionId: "session-a" })).resolves.toMatchObject({ revision: 1 });
    expect(load).toHaveBeenCalledTimes(1);

    expect(
      query.invalidate({
        type: "workflow_invalid",
        workflowId: "review",
        revision: 2,
        scope: "user",
      }),
    ).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    await expect(query.load({ sessionId: "session-a" })).resolves.toMatchObject({ revision: 2 });

    expect(
      query.invalidate({
        type: "workflow_invalid",
        workflowId: "review",
        revision: 2,
        scope: "user",
      }),
    ).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    await expect(query.load({ sessionId: "session-a" })).resolves.toMatchObject({ revision: 3 });

    expect(
      query.invalidate({
        type: "workflow_invalid",
        workflowId: "review",
        revision: 1,
        scope: "user",
      }),
    ).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);
    await expect(query.load({ sessionId: "session-a" })).resolves.toMatchObject({ revision: 4 });

    now += 30_001;
    await expect(query.load({ sessionId: "session-a" })).resolves.toMatchObject({ revision: 5 });
    expect(load).toHaveBeenCalledTimes(5);
    unsubscribe();
  });

  it("does not let an invalidated in-flight response replace a newer cache entry", async () => {
    let resolveOld!: (value: WorkflowCatalogView) => void;
    let resolveNew!: (value: WorkflowCatalogView) => void;
    const load = vi
      .fn<WorkflowCatalogAdapter["load"]>()
      .mockImplementationOnce(
        () => new Promise<WorkflowCatalogView>((resolve) => (resolveOld = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise<WorkflowCatalogView>((resolve) => (resolveNew = resolve)),
      );
    const query = new WorkflowCatalogQuery({ load });

    const oldRequest = query.load({ sessionId: "session-a" });
    query.invalidate({
      type: "workflow_changed",
      workflowId: "review",
      revision: 2,
      scope: "user",
    });
    const newRequest = query.load({ sessionId: "session-a" });

    resolveNew(view(2));
    await expect(newRequest).resolves.toMatchObject({ revision: 2 });
    resolveOld(view(1));
    await expect(oldRequest).resolves.toMatchObject({ revision: 1 });
    await expect(query.load({ sessionId: "session-a" })).resolves.toMatchObject({ revision: 2 });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
