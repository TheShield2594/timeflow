import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_WORKING_HOURS, normalizeWorkingHours } from "./useWorkingHours";

vi.mock("@microsoft/power-apps/app", () => ({ getContext: vi.fn() }));
vi.mock("../services/userService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/userService")>()),
  getCurrentUser: () => ({ id: "user-1", email: "u@example.com", displayName: "U", environmentId: "env-1" }),
}));
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

beforeEach(() => { localStorage.clear(); });

/**
 * Gap detection was hardcoded to 08:00–18:00, which is a correctness bug
 * rather than a preference: anyone on a different shift was told their day
 * was complete while two hours of it sat outside the search window. Making
 * it configurable only helps if a nonsense setting can't make it worse.
 */
describe("normalizeWorkingHours", () => {
  it("falls back to the defaults for a missing or unreadable value", () => {
    expect(normalizeWorkingHours(null)).toEqual(DEFAULT_WORKING_HOURS);
    expect(normalizeWorkingHours({ startMin: NaN, endMin: NaN })).toEqual(DEFAULT_WORKING_HOURS);
  });

  it("refuses a day that ends at or before it starts", () => {
    // An inverted window makes findUntrackedGaps return nothing at all, which
    // is the exact failure this setting exists to prevent.
    expect(normalizeWorkingHours({ startMin: 600, endMin: 600 }).endMin).toBe(DEFAULT_WORKING_HOURS.endMin);
    expect(normalizeWorkingHours({ startMin: 600, endMin: 120 }).endMin).toBe(DEFAULT_WORKING_HOURS.endMin);
  });

  it("keeps a genuinely early or late shift", () => {
    expect(normalizeWorkingHours({ startMin: 5 * 60, endMin: 13 * 60 }))
      .toEqual({ startMin: 300, endMin: 780, gapMustExceedMinutes: DEFAULT_WORKING_HOURS.gapMustExceedMinutes });
  });

  it("clamps the day to the clock face and the floor to something sane", () => {
    const hours = normalizeWorkingHours({ startMin: -60, endMin: 5000, gapMustExceedMinutes: 9999 });
    expect(hours.startMin).toBe(0);
    expect(hours.endMin).toBe(24 * 60);
    expect(hours.gapMustExceedMinutes).toBe(240);
  });

  it("allows a zero floor — every hole, however short", () => {
    expect(normalizeWorkingHours({ gapMustExceedMinutes: 0 }).gapMustExceedMinutes).toBe(0);
  });
});
