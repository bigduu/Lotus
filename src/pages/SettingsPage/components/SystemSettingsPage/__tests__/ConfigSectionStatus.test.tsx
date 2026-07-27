import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configSectionsService } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { configErrorMessage, redactConfigError } from "@shared/utils/configErrors";
import ConfigSectionStatus from "../ConfigSectionStatus";

const coreEnvelope = (revision: number) => ({
  data: { http_proxy: "http://localhost:8080" },
  revision,
  loaded_at: "2026-07-26T00:00:00.000Z",
  source_path: "/tmp/core.json",
  source_kind: "file" as const,
  status: "healthy" as const,
  last_error: null,
});

describe("ConfigSectionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("redacts structured credentials, authorization headers, URLs, and private keys", () => {
    const error = [
      'api_key: "sk-live-secret"',
      '"password":"hunter2"',
      "Authorization=Bearer abc.def.ghi",
      "https://alice:supersecret@example.com/config",
      "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
    ].join("\n");

    const redacted = redactConfigError(error);

    expect(redacted).not.toContain("sk-live-secret");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).not.toContain("supersecret");
    expect(redacted).not.toContain("private-material");
    expect(redacted).toContain("[redacted]");
  });

  it("redacts errors before component-local catch blocks can display or log them", () => {
    const message = configErrorMessage(
      new Error("device_key=private-device-key"),
      "Configuration failed",
    );

    expect(message).toBe("device_key=[redacted]");
    expect(configErrorMessage({ reason: "opaque" }, "Configuration failed")).toBe(
      "Configuration failed",
    );
  });

  it("renders the exact revision conflict and reloads the latest snapshot", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        core: {
          ...state.sections.core,
          envelope: coreEnvelope(4),
          error: "revision conflict",
          conflict: {
            expectedRevision: 4,
            currentRevision: 5,
            message: "revision conflict",
          },
        },
      },
    }));
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(coreEnvelope(5) as never);

    render(<ConfigSectionStatus sections={["core"]} />);

    expect(screen.getByText("core revision conflict")).toBeInTheDocument();
    expect(
      screen.getByText(/expected revision 4; the server is at revision 5/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));

    await waitFor(() => {
      expect(configSectionsService.getSection).toHaveBeenCalledWith("core");
      expect(useConfigSectionStore.getState().sections.core.envelope?.revision).toBe(5);
      expect(useConfigSectionStore.getState().sections.core.conflict).toBeNull();
    });
  });
});
