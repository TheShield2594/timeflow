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

  it("never returns an inverted window, even when the fallback is the problem", () => {
    // The SettingsSheet reaches this: "day starts 23:59, day ends 00:00" made
    // the end fall back to the 18:00 default *behind* the 23:59 start, and the
    // stored window was gapless — the exact failure this function exists to
    // prevent, produced by its own fallback.
    const hours = normalizeWorkingHours({ startMin: 23 * 60 + 59, endMin: 0 });
    expect(hours.endMin).toBeGreaterThan(hours.startMin);

    // And when the end is earlier than the default start, the day opens at
    // midnight rather than collapsing.
    const early = normalizeWorkingHours({ startMin: 900, endMin: 60 });
    expect(early.endMin).toBeGreaterThan(early.startMin);
  });

  it("clamps the day to the clock face and the floor to something sane", () => {
    const hours = normalizeWorkingHours({ startMin: -60, endMin: 5000, gapMustExceedMinutes: 9999 });
    expect(hours.startMin).toBe(0);
    expect(hours.endMin).toBe(24 * 60 - 1);
    expect(hours.gapMustExceedMinutes).toBe(240);
  });

  it("keeps the window inside what the settings sheet can express", () => {
    // These are read and written through <input type="time">, whose range is
    // 00:00–23:59. A stored 24:00 has no representation there: it renders as
    // 00:00, reads back as 0, fails `endMin > startMin`, and silently resets
    // the whole window to the 18:00 default — so a day that ends at midnight
    // is held at 23:59, which the search window loses nothing meaningful to.
    expect(normalizeWorkingHours({ startMin: 6 * 60, endMin: 24 * 60 }).endMin).toBe(24 * 60 - 1);
    expect(normalizeWorkingHours({ startMin: 24 * 60, endMin: 24 * 60 }).startMin).toBeLessThan(24 * 60 - 1);
  });

  it("allows a zero floor — every hole, however short", () => {
    expect(normalizeWorkingHours({ gapMustExceedMinutes: 0 }).gapMustExceedMinutes).toBe(0);
  });
});
