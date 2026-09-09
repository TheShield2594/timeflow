import { describe, it, expect } from "vitest";
import {
  MINUTES_PER_DAY,
  PX_PER_MIN,
  SLOT_HEIGHT,
  TOTAL_SLOTS,
  clampMoveStart,
  clockLabel,
  dayIndexFromClientX,
  formatSlotTime,
  getWeekDays,
  layoutDay,
  placeEntry,
  rowFromOffsetY,
  snapMinutesFromOffsetY,
} from "./calendarGeometry";
import { localDateStr } from "./dates";
import type { TimeEntry } from "../types";
describe("rowFromOffsetY", () => {
  it("maps an offset to the 30-minute slot it lands in", () => {
    expect(rowFromOffsetY(0)).toBe(0);
    expect(rowFromOffsetY(SLOT_HEIGHT - 1)).toBe(0);
    expect(rowFromOffsetY(SLOT_HEIGHT)).toBe(1);
    // 09:00 is the 18th slot (9 hours × 2 slots).
    expect(rowFromOffsetY(9 * 60 * PX_PER_MIN)).toBe(18);
  });

  it("clamps to the grid rather than returning an out-of-range row", () => {
    expect(rowFromOffsetY(-500)).toBe(0);
    expect(rowFromOffsetY(TOTAL_SLOTS * SLOT_HEIGHT + 500)).toBe(TOTAL_SLOTS - 1);
  });
});

describe("snapMinutesFromOffsetY", () => {
  it("snaps to the nearest quarter hour", () => {
    expect(snapMinutesFromOffsetY(0)).toBe(0);
    expect(snapMinutesFromOffsetY(7 * PX_PER_MIN)).toBe(0);
    expect(snapMinutesFromOffsetY(8 * PX_PER_MIN)).toBe(15);
    expect(snapMinutesFromOffsetY(22 * PX_PER_MIN)).toBe(15);
    expect(snapMinutesFromOffsetY(23 * PX_PER_MIN)).toBe(30);
    expect(snapMinutesFromOffsetY(9 * 60 * PX_PER_MIN)).toBe(540);
  });

  it("clamps to the day, allowing end-of-day midnight", () => {
    expect(snapMinutesFromOffsetY(-40)).toBe(0);
    expect(snapMinutesFromOffsetY(MINUTES_PER_DAY * PX_PER_MIN + 300)).toBe(MINUTES_PER_DAY);
  });
});

describe("dayIndexFromClientX", () => {
  // Seven 100px-wide day columns starting at x = 50 (the time gutter).
  const columns = Array.from({ length: 7 }, (_, i) => ({ left: 50 + i * 100, right: 150 + i * 100 }));

  it("finds the column the pointer is over", () => {
    expect(dayIndexFromClientX(60, columns)).toBe(0);
    expect(dayIndexFromClientX(149, columns)).toBe(0);
    expect(dayIndexFromClientX(150, columns)).toBe(1);
    expect(dayIndexFromClientX(651, columns)).toBe(6);
  });

  it("clamps a pointer dragged off either edge to the nearest column", () => {
    // Into the time gutter, or off-screen left…
    expect(dayIndexFromClientX(0, columns)).toBe(0);
    expect(dayIndexFromClientX(-200, columns)).toBe(0);
    // …and past the last column's right edge.
    expect(dayIndexFromClientX(5000, columns)).toBe(6);
  });

  it("returns the first column when nothing has been measured yet", () => {
    expect(dayIndexFromClientX(123, [])).toBe(0);
  });
});

describe("clampMoveStart", () => {
  it("leaves a start that fits inside the day alone", () => {
    expect(clampMoveStart(540, 60)).toBe(540);
  });

  it("never starts before midnight", () => {
    expect(clampMoveStart(-120, 60)).toBe(0);
  });

  it("keeps the entry ending by midnight rather than spilling into the next day", () => {
    // A 90-minute entry can start no later than 22:30.
    expect(clampMoveStart(MINUTES_PER_DAY, 90)).toBe(MINUTES_PER_DAY - 90);
    expect(clampMoveStart(23 * 60, 90)).toBe(MINUTES_PER_DAY - 90);
    // Exactly-fits is still allowed: a 60-minute entry may start at 23:00.
    expect(clampMoveStart(23 * 60, 60)).toBe(23 * 60);
  });

  it("pins an entry longer than a day to midnight instead of going negative", () => {
    expect(clampMoveStart(600, MINUTES_PER_DAY + 120)).toBe(0);
  });
});

describe("getWeekDays", () => {
  it("returns the Monday-first week containing the anchor", () => {
    // Wednesday 2026-07-29.
    const days = getWeekDays(new Date("2026-07-29T12:00:00")).map((d) => localDateStr(d));
    expect(days).toEqual([
      "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30",
      "2026-07-31", "2026-08-01", "2026-08-02",
    ]);
  });

  it("treats Sunday as the end of its week, not the start", () => {
    const days = getWeekDays(new Date("2026-08-02T12:00:00")).map((d) => localDateStr(d));
    expect(days[0]).toBe("2026-07-27");
    expect(days[6]).toBe("2026-08-02");
  });

  it("walks the calendar across a DST boundary rather than adding 24h", () => {
    // Fall-back Sunday 2026-11-01 in America/New_York, the suite's zone. A
    // week built by adding 24h of milliseconds would slip an hour and land
    // the seventh day on the wrong date.
    const days = getWeekDays(new Date("2026-10-28T12:00:00")).map((d) => localDateStr(d));
    expect(days).toEqual([
      "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29",
      "2026-10-30", "2026-10-31", "2026-11-01",
    ]);
  });
});

describe("placeEntry", () => {
  it("derives end and duration from one instant and one elapsed length", () => {
    const placed = placeEntry("2026-07-29", new Date("2026-07-29T09:00:00"), 90);
    expect(placed.durationMinutes).toBe(90);
    expect(new Date(placed.endTime).getTime() - new Date(placed.startTime).getTime()).toBe(90 * 60000);
  });

  it("clamps to the real end of a 25-hour day, not to 1440 wall-clock minutes", () => {
    // 2026-11-01 in America/New_York is 25 hours long. An entry dropped past
    // the bottom of the grid has to end at that day's real midnight (#87).
    const placed = placeEntry("2026-11-01", new Date("2026-11-02T06:00:00"), 60);
    expect(placed.endTime).toBe(new Date("2026-11-02T00:00:00").toISOString());
    expect(placed.durationMinutes).toBe(60);
  });

  it("pins to midnight rather than going negative for an over-long entry", () => {
    const placed = placeEntry("2026-07-29", new Date("2026-07-29T20:00:00"), 48 * 60);
    expect(placed.startTime).toBe(new Date("2026-07-29T00:00:00").toISOString());
  });
});

describe("layoutDay", () => {
  const item = (startMin: number, endMin: number, id: string) => ({
    entry: { id } as unknown as TimeEntry,
    startMin, endMin, running: false,
  });
  const shape = (items: ReturnType<typeof item>[]) =>
    layoutDay(items)
      .slice()
      .sort((a, b) => a.entry.id.localeCompare(b.entry.id))
      .map((p) => `${p.entry.id}:${p.col}/${p.cols}`);

  it("gives a lone entry the full width", () => {
    expect(shape([item(540, 600, "a")])).toEqual(["a:0/1"]);
  });

  it("splits two overlapping entries into side-by-side columns", () => {
    expect(shape([item(540, 660, "a"), item(600, 720, "b")])).toEqual(["a:0/2", "b:1/2"]);
  });

  it("keeps non-overlapping entries full width, in separate clusters", () => {
    expect(shape([item(540, 600, "a"), item(600, 660, "b")])).toEqual(["a:0/1", "b:0/1"]);
  });

  it("reuses a column once its previous occupant has ended", () => {
    // a and b overlap; c starts after a ends but still inside b, so it takes
    // a's column rather than opening a third.
    expect(shape([item(540, 600, "a"), item(550, 700, "b"), item(610, 660, "c")]))
      .toEqual(["a:0/2", "b:1/2", "c:0/2"]);
  });

  it("widens the whole cluster to its busiest moment", () => {
    // Three entries all live at 10:00, so every one of them is a third wide —
    // including the one that would otherwise have had room.
    expect(shape([item(540, 660, "a"), item(560, 660, "b"), item(580, 660, "c")]))
      .toEqual(["a:0/3", "b:1/3", "c:2/3"]);
  });
});

describe("clockLabel and formatSlotTime", () => {
  it("reads the end of the last slot as 24:00, not the next day's 00:00", () => {
    expect(clockLabel(24 * 60)).toBe("24:00");
    expect(clockLabel(0)).toBe("00:00");
  });

  it("labels every time on the same two-digit 24-hour clock", () => {
    expect(clockLabel(12 * 60)).toBe("12:00");
    expect(clockLabel(13 * 60 + 5)).toBe("13:05");
    expect(clockLabel(9 * 60 + 15)).toBe("09:15");
  });

  it("describes a slot index for the gridcell label", () => {
    expect(formatSlotTime(0)).toBe("00:00");
    expect(formatSlotTime(19)).toBe("09:30");
    expect(formatSlotTime(24)).toBe("12:00");
  });
});
