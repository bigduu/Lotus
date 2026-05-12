import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InlineMetaText } from "./InlineMetaText";

describe("InlineMetaText", () => {
  it("renders dot-separated meta items and skips empty entries while preserving zero", () => {
    render(
      <InlineMetaText items={["alpha", null, "", 0, false, "omega"]} data-testid="inline-meta" />,
    );

    expect(screen.getByTestId("inline-meta")).toHaveTextContent("alpha · 0 · omega");
  });

  it("renders nothing when all items are empty", () => {
    const { container } = render(<InlineMetaText items={[null, undefined, false, "   "]} />);

    expect(container.firstChild).toBeNull();
  });
});
