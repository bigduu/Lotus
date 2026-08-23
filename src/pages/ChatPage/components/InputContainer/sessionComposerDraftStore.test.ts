import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkflowDraft } from "./types";
import {
  getSessionComposerDraftSnapshotForTests,
  resetSessionComposerDraftStoreForTests,
  useSessionComposerDraft,
} from "./sessionComposerDraftStore";
import type { ProcessedFile } from "../../utils/fileUtils";
import type { ImageFile } from "../../utils/imageUtils";

const { cleanupImagePreviewsMock } = vi.hoisted(() => ({
  cleanupImagePreviewsMock: vi.fn(),
}));

vi.mock("../../utils/imageUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/imageUtils")>()),
  cleanupImagePreviews: cleanupImagePreviewsMock,
}));

const workflowDraft: WorkflowDraft = {
  id: "draft-review-12",
  name: "review",
  content: "",
  createdAt: "2026-08-23T00:00:00.000Z",
  type: "skill",
  workflowSelection: {
    id: "review",
    source: "project",
    revision: 12,
    args: { scope: "tests" },
  },
  workflowArgumentsText: '{"scope":"tests"}',
  workflowArgumentsError: null,
  workflowActivationError: null,
};

const attachment = (id: string): ProcessedFile => ({
  id,
  file: new File([id], `${id}.txt`, { type: "text/plain" }),
  name: `${id}.txt`,
  size: id.length,
  type: "text/plain",
  kind: "text",
  content: id,
  preview: id,
  lastModified: 0,
});

const image = (id: string): ImageFile => ({
  id,
  file: new File([id], `${id}.png`, { type: "image/png" }),
  name: `${id}.png`,
  size: id.length,
  type: "image/png",
  base64: `data:image/png;base64,${id}`,
  preview: `blob:${id}`,
});

describe("sessionComposerDraftStore", () => {
  beforeEach(() => cleanupImagePreviewsMock.mockClear());

  afterEach(() => {
    act(() => resetSessionComposerDraftStoreForTests());
    vi.restoreAllMocks();
  });

  it("restores Workflow, file, image, and reference drafts after a real hook remount", () => {
    const first = renderHook(() => useSessionComposerDraft("session-a"));
    const draftAttachment = attachment("file-a");
    const draftImage = image("image-a");

    act(() => {
      first.result.current.setWorkflowDraft(workflowDraft);
      first.result.current.setAttachments([draftAttachment]);
      first.result.current.setImages([draftImage]);
      first.result.current.setFileReferences(
        new Map([
          ["core.ts", { name: "core.ts", path: "/workspace/core.ts", is_directory: false }],
        ]),
      );
    });
    first.unmount();

    const remounted = renderHook(() => useSessionComposerDraft("session-a"));
    expect(remounted.result.current.workflowDraft).toBe(workflowDraft);
    expect(remounted.result.current.attachments).toEqual([draftAttachment]);
    expect(remounted.result.current.images).toEqual([draftImage]);
    expect(remounted.result.current.fileReferences.get("core.ts")?.path).toBe("/workspace/core.ts");
  });

  it("isolates drafts when the same component switches between sessions", () => {
    const { result, rerender } = renderHook(({ sessionId }) => useSessionComposerDraft(sessionId), {
      initialProps: { sessionId: "session-a" },
    });
    const attachmentA = attachment("file-a");
    const imageA = image("image-a");

    act(() => {
      result.current.setWorkflowDraft(workflowDraft);
      result.current.setAttachments([attachmentA]);
      result.current.setImages([imageA]);
    });

    rerender({ sessionId: "session-b" });
    expect(result.current.workflowDraft).toBeNull();
    expect(result.current.attachments).toEqual([]);
    expect(result.current.images).toEqual([]);

    const attachmentB = attachment("file-b");
    act(() => result.current.setAttachments([attachmentB]));
    rerender({ sessionId: "session-a" });

    expect(result.current.workflowDraft).toBe(workflowDraft);
    expect(result.current.attachments).toEqual([attachmentA]);
    expect(result.current.images).toEqual([imageA]);
    expect(getSessionComposerDraftSnapshotForTests("session-b").attachments).toEqual([attachmentB]);
  });

  it("clears only accepted image ids from the originating session and revokes only their URLs", () => {
    const sessionA = renderHook(() => useSessionComposerDraft("session-a"));
    const sessionB = renderHook(() => useSessionComposerDraft("session-b"));
    const accepted = image("accepted");
    const later = image("later");
    const otherSession = image("other-session");

    act(() => {
      sessionA.result.current.setImages([accepted, later]);
      sessionB.result.current.setImages([otherSession]);
    });
    act(() => sessionA.result.current.clearImages([accepted.id]));

    expect(getSessionComposerDraftSnapshotForTests("session-a").images).toEqual([later]);
    expect(getSessionComposerDraftSnapshotForTests("session-b").images).toEqual([otherSession]);
    expect(cleanupImagePreviewsMock).toHaveBeenCalledTimes(1);
    expect(cleanupImagePreviewsMock).toHaveBeenCalledWith([accepted]);
  });
});
