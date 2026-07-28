import { describe, expect, it } from "vitest";

import { ApiError } from "@services/api";
import i18n from "@shared/i18n";
import {
  getWorkspaceSwitchErrorCode,
  getWorkspaceSwitchErrorMessage,
} from "./workspaceSwitchErrors";

const structuredError = (status: number, code: string): ApiError =>
  new ApiError(
    `Backend rejected ${code}`,
    status,
    status === 412 ? "Precondition Failed" : "Conflict",
    JSON.stringify({ error: { type: "api_error", code, message: code } }),
  );

describe("workspaceSwitchErrors (#155)", () => {
  it.each([
    ["project_workspace_unbound", "chat.workspace.switchUnbound"],
    ["project_workspace_conflict", "chat.workspace.switchOwnedByAnotherProject"],
    ["project_archived", "chat.workspace.switchProjectArchived"],
    ["project_unavailable", "chat.workspace.switchProjectUnavailable"],
    ["session_project_running_conflict", "chat.workspace.switchSessionRunning"],
    ["workspace_invalid", "chat.workspace.switchInvalidPath"],
  ])("maps structured 409 code %s to distinct UI copy", (code, translationKey) => {
    const error = structuredError(409, code);

    expect(getWorkspaceSwitchErrorCode(error)).toBe(code);
    expect(getWorkspaceSwitchErrorMessage(error)).toBe(i18n.t(translationKey));
  });

  it("uses the stale-revision recovery copy for every 412", () => {
    expect(getWorkspaceSwitchErrorMessage(structuredError(412, "metadata_version_conflict"))).toBe(
      i18n.t("chat.workspace.switchRevisionConflict"),
    );
  });

  it("falls back to an ordinary Error message when no structured code exists", () => {
    expect(getWorkspaceSwitchErrorMessage(new Error("backend unavailable"))).toBe(
      "backend unavailable",
    );
  });
});
