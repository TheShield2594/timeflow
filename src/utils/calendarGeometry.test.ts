import { describe, it, expect } from "vitest";
import {
  MINUTES_PER_DAY,
  PX_PER_MIN,
  SLOT_HEIGHT,
  TOTAL_SLOTS,
  clampMoveStart,
  dayIndexFromClientX,
  rowFromOffsetY,
  snapMinutesFromOffsetY,
} from "./calendarGeometry";

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
