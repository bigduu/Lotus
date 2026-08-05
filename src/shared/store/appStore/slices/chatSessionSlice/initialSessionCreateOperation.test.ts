import { beforeEach, describe, expect, it } from "vitest";

import {
  acquireInitialSessionCreateOperation,
  clearInitialSessionCreateOperation,
  resetInitialSessionCreateOperationMemoryForTest,
} from "./initialSessionCreateOperation";

describe("initial session-create operation", () => {
  beforeEach(() => {
    clearInitialSessionCreateOperation();
  });

  it("restores the same key and exact request after a same-tab reload", () => {
    const first = acquireInitialSessionCreateOperation({
      title: "Original title",
      title_generated: false,
      model: "original-model",
      provider: undefined,
    });

    expect(first.isNew).toBe(true);
    expect(first.operation.idempotencyKey).toMatch(/^lotus-session-.+/);
    expect(first.operation.createdAtMs).toEqual(expect.any(Number));
    expect(first.operation.request).toEqual({
      title: "Original title",
      title_generated: false,
      model: "original-model",
    });

    // A document reload clears module state but retains sessionStorage. Even
    // if locale/provider defaults changed, the original wire payload wins.
    resetInitialSessionCreateOperationMemoryForTest();
    const resumed = acquireInitialSessionCreateOperation({
      title: "Changed title",
      model: "changed-model",
      provider: "changed-provider",
    });

    expect(resumed).toEqual({
      isNew: false,
      operation: first.operation,
    });
  });
});
