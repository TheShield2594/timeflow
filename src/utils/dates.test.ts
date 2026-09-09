import { describe, it, expect, vi, afterEach } from "vitest";
import {
  localDateStr, localDateDaysAgo, addDaysStr, weekStartStr, friendlyDate, toTimeInput,
  clockAt, clockAtCompact, timeInputAt,
  minutesOfDay, dateAtMinutes, isoAtMinutes, minutesBetween, dayLengthMinutes,
} from "./dates";

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

describe("addDaysStr", () => {
  it("adds a day within a month", () => {
    expect(addDaysStr("2026-07-07", 1)).toBe("2026-07-08");
  });

  it("rolls over month and year boundaries", () => {
    expect(addDaysStr("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysStr("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles leap-day rollover", () => {
    expect(addDaysStr("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysStr("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("lands on the exact next calendar day across a DST transition (not 24h later)", () => {
    // US DST starts 2026-03-08 (America/New_York): that day is only 23 hours
    // long, so start-midnight + 24h would land on 03-09T01:00, not midnight.
    vi.stubEnv("TZ", "America/New_York");
    expect(addDaysStr("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDaysStr("2026-03-08", 1)).toBe("2026-03-09");
  });
});

describe("weekStartStr", () => {
  it("returns the Monday of the containing week", () => {
    expect(weekStartStr("2026-07-14")).toBe("2026-07-13"); // Tue → Mon
    expect(weekStartStr("2026-07-13")).toBe("2026-07-13"); // Mon → itself
    expect(weekStartStr("2026-07-19")).toBe("2026-07-13"); // Sun → previous Mon
  });

  it("crosses month and year boundaries", () => {
    expect(weekStartStr("2026-01-01")).toBe("2025-12-29"); // Thu → Mon in prior year
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
    // Month-first, matching every other date in the app — see DATE_LOCALE.
    expect(friendlyDate("2024-06-01")).toBe("Saturday, June 1");
    expect(friendlyDate("2024-06-01")).toBe(
      new Date("2024-06-01T00:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    );
  });
});

describe("clockAt / clockAtCompact / timeInputAt", () => {
  it("reads times back on a 12-hour clock (#152)", () => {
    expect(clockAt(0)).toBe("12:00 AM");
    expect(clockAt(9 * 60 + 5)).toBe("9:05 AM");
    expect(clockAt(12 * 60)).toBe("12:00 PM");
    expect(clockAt(17 * 60 + 30)).toBe("5:30 PM");
  });

  it("clamps to the clock face at both ends", () => {
    expect(clockAt(-30)).toBe("12:00 AM");
    // 1440 is the end of this day; a 12-hour clock cannot say that in the
    // notation itself, so it reads the same as its start.
    expect(clockAt(24 * 60)).toBe("12:00 AM");
    expect(clockAt(25 * 60)).toBe("12:00 AM");
  });

  it("drops the minutes on the hour for axis ticks, and keeps them otherwise", () => {
    expect(clockAtCompact(9 * 60)).toBe("9 AM");
    expect(clockAtCompact(12 * 60)).toBe("12 PM");
    expect(clockAtCompact(9 * 60 + 30)).toBe("9:30 AM");
  });

  it("keeps <input type=\"time\"> values on the 24-hour clock the element takes", () => {
    // The element renders in the user's locale, but its *value* is always
    // this. Swapping in clockAt here would silently empty every time field.
    expect(timeInputAt(0)).toBe("00:00");
    expect(timeInputAt(9 * 60 + 5)).toBe("09:05");
    expect(timeInputAt(17 * 60 + 30)).toBe("17:30");
  });

  it("never emits an hour the element would reject", () => {
    // A valid HTML time string runs 00:00–23:59. "24:00" is not one, and the
    // browser sanitizes an invalid value to the empty string — so a span
    // ending at the end of the day rendered a *blank* end-time field.
    // 1440 wraps to the next day's 00:00, which is the same instant and which
    // EntrySheet already reads as "ends next day".
    expect(timeInputAt(24 * 60)).toBe("00:00");
    expect(timeInputAt(25 * 60)).toBe("00:00");
    for (let m = 0; m <= 24 * 60; m++) {
      expect(Number(timeInputAt(m).slice(0, 2))).toBeLessThan(24);
    }
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

// The suite runs in America/New_York (vitest.config.ts) so these transitions
// are real: 2026-03-08 loses 02:00–03:00, 2026-11-01 repeats 01:00–02:00.
const SPRING_FORWARD = "2026-03-08";
const FALL_BACK = "2026-11-01";

describe("dateAtMinutes", () => {
  it("places a minutes-of-day offset on the local clock", () => {
    const d = dateAtMinutes("2026-06-15", 9 * 60 + 30);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
    expect(localDateStr(d)).toBe("2026-06-15");
  });

  it("treats a full day as the next day's midnight", () => {
    const d = dateAtMinutes("2026-06-15", 24 * 60);
    expect(localDateStr(d)).toBe("2026-06-16");
    expect(d.getHours()).toBe(0);
  });

  it("walks the calendar for the day the clocks go back, not 24h of milliseconds", () => {
    // Midnight-to-midnight is 25 hours here; adding 1440 minutes of elapsed
    // time would land at 23:00 on the same day instead.
    const d = dateAtMinutes(FALL_BACK, 24 * 60);
    expect(localDateStr(d)).toBe("2026-11-02");
    expect(d.getHours()).toBe(0);
  });

  it("normalizes an hour that the clocks skip, so callers must not trust the offset back", () => {
    // 02:00 does not exist on the spring-forward day: both offsets resolve to
    // the same instant, which is exactly why durations can't be built by
    // subtracting minutes-of-day (#87).
    expect(dateAtMinutes(SPRING_FORWARD, 120).getTime())
      .toBe(dateAtMinutes(SPRING_FORWARD, 180).getTime());
  });
});

describe("isoAtMinutes", () => {
  it("is dateAtMinutes as a storable timestamp", () => {
    expect(isoAtMinutes("2026-06-15", 9 * 60)).toBe(dateAtMinutes("2026-06-15", 9 * 60).toISOString());
  });
});

describe("minutesBetween", () => {
  it("measures an ordinary span", () => {
    expect(minutesBetween("2026-06-15T09:00:00", "2026-06-15T10:30:00")).toBe(90);
  });

  it("counts the extra hour on the day the clocks go back", () => {
    // 01:00 → 03:00 is three hours here. Subtracting minutes-of-day says two,
    // and the timesheet under-bills the hour that was actually worked.
    expect(minutesBetween(`${FALL_BACK}T01:00:00`, `${FALL_BACK}T03:00:00`)).toBe(180);
  });

  it("counts the missing hour on the day the clocks go forward", () => {
    expect(minutesBetween(`${SPRING_FORWARD}T01:00:00`, `${SPRING_FORWARD}T04:00:00`)).toBe(120);
  });

  it("accepts Date instances as well as ISO strings", () => {
    expect(minutesBetween(new Date(2026, 5, 15, 9, 0), new Date(2026, 5, 15, 9, 45))).toBe(45);
  });
});

describe("dayLengthMinutes", () => {
  it("is 1440 on an ordinary day", () => {
    expect(dayLengthMinutes("2026-06-15")).toBe(1440);
  });

  it("is an hour short when the clocks go forward", () => {
    expect(dayLengthMinutes(SPRING_FORWARD)).toBe(1380);
  });

  it("is an hour long when the clocks go back", () => {
    expect(dayLengthMinutes(FALL_BACK)).toBe(1500);
  });
});
