import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configSectionsService, type ConfigSectionEnvelope } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { reapplyConfigChanges, useConfigSectionDraft } from "./useConfigSectionDraft";

const coreEnvelope = (
  revision: number,
  data: { http_proxy?: string; https_proxy?: string },
): ConfigSectionEnvelope<{ http_proxy?: string; https_proxy?: string }> => ({
  data,
  revision,
  loaded_at: "2026-07-23T00:00:00Z",
  source_path: "/tmp/core.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const publish = (value: ConfigSectionEnvelope<{ http_proxy?: string; https_proxy?: string }>) => {
  useConfigSectionStore.setState((state) => ({
    sections: {
      ...state.sections,
      core: { ...state.sections.core, envelope: value },
    },
  }));
};

describe("useConfigSectionDraft", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useConfigSectionStore.getState().reset();
  });

  it("keeps a dirty draft and reapplies only its changes over the latest snapshot", async () => {
    const first = coreEnvelope(1, { http_proxy: "old", https_proxy: "old-https" });
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(first);
    const { result } = renderHook(() => useConfigSectionDraft("core"));

    await waitFor(() => expect(result.current.draft).toEqual(first.data));
    act(() => {
      result.current.setDraft((current) => ({ ...current, http_proxy: "draft" }));
    });

    act(() => {
      publish(coreEnvelope(2, { http_proxy: "external", https_proxy: "new-https" }));
    });
    expect(result.current.draft).toEqual({ http_proxy: "draft", https_proxy: "old-https" });
    expect(result.current.externalRevision).toBe(2);
    expect(result.current.comparison?.latestRevision).toBe(2);

    act(() => result.current.reapply());
    expect(result.current.draft).toEqual({ http_proxy: "draft", https_proxy: "new-https" });
    expect(result.current.externalRevision).toBeNull();
    expect(result.current.dirty).toBe(true);
  });

  it("adopts externally changed arrays when the draft left them untouched", () => {
    expect(
      reapplyConfigChanges(
        { enabled: false, values: ["old"] },
        { enabled: true, values: ["old"] },
        { enabled: false, values: ["external"] },
      ),
    ).toEqual({ enabled: true, values: ["external"] });
  });

  it("adopts an external revision immediately when the form is clean", async () => {
    const first = coreEnvelope(1, { http_proxy: "old" });
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(first);
    const { result } = renderHook(() => useConfigSectionDraft("core"));
    await waitFor(() => expect(result.current.draft).toEqual(first.data));

    act(() => publish(coreEnvelope(2, { http_proxy: "external" })));
    await waitFor(() => expect(result.current.draft).toEqual({ http_proxy: "external" }));
    expect(result.current.externalRevision).toBeNull();
  });
});
