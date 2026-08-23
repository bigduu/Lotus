import { describe, expect, it } from "vitest";

import { ApiError } from "@services/api";
import {
  defaultWorkflowArguments,
  parseWorkflowArguments,
  toWorkflowSelectionError,
  validateWorkflowArguments,
} from "../activation";

describe("typed Workflow activation", () => {
  const schema = {
    type: "object",
    properties: {
      scope: { type: "string", default: "src" },
      strict: { type: "boolean" },
    },
    required: ["scope"],
    additionalProperties: false,
  };

  it("builds defaults and validates a JSON object without copying schema metadata", () => {
    expect(defaultWorkflowArguments(schema)).toEqual({ scope: "src" });
    expect(parseWorkflowArguments('{"scope":"tests","strict":true}', schema)).toEqual({
      args: { scope: "tests", strict: true },
      error: null,
    });
    expect(validateWorkflowArguments({ scope: 42 }, schema)).toContain("must be string");
    expect(validateWorkflowArguments({ scope: "src", extra: true }, schema)).toContain("Unknown");
  });

  it("rejects invalid JSON, arrays, and missing required properties", () => {
    expect(parseWorkflowArguments("{", schema).error).toContain("valid JSON");
    expect(parseWorkflowArguments("[]", schema).error).toContain("JSON object");
    expect(parseWorkflowArguments("{}", schema).error).toContain("Missing required");
  });

  it("recognizes stale and invalid Workflow errors without classifying unrelated conflicts", () => {
    const stale = new ApiError(
      "stale",
      409,
      "Conflict",
      JSON.stringify({
        error: {
          code: "workflow_revision_mismatch",
          message: "The selected Workflow changed. Refresh and reselect it.",
          recoverable: true,
        },
      }),
    );
    expect(toWorkflowSelectionError(stale)).toMatchObject({
      code: "workflow_revision_mismatch",
      recoverable: true,
      status: 409,
      message: "The selected Workflow changed. Refresh and reselect it.",
    });

    const running = new ApiError(
      "running",
      409,
      "Conflict",
      JSON.stringify({
        error: {
          code: "workflow_activation_running_conflict",
          message: "Wait for the current run, then reselect.",
        },
      }),
    );
    expect(toWorkflowSelectionError(running)).toMatchObject({
      code: "workflow_activation_running_conflict",
      recoverable: true,
      status: 409,
    });

    const unrelated = new ApiError(
      "project conflict",
      409,
      "Conflict",
      JSON.stringify({ error: { code: "project_workspace_conflict" } }),
    );
    expect(toWorkflowSelectionError(unrelated)).toBeNull();
  });
});
