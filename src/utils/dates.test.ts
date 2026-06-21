import { describe, it, expect, vi, afterEach } from "vitest";
import { localDateStr, localDateDaysAgo, friendlyDate, toTimeInput, minutesOfDay } from "./dates";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("localDateStr", () => {
  it("formats a given date as YYYY-MM-DD using local time", () => {
    expect(localDateStr(new Date(2024, 0, 5))).toBe("2024-01-05");
  });

  it("pads single-digit month and day", () => {
    expect(localDateStr(new Date(2024, 8, 9))).toBe("2024-09-09");
  });

  it("defaults to the current local date when no argument is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 5, 15, 10, 0, 0));
    expect(localDateStr()).toBe("2024-06-15");
  });

  it("does not roll the date forward near local midnight (the UTC bug this helper avoids)", () => {
    expect(localDateStr(new Date(2024, 11, 31, 23, 30))).toBe("2024-12-31");
  });
});

describe("localDateDaysAgo", () => {
  it("returns today's local date for 0 days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 5, 15, 12));
    expect(localDateDaysAgo(0)).toBe("2024-06-15");
  });

  it("subtracts days across a leap-year month boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 2, 1, 12)); // Mar 1, 2024
    expect(localDateDaysAgo(1)).toBe("2024-02-29");
  });

  it("subtracts days across a year boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 1, 12)); // Jan 1, 2024
    expect(localDateDaysAgo(1)).toBe("2023-12-31");
  });

  it("subtracts a day correctly across the spring-forward DST transition", () => {
    // Fixed in UTC, this transition wouldn't move the clock at all, so force
    // a DST-observing zone to actually exercise the transition.
    vi.stubEnv("TZ", "America/New_York");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 2, 10, 12)); // Mar 10, 2024 — US spring-forward day
    expect(localDateDaysAgo(1)).toBe("2024-03-09");
  });

  it("subtracts a day correctly across the fall-back DST transition", () => {
    vi.stubEnv("TZ", "America/New_York");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 10, 3, 12)); // Nov 3, 2024 — US fall-back day
    expect(localDateDaysAgo(1)).toBe("2024-11-02");
  });
});

describe("friendlyDate", () => {
  it("returns 'Today' for the current local date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 5, 15, 9));
    expect(friendlyDate("2024-06-15")).toBe("Today");
  });

  it("returns 'Yesterday' for the previous local date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 5, 15, 9));
    expect(friendlyDate("2024-06-14")).toBe("Yesterday");
  });

  it("returns a long weekday/month/day string for any other date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 5, 15, 9));
    expect(friendlyDate("2024-06-01")).toBe(
      new Date("2024-06-01T00:00:00").toLocaleDateString("en", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    );
  });
});

describe("toTimeInput", () => {
  it("formats local hours and minutes with zero padding", () => {
    const d = new Date(2024, 5, 15, 9, 5);
    expect(toTimeInput(d.toISOString())).toBe(
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    );
  });
});

describe("minutesOfDay", () => {
  it("returns 0 at local midnight", () => {
    expect(minutesOfDay(new Date(2024, 5, 15, 0, 0).toISOString())).toBe(0);
  });

  it("returns 1439 at the last minute of the day", () => {
    expect(minutesOfDay(new Date(2024, 5, 15, 23, 59).toISOString())).toBe(1439);
  });

  it("computes hours * 60 + minutes for an arbitrary time", () => {
    expect(minutesOfDay(new Date(2024, 5, 15, 14, 30).toISOString())).toBe(14 * 60 + 30);
  });
});
