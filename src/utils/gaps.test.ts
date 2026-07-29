import { describe, it, expect } from "vitest";
import { findUntrackedGaps, coveredSpans, WORK_DAY_START_MIN, WORK_DAY_END_MIN } from "./gaps";
import type { TimeEntry } from "../types";

const DATE = "2026-07-29";

function entry(startHM: string, endHM: string | null, overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: `${startHM}-${endHM}`,
    projectId: "p1",
    startTime: `${DATE}T${startHM}:00`,
    endTime: endHM ? `${DATE}T${endHM}:00` : undefined,
    durationMinutes: 60,
    date: DATE,
    userId: "u1",
    userDisplayName: "U",
    ...overrides,
  };
}

/** Gaps as "HH:MM-HH:MM" strings, which read far better in a failure. */
function asClock(gaps: { startMin: number; endMin: number }[]): string[] {
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return gaps.map((g) => `${fmt(g.startMin)}-${fmt(g.endMin)}`);
}

const NOON = 12 * 60;

describe("findUntrackedGaps", () => {
  it("finds the hole between two entries", () => {
    const gaps = findUntrackedGaps({
      entries: [entry("09:00", "10:00"), entry("11:30", "12:30")],
      date: DATE,
      nowMinutes: WORK_DAY_END_MIN,
    });
    expect(asClock(gaps)).toContain("10:00-11:30");
  });

  it("counts the untracked time before the first entry and after the last", () => {
    const gaps = findUntrackedGaps({
      entries: [entry("10:00", "11:00")],
      date: DATE,
      nowMinutes: WORK_DAY_END_MIN,
    });
    // 08:00 start of working hours → 10:00, and 11:00 → 18:00.
    expect(asClock(gaps)).toEqual(["08:00-10:00", "11:00-18:00"]);
  });

  it("ignores gaps of 15 minutes or less", () => {
    const gaps = findUntrackedGaps({
      entries: [entry("08:00", "10:00"), entry("10:15", "18:00")],
      date: DATE,
      nowMinutes: WORK_DAY_END_MIN,
    });
    expect(gaps).toEqual([]);
  });

  it("takes a gap of 16 minutes", () => {
    const gaps = findUntrackedGaps({
      entries: [entry("08:00", "10:00"), entry("10:16", "18:00")],
      date: DATE,
      nowMinutes: WORK_DAY_END_MIN,
    });
    expect(asClock(gaps)).toEqual(["10:00-10:16"]);
  });

  it("returns nothing for a day with no entries at all", () => {
    // An empty day is a day off, not a timesheet with holes in it — flagging
    // 08:00-18:00 on every weekend would bury the gaps that matter.
    expect(findUntrackedGaps({ entries: [], date: DATE, nowMinutes: NOON })).toEqual([]);
  });

  it("stays inside working hours", () => {
    const gaps = findUntrackedGaps({
      entries: [entry("06:00", "07:00"), entry("20:00", "21:00")],
      date: DATE,
      nowMinutes: WORK_DAY_END_MIN,
    });
    // Everything logged is outside 08:00-18:00, so the whole working day is
    // the gap — but it never extends past those bounds.
    expect(asClock(gaps)).toEqual(["08:00-18:00"]);
    expect(gaps[0].startMin).toBe(WORK_DAY_START_MIN);
    expect(gaps[0].endMin).toBe(WORK_DAY_END_MIN);
  });

  it("does not offer the rest of today before it has happened", () => {
    const gaps = findUntrackedGaps({
      entries: [entry("08:00", "10:00")],
      date: DATE,
      nowMinutes: NOON,
      upperBoundMin: NOON,
    });
    expect(asClock(gaps)).toEqual(["10:00-12:00"]);
  });

  it("treats a running entry as covering the time up to now", () => {
    const gaps = findUntrackedGaps({
      entries: [entry("08:00", null)],
      date: DATE,
      nowMinutes: NOON,
      upperBoundMin: NOON,
    });
    expect(gaps).toEqual([]);
  });

  it("does not invent a gap between overlapping entries", () => {
    const gaps = findUntrackedGaps({
      entries: [entry("08:00", "18:00"), entry("10:00", "11:00")],
      date: DATE,
      nowMinutes: WORK_DAY_END_MIN,
    });
    expect(gaps).toEqual([]);
  });

  it("ignores entries belonging to another day", () => {
    const other = entry("09:00", "17:00", { date: "2026-07-28" });
    const gaps = findUntrackedGaps({
      entries: [other, entry("10:00", "11:00")],
      date: DATE,
      nowMinutes: WORK_DAY_END_MIN,
    });
    expect(asClock(gaps)).toEqual(["08:00-10:00", "11:00-18:00"]);
  });
});

describe("coveredSpans", () => {
  it("merges overlapping and touching entries into one span", () => {
    const spans = coveredSpans(
      [entry("09:00", "11:00"), entry("10:00", "12:00"), entry("12:00", "13:00")],
      DATE,
      WORK_DAY_END_MIN
    );
    expect(spans).toEqual([{ startMin: 9 * 60, endMin: 13 * 60 }]);
  });

  it("clamps an entry that runs past midnight to the end of its own day", () => {
    const spans = coveredSpans([entry("23:00", "01:00")], DATE, WORK_DAY_END_MIN);
    expect(spans).toEqual([{ startMin: 23 * 60, endMin: 24 * 60 }]);
  });
});
