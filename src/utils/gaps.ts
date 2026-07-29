/**
 * Untracked-gap detection (P2-15).
 *
 * A gap is stretch of the working day that no time entry covers. Surfacing
 * them — on the Calendar grid and on the Overview today strip — is what turns
 * a stopwatch into a timesheet somebody can actually finish: the day shows
 * you its own holes instead of making you remember them. Every input is
 * already loaded client-side, so this is pure computation over the entries
 * a page already has.
 *
 * Both surfaces share this module so a gap can never appear in one place and
 * not the other.
 */
import { minutesOfDay } from "./dates";
import type { TimeEntry } from "../types";

/** Working hours the gap search is confined to. Outside them, untracked time
 *  is just "not at work" and prompting for it would be noise. */
export const WORK_DAY_START_MIN = 8 * 60;  // 08:00
export const WORK_DAY_END_MIN = 18 * 60;   // 18:00

/** Gaps must be longer than this to be worth offering — anything shorter is
 *  the slack between back-to-back blocks, not time somebody forgot to log. */
export const MIN_GAP_MINUTES = 15;

const MINUTES_PER_DAY = 24 * 60;

export interface Gap {
  /** Minutes since local midnight. */
  startMin: number;
  endMin: number;
}

/** The half-open [start, end) span an entry covers on `date`, in minutes of
 *  day. Returns null for an entry that contributes nothing to that day. */
function spanOnDate(entry: TimeEntry, date: string, nowMinutes: number): Gap | null {
  if (entry.date !== date) return null;
  const startMin = Math.max(0, Math.min(MINUTES_PER_DAY, minutesOfDay(entry.startTime)));
  // A running entry covers up to now; one that ran past midnight covers the
  // rest of its own day rather than wrapping to a negative span.
  const rawEnd = entry.endTime ? minutesOfDay(entry.endTime) : nowMinutes;
  const endMin = rawEnd <= startMin ? MINUTES_PER_DAY : Math.min(MINUTES_PER_DAY, rawEnd);
  return { startMin, endMin };
}

/** Sorted, overlap-merged coverage for one day. Overlapping entries are
 *  legal (two timers, an edit that widened a block) and must not read as a
 *  gap of negative width between them. */
export function coveredSpans(entries: TimeEntry[], date: string, nowMinutes: number): Gap[] {
  const spans = entries
    .map((e) => spanOnDate(e, date, nowMinutes))
    .filter((s): s is Gap => s !== null)
    .sort((a, b) => a.startMin - b.startMin);

  const merged: Gap[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, span.endMin);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

export interface FindGapsOptions {
  /** All entries in scope; ones on other dates are ignored. */
  entries: TimeEntry[];
  /** The local YYYY-MM-DD day to search. */
  date: string;
  /** Minutes since midnight, used to close a running entry. */
  nowMinutes: number;
  /**
   * Cap the search here — pass `nowMinutes` for today so the rest of the
   * working day isn't offered as a gap before it has happened. Omit for a
   * past day, where the whole working day is fair game.
   */
  upperBoundMin?: number;
  workDayStartMin?: number;
  workDayEndMin?: number;
  minGapMinutes?: number;
}

/**
 * Every untracked gap inside working hours on one day, in order.
 *
 * A day with nothing logged at all returns no gaps: that's an empty day, not
 * a day with holes in it, and flagging the whole 8–18 block would be noise on
 * every weekend and holiday. Once something *is* logged, the untracked time
 * before the first entry and after the last one counts too — those are as
 * much a hole in the timesheet as the ones in between.
 */
export function findUntrackedGaps({
  entries,
  date,
  nowMinutes,
  upperBoundMin,
  workDayStartMin = WORK_DAY_START_MIN,
  workDayEndMin = WORK_DAY_END_MIN,
  minGapMinutes = MIN_GAP_MINUTES,
}: FindGapsOptions): Gap[] {
  const covered = coveredSpans(entries, date, nowMinutes);
  if (covered.length === 0) return [];

  const windowStart = workDayStartMin;
  const windowEnd = Math.min(workDayEndMin, upperBoundMin ?? workDayEndMin);
  if (windowEnd <= windowStart) return [];

  const gaps: Gap[] = [];
  let cursor = windowStart;
  for (const span of covered) {
    if (span.startMin > cursor) gaps.push({ startMin: cursor, endMin: span.startMin });
    cursor = Math.max(cursor, span.endMin);
    if (cursor >= windowEnd) break;
  }
  if (cursor < windowEnd) gaps.push({ startMin: cursor, endMin: windowEnd });

  // Clip to the window last so a gap that only partly overlaps working hours
  // still surfaces (its in-hours part), then drop what's too short to matter.
  return gaps
    .map((g) => ({
      startMin: Math.max(g.startMin, windowStart),
      endMin: Math.min(g.endMin, windowEnd),
    }))
    .filter((g) => g.endMin - g.startMin > minGapMinutes);
}
