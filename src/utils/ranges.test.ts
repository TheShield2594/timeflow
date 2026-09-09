import { describe, it, expect } from "vitest";
import { previousPeriod, rangeLabel, resolveRange } from "./ranges";

// Wednesday 9 September 2026. Its week runs Mon 7 – Sun 13.
const WED = "2026-09-09";

describe("resolveRange", () => {
  it("resolves a week to Monday through Sunday, not to the last seven days", () => {
    expect(resolveRange({ preset: "thisWeek", customFrom: "", customTo: "" }, WED))
      .toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(resolveRange({ preset: "lastWeek", customFrom: "", customTo: "" }, WED))
      .toEqual({ from: "2026-08-31", to: "2026-09-06" });
  });

  it("resolves month and quarter to the calendar period, ending today", () => {
    expect(resolveRange({ preset: "month", customFrom: "", customTo: "" }, WED))
      .toEqual({ from: "2026-09-01", to: WED });
    // September is in Q3, which starts in July.
    expect(resolveRange({ preset: "quarter", customFrom: "", customTo: "" }, WED))
      .toEqual({ from: "2026-07-01", to: WED });
  });

  it("reads a reversed custom range as the span the user drew", () => {
    // Two date pickers get filled in either order. A reversed pair matches no
    // entry at all, so the page reads "nothing logged" for a window that does
    // have time in it.
    expect(resolveRange({ preset: "custom", customFrom: "2026-09-30", customTo: "2026-09-01" }, WED))
      .toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("collapses a half-typed custom range to today rather than to all of history", () => {
    // A `from` of "" would compare below every real date and turn the next
    // read into the user's entire history.
    expect(resolveRange({ preset: "custom", customFrom: "", customTo: "2026-09-30" }, WED))
      .toEqual({ from: WED, to: "2026-09-30" });
  });
});

describe("previousPeriod", () => {
  it("steps back by the range's own length, inclusive of both ends", () => {
    expect(previousPeriod("2026-09-07", "2026-09-13"))
      .toEqual({ from: "2026-08-31", to: "2026-09-06" });
  });
});

describe("rangeLabel", () => {
  it("names the month once when both ends share it", () => {
    expect(rangeLabel("2026-09-07", "2026-09-13")).toBe("September 7 – 13");
  });

  it("names both months when the range crosses one", () => {
    expect(rangeLabel("2026-08-31", "2026-09-06")).toBe("August 31 – September 6");
  });
});
