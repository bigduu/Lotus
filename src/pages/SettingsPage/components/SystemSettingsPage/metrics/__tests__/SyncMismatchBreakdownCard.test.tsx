import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SyncMismatchBreakdownCard from "../SyncMismatchBreakdownCard";

describe("SyncMismatchBreakdownCard", () => {
  it("renders empty state when no breakdown data exists", () => {
    render(<SyncMismatchBreakdownCard breakdown={{}} loading={false} />);

    expect(screen.getByText(/No sync mismatches recorded/i)).toBeInTheDocument();
  });

  it("renders mismatch summary content when breakdown data is provided", () => {
    render(
      <SyncMismatchBreakdownCard
        breakdown={{
          message_count: 3,
          pending_question: 1,
        }}
        loading={false}
      />,
    );

    expect(screen.getByText(/Sync Mismatch Breakdown/i)).toBeInTheDocument();
    expect(screen.getByText(/Grouped by execute sync mismatch reason/i)).toBeInTheDocument();
  });
});
