/**
 * Pointer maths for the week calendar grid.
 *
 * Kept out of CalendarPage so the arithmetic that turns a pointer position
 * into a slot row / minutes-of-day / day column is unit-testable without a
 * layout engine (jsdom reports every getBoundingClientRect as zeroes). The
 * component supplies the measured geometry — a grid top edge, a list of day
 * column rects — and these functions do the rest.
 */

/** px per 30-minute slot. */
export const SLOT_HEIGHT = 36;
export const SLOTS_PER_HOUR = 2;
export const TOTAL_SLOTS = 24 * SLOTS_PER_HOUR;
export const PX_PER_MIN = SLOT_HEIGHT / 30;
export const MINUTES_PER_DAY = 24 * 60;

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
