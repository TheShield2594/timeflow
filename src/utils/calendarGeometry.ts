/**
 * Pointer maths for the week calendar grid.
 *
 * Kept out of CalendarPage so the arithmetic that turns a pointer position
 * into a slot row / minutes-of-day / day column is unit-testable without a
 * layout engine (jsdom reports every getBoundingClientRect as zeroes). The
 * component supplies the measured geometry — a grid top edge, a list of day
 * column rects — and these functions do the rest.
 *
 * Everything here is *geometry*: minutes-of-day positions on a fixed 24-hour
 * clock face. None of these results is a duration — on a DST day the clock
 * face and elapsed time disagree, so anything written to `durationMinutes`
 * must be derived from real instants via utils/dates (#87).
 */
import { MINUTES_PER_DAY, clockAt, clockAtCompact, dateAtMinutes } from "./dates";
import type { TimeEntry } from "../types";

/** px per 30-minute slot. */
export const SLOT_HEIGHT = 36;
export const SLOTS_PER_HOUR = 2;
export const TOTAL_SLOTS = 24 * SLOTS_PER_HOUR;
export const PX_PER_MIN = SLOT_HEIGHT / 30;
/** Re-exported so the grid's maths reads from one place; note it is the
 *  clock face, not the elapsed length of a DST day (utils/dates). */
export { MINUTES_PER_DAY };

/** Drag-resize and drag-move both snap to quarter-hour steps. */
export const SNAP_MIN = 15;
/** A resize can't shrink an entry below this. */
export const MIN_RESIZE_DURATION_MIN = 15;
/**
 * How far the pointer must travel before a press on an entry block counts as
 * a move rather than a click. Without it, the tiny pointer drift in an
 * ordinary click would reschedule the entry instead of opening it.
 */
export const MOVE_THRESHOLD_PX = 4;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(value, hi));
}

/** Slot row (0-47) for a pointer Y measured from the grid's top edge. */
export function rowFromOffsetY(offsetY: number): number {
  return clamp(Math.floor(offsetY / SLOT_HEIGHT), 0, TOTAL_SLOTS - 1);
}

/**
 * Minutes-of-day for a pointer Y measured from the grid's top edge, snapped
 * to SNAP_MIN and clamped to the day. 24*60 is a legal result — it means
 * "midnight at the end of this day", which the callers translate into the
 * next day's 00:00.
 */
export function snapMinutesFromOffsetY(offsetY: number): number {
  const snapped = Math.round(offsetY / PX_PER_MIN / SNAP_MIN) * SNAP_MIN;
  return clamp(snapped, 0, MINUTES_PER_DAY);
}

/** The horizontal extent of one day column, as measured from the DOM. */
export interface ColumnRect {
  left: number;
  right: number;
}

/**
 * Day column index for a pointer X. Columns are contiguous and ordered
 * left-to-right, so the first column whose right edge is past the pointer
 * wins; a pointer dragged off either end clamps to the nearest column rather
 * than cancelling the drag.
 */
export function dayIndexFromClientX(clientX: number, columns: ColumnRect[]): number {
  if (columns.length === 0) return 0;
  const idx = columns.findIndex((c) => clientX < c.right);
  return idx === -1 ? columns.length - 1 : Math.max(0, idx);
}

/**
 * Keep a moved entry inside the day it was dropped on: an entry can start no
 * earlier than midnight and must still end by the following midnight. An
 * entry longer than a day (only reachable from data written elsewhere) pins
 * to midnight rather than going negative.
 */
export function clampMoveStart(startMin: number, durationMin: number): number {
  const latestStart = Math.max(0, MINUTES_PER_DAY - durationMin);
  return clamp(startMin, 0, latestStart);
}


// ---------------------------------------------------------------------------
// Week layout
//
// Everything below turns dates and entries into positions on the grid. It
// lived inside CalendarPage until #115; none of it touches React, and
// layoutDay in particular is the kind of arithmetic (transitive overlap
// clustering) that is far easier to argue with in a test than through a
// rendered grid.
// ---------------------------------------------------------------------------

/** Monday-first week containing `anchor`, as seven local Dates. */
export function getWeekDays(anchor: Date): Date[] {
  const days: Date[] = [];
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

/** "9 AM" for an hour of the day, for the grid's left gutter — the compact
 *  form, because the gutter is a fixed 52px column of tick marks. */
export function formatHour(h: number): string {
  return clockAtCompact(h * 60);
}

/**
 * Place a block of `durationMin` *elapsed* minutes starting at the instant
 * `startDt` on `date`, pinned so it still begins no earlier than that day's
 * midnight and ends no later than the next one.
 *
 * Every reschedule (drag-move, keyboard nudge) commits through here so the
 * three fields that must agree — startTime, endTime, durationMinutes — are
 * derived from one instant and one elapsed length. The old code built each
 * from minutes-of-day arithmetic, which on a 23- or 25-hour day wrote a
 * duration that contradicted its own timestamps (#87): a 01:00 → 03:00 span
 * on a fall-back day is three hours, not two.
 *
 * The clamp is on instants too, so "must end by midnight" means the real
 * midnight of that day — an hour earlier or later than 1440 wall-clock
 * minutes when the clocks move.
 */
export function placeEntry(date: string, startDt: Date, durationMin: number): {
  startTime: string; endTime: string; durationMinutes: number;
} {
  const dayStart = dateAtMinutes(date, 0).getTime();
  const dayEnd = dateAtMinutes(date, MINUTES_PER_DAY).getTime();
  const latestStart = Math.max(dayStart, dayEnd - durationMin * 60000);
  const start = Math.min(Math.max(startDt.getTime(), dayStart), latestStart);
  return {
    startTime: new Date(start).toISOString(),
    endTime: new Date(start + durationMin * 60000).toISOString(),
    durationMinutes: durationMin,
  };
}

// "9:15 AM" for a minutes-of-day offset — a reading rather than a tick, so it
// keeps its minutes. A span's end at midnight reads "12:00 AM" like its start
// would; the dash between the two is what says which is which.
export function clockLabel(minutes: number): string {
  return clockAt(minutes);
}

// Describe a 30-min slot index (0-47) as a time, for gridcell aria-labels.
export function formatSlotTime(slotIdx: number): string {
  return clockAt(slotIdx * 30);
}

/** One entry's position on a day column, after overlap resolution. */
export interface Positioned {
  entry: TimeEntry;
  startMin: number;
  endMin: number;
  running: boolean;
  col: number;
  cols: number;
}

/**
 * Assign side-by-side columns to overlapping entries (Outlook-style).
 * Entries are clustered by transitive overlap; within a cluster each entry
 * takes the first column whose previous occupant has ended.
 */
export function layoutDay(items: Omit<Positioned, "col" | "cols">[]): Positioned[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const result: Positioned[] = [];
  let cluster: Positioned[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const n = Math.max(colEnds.length, 1);
    cluster.forEach((p) => { p.cols = n; });
    cluster = [];
    colEnds = [];
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= item.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(item.endMin);
    } else {
      colEnds[col] = item.endMin;
    }
    const positioned: Positioned = { ...item, col, cols: 1 };
    cluster.push(positioned);
    result.push(positioned);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();
  return result;
}
