import { describe, it, expect } from "vitest";
import {
  findUntrackedGaps, coveredSpans, WORK_DAY_START_MIN, WORK_DAY_END_MIN,
  GAP_MUST_EXCEED_MINUTES,
} from "./gaps";
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

  it("names its threshold after the comparison it actually makes (#114)", () => {
    // The filter is `>`, not `>=`, so a gap of exactly the threshold is
    // dropped — which is why the constant is GAP_MUST_EXCEED_MINUTES and not
    // MIN_GAP_MINUTES. Same 15-minute hole, read either way by the override.
    expect(GAP_MUST_EXCEED_MINUTES).toBe(15);
    const fifteenMinuteHole = [entry("08:00", "10:00"), entry("10:15", "18:00")];
    expect(findUntrackedGaps({
      entries: fifteenMinuteHole,
      date: DATE,
      nowMinutes: WORK_DAY_END_MIN,
      gapMustExceedMinutes: 15,
    })).toEqual([]);
    expect(asClock(findUntrackedGaps({
      entries: fifteenMinuteHole,
      date: DATE,
      nowMinutes: WORK_DAY_END_MIN,
      gapMustExceedMinutes: 14,
    }))).toEqual(["10:00-10:15"]);
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

  it("covers nothing for a zero-length entry", () => {
    // Started and stopped inside the same minute — wrong project picked, then
    // immediately corrected. It ends where it starts, like a full-day entry,
    // and only the stored duration tells the two apart (#92).
    const spans = coveredSpans([entry("09:00", "09:00", { durationMinutes: 0 })], DATE, WORK_DAY_END_MIN);
    expect(spans).toEqual([{ startMin: 9 * 60, endMin: 9 * 60 }]);
  });

  it("still covers the whole day for an entry that wrapped all the way round", () => {
    const spans = coveredSpans([entry("09:00", "09:00", { durationMinutes: 24 * 60 })], DATE, WORK_DAY_END_MIN);
    expect(spans).toEqual([{ startMin: 9 * 60, endMin: 24 * 60 }]);
  });
});

describe("zero-length entries", () => {
  it("does not mark the rest of the day as tracked", () => {
    const gaps = findUntrackedGaps({
      entries: [entry("08:00", "09:00"), entry("09:00", "09:00", { durationMinutes: 0 })],
      date: DATE,
      nowMinutes: WORK_DAY_END_MIN,
    });
    // Before the fix the mis-click covered 09:00 to midnight and this was [].
    expect(asClock(gaps)).toEqual(["09:00-18:00"]);
  });

  it("covers nothing for a timer that has only just started", () => {
    // A running entry whose start is this very minute is a zero-length span
    // too, and it must not swallow the rest of the day either.
    const gaps = findUntrackedGaps({
      entries: [entry("08:00", null, { durationMinutes: 0 })],
      date: DATE,
      nowMinutes: WORK_DAY_START_MIN,
      upperBoundMin: NOON,
    });
    expect(asClock(gaps)).toEqual(["08:00-12:00"]);
  });
});
