import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FileChangeViewer from ".";
import type { FileChangeResultPayload } from "@shared/utils/resultFormatters";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const payload: FileChangeResultPayload = {
  operation: "edit",
  message: "Updated the greeting",
  file_path: "src/greeting.ts",
  workspace: "/repo",
  checkpoint: { created: true, path: "/checkpoints/one" },
  diff: {
    unified: [
      "--- a/src/greeting.ts",
      "+++ b/src/greeting.ts",
      "@@ -1 +1 @@",
      "-const greeting = 'hello';",
      "+const greeting = 'hi';",
    ].join("\n"),
    truncated: true,
  },
};

describe("FileChangeViewer", () => {
  it("derives stats, renders metadata, and switches between side-by-side and unified views", () => {
    const { container } = render(<FileChangeViewer payload={payload} />);

    expect(screen.getByText("Updated the greeting")).toBeInTheDocument();
    expect(screen.getByText("src/greeting.ts")).toBeInTheDocument();
    expect(screen.getByText("/repo")).toBeInTheDocument();
    expect(screen.getByText("/checkpoints/one")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
    expect(screen.getByText("components.toolResult.diffTruncated")).toBeInTheDocument();
    expect(container.textContent).toContain("const greeting = 'hello';");
    expect(container.textContent).toContain("const greeting = 'hi';");

    fireEvent.click(screen.getByRole("button", { name: "components.toolResult.unified" }));

    expect(screen.getByText("-const greeting = 'hello';")).toBeInTheDocument();
    expect(screen.getByText("+const greeting = 'hi';")).toBeInTheDocument();
  });

  it("honors an empty unified override and hides optional chrome", () => {
    render(
      <FileChangeViewer
        payload={{ ...payload, diff: { unified: "" } }}
        defaultViewMode="unified"
        unifiedLinesOverride={[]}
        showHeader={false}
        showViewToggle={false}
      />,
    );

    expect(screen.getByText("components.toolResult.noDiffPreview")).toBeInTheDocument();
    expect(screen.queryByText("Updated the greeting")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "components.toolResult.sideBySide" }),
    ).not.toBeInTheDocument();
  });
});
