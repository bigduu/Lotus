import { afterEach, describe, expect, it } from "vitest";

import { clearUsedModels, getUsedModels, recordUsedModel, removeUsedModel } from "../usedModels";

describe("usedModels registry", () => {
  afterEach(() => {
    clearUsedModels();
  });

  it("returns empty when nothing has been recorded", () => {
    expect(getUsedModels()).toEqual([]);
  });

  it("records a model and reads it back", () => {
    recordUsedModel("gpt-4o");
    expect(getUsedModels()).toEqual(["gpt-4o"]);
  });

  it("ignores empty, whitespace, and nullish models", () => {
    recordUsedModel("");
    recordUsedModel("   ");
    recordUsedModel(undefined);
    recordUsedModel(null);
    expect(getUsedModels()).toEqual([]);
  });

  it("dedupes and moves a re-used model to the front (most-recent-first)", () => {
    recordUsedModel("a");
    recordUsedModel("b");
    recordUsedModel("a");
    expect(getUsedModels()).toEqual(["a", "b"]);
  });

  it("trims surrounding whitespace", () => {
    recordUsedModel("  gpt-4o  ");
    expect(getUsedModels()).toEqual(["gpt-4o"]);
  });

  it("removes a model from the registry", () => {
    recordUsedModel("gpt-4o");
    recordUsedModel("glm-5.1");
    expect(removeUsedModel("gpt-4o")).toEqual(["glm-5.1"]);
    expect(getUsedModels()).toEqual(["glm-5.1"]);
    // Removing a non-existent / empty model is a safe no-op.
    expect(removeUsedModel("not-there")).toEqual(["glm-5.1"]);
    expect(removeUsedModel("")).toEqual(["glm-5.1"]);
  });

  it("recovers from a corrupt storage payload", () => {
    window.localStorage.setItem("zenith.usedModels.v1", "{not valid json");
    expect(getUsedModels()).toEqual([]);
    recordUsedModel("ok");
    expect(getUsedModels()).toEqual(["ok"]);
  });
});
