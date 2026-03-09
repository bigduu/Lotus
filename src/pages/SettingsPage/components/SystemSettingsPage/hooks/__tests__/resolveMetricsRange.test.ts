import { describe, expect, it } from "vitest";

import { resolveMetricsRange } from "../resolveMetricsRange";

describe("resolveMetricsRange", () => {
  it("uses explicit start and end date when provided", () => {
    const range = resolveMetricsRange({
      startDate: "2026-02-01",
      endDate: "2026-02-10",
      days: 30,
    });

    expect(range).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-10",
      days: 10,
    });
  });

  it("derives start date from days and end date", () => {
    const range = resolveMetricsRange({
      endDate: "2026-02-10",
      days: 7,
    });

    expect(range).toEqual({
      startDate: "2026-02-04",
      endDate: "2026-02-10",
      days: 7,
    });
  });

  it("uses current date as fallback end date", () => {
    const range = resolveMetricsRange(
      {
        days: 3,
      },
      new Date("2026-03-09T08:00:00.000Z"),
    );

    expect(range).toEqual({
      startDate: "2026-03-07",
      endDate: "2026-03-09",
      days: 3,
    });
  });
});
