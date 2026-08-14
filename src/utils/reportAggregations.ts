/**
 * Pure aggregation helpers behind the Reports dashboard.
 *
 * These are the numbers people bill from, so they live outside the component
 * that renders them and are unit-tested directly: a rendering test can only
 * ever check the handful of figures that reach the screen, while a silent
 * off-by-one in bucketing or a dropped entry in the matrix is exactly the
 * kind of thing that looks plausible on a dashboard.
 */
import type { Project, Task, TimeEntry } from "../types";
import { localDateStr, weekStartStr } from "./dates";
import { byId, indexById } from "./entityIndex";
import { allocateLargestRemainder, allocatePercentages } from "./rounding";

export type Bucket = "day" | "week" | "month";

// Past this many days, daily bars become unreadable — bucket by week instead;
// past MONTHLY_BUCKET_THRESHOLD, bucket by month.
export const WEEKLY_BUCKET_THRESHOLD = 35;
export const MONTHLY_BUCKET_THRESHOLD = 180;

/** Every local YYYY-MM-DD from `from` to `to` inclusive. */
export function getDaysInRange(from: string, to: string): string[] {
  const days: string[] = [];
  const cur = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (cur <= end) {
    days.push(localDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/** Entries inside the range that actually carry time. */
export function filterEntriesForRange(entries: TimeEntry[], from: string, to: string): TimeEntry[] {
  return entries.filter((e) => e.date >= from && e.date <= to && e.durationMinutes);
}

export function pickBucket(dayCount: number): Bucket {
  if (dayCount > MONTHLY_BUCKET_THRESHOLD) return "month";
  if (dayCount > WEEKLY_BUCKET_THRESHOLD) return "week";
  return "day";
}

/** The bucket key a date falls in: the date itself, its Monday, or its month. */
export function bucketKeyFor(date: string, bucket: Bucket): string {
  if (bucket === "month") return date.slice(0, 7);
  if (bucket === "week") return weekStartStr(date);
  return date;
}

/** Ordered, unique bucket keys spanning the days — including empty buckets. */
export function bucketKeysFor(days: string[], bucket: Bucket): string[] {
  const keys: string[] = [];
  let last = "";
  for (const d of days) {
    const k = bucketKeyFor(d, bucket);
    if (k !== last) { keys.push(k); last = k; }
  }
  return keys;
}

export function sumMinutes(entries: TimeEntry[]): number {
  return entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
}

/** Distinct days carrying logged time — the denominator people expect for
 *  "average per day". */
export function countActiveDays(entries: TimeEntry[]): number {
  return new Set(entries.map((e) => e.date)).size;
}

/**
 * The display range for the axes. Everything but the "all" preset uses the
 * requested range as-is (an inverted custom range collapses to a single day);
 * "all" resolves to 1970→9999, which the axes must never enumerate, so it is
 * clamped to the dates that actually hold data — widened to today so an
 * all-time view of past-only data still ends at the present.
 */
export function resolveEffectiveRange(
  preset: string,
  entries: TimeEntry[],
  from: string,
  to: string,
  today: string,
): { effFrom: string; effTo: string } {
  if (preset !== "all") {
    return { effFrom: from, effTo: to >= from ? to : from };
  }
  let min = "";
  let max = "";
  for (const e of entries) {
    if (!e.date) continue;
    if (!min || e.date < min) min = e.date;
    if (!max || e.date > max) max = e.date;
  }
  const lower = min || today;
  const upper = max > today ? max : today;
  return { effFrom: lower, effTo: upper >= lower ? upper : lower };
}

export interface RangeCandidate {
  /** Opaque to this module — handed back so the caller can switch to it. */
  preset: string;
  label: string;
  from: string;
  to: string;
}

export interface RangeWithData extends RangeCandidate {
  minutes: number;
}

/** Whole days from `from` to `to`. Computed by subtraction rather than by
 *  walking the calendar, because "all time" spans 1970→9999. */
function spanDays(range: { from: string; to: string }): number {
  const ms = new Date(range.to + "T00:00:00").getTime() - new Date(range.from + "T00:00:00").getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * The narrowest candidate range that actually holds logged time — what to
 * offer someone looking at an empty report so the page is a recovery rather
 * than a dead end.
 *
 * Narrowest rather than widest deliberately: it stays closest to the range
 * they asked for, so the jump out of the empty state is the smallest one that
 * shows them something.
 */
export function findNarrowestRangeWithData(
  entries: TimeEntry[],
  candidates: RangeCandidate[],
): RangeWithData | null {
  const totals: RangeWithData[] = candidates.map((c) => ({ ...c, minutes: 0 }));
  for (const e of entries) {
    if (!e.date || !e.durationMinutes) continue;
    for (const c of totals) {
      if (e.date >= c.from && e.date <= c.to) c.minutes += e.durationMinutes;
    }
  }
  const withData = totals.filter((c) => c.minutes > 0);
  if (withData.length === 0) return null;
  return withData.reduce((best, c) => (spanDays(c) < spanDays(best) ? c : best));
}

export interface ProjectBreakdownRow {
  project: Project;
  minutes: number;
  percent: number;
}

/** Minutes per project, biggest first, with each project's share of the
 *  total. Entries whose project has since vanished are dropped rather than
 *  rendered as a nameless row. */
export function buildProjectBreakdown(
  entries: TimeEntry[],
  projects: Project[],
  totalMinutes: number,
): ProjectBreakdownRow[] {
  const projectById = indexById(projects);
  const map = new Map<string, number>();
  entries.forEach((e) => {
    map.set(e.projectId, (map.get(e.projectId) || 0) + (e.durationMinutes || 0));
  });
  const rows = [...map.entries()]
    .map(([id, minutes]) => ({ project: projectById.get(id), minutes }))
    .filter((r): r is { project: Project; minutes: number } => Boolean(r.project))
    .sort((a, b) => b.minutes - a.minutes);
  // Allocated across the surviving rows rather than rounded row by row: these
  // percentages are rendered as one stack and get added up by eye, so three
  // equal projects have to read 34/33/33 and not 33/33/33 (#113). Dropped
  // rows are excluded *before* the allocation so their time isn't reassigned
  // to projects it was never logged against.
  const percents = allocatePercentages(rows.map((r) => r.minutes), totalMinutes);
  return rows.map((r, i) => ({ ...r, percent: percents[i] }));
}

export interface ChartPoint {
  key: string;
  minutes: number;
  bucket: Bucket;
}

/** One point per bucket key, in order, zero-filled where nothing was logged. */
export function buildChartData(entries: TimeEntry[], bucketKeys: string[], bucket: Bucket): ChartPoint[] {
  const byBucket = new Map<string, number>();
  entries.forEach((e) => {
    const k = bucketKeyFor(e.date, bucket);
    byBucket.set(k, (byBucket.get(k) || 0) + (e.durationMinutes || 0));
  });
  return bucketKeys.map((k) => ({ key: k, minutes: byBucket.get(k) || 0, bucket }));
}

export interface MatrixRow {
  project: Project;
  cells: Map<string, number>;
  total: number;
}

/** The classic timesheet grid: a row of per-bucket minutes per project, plus
 *  the column totals under it. */
export function buildMatrix(
  entries: TimeEntry[],
  projects: Project[],
  bucketKeys: string[],
  bucket: Bucket,
): { rows: MatrixRow[]; colTotals: number[] } {
  const projectById = indexById(projects);
  const byProject = new Map<string, Map<string, number>>();
  entries.forEach((e) => {
    const k = bucketKeyFor(e.date, bucket);
    if (!byProject.has(e.projectId)) byProject.set(e.projectId, new Map());
    const row = byProject.get(e.projectId)!;
    row.set(k, (row.get(k) || 0) + (e.durationMinutes || 0));
  });
  const rows = [...byProject.entries()]
    .map(([id, cells]) => ({
      project: projectById.get(id),
      cells,
      total: [...cells.values()].reduce((s, m) => s + m, 0),
    }))
    .filter((r): r is MatrixRow => Boolean(r.project))
    .sort((a, b) => b.total - a.total);
  const colTotals = bucketKeys.map((k) => rows.reduce((s, r) => s + (r.cells.get(k) || 0), 0));
  return { rows, colTotals };
}

/** The 0.1-hour grid the matrix is printed on, in minutes. */
const DISPLAY_STEP_MIN = 6;

export interface MatrixDisplay {
  /** Display minutes per project row, aligned to `bucketKeys`. */
  cells: number[][];
  rowTotals: number[];
  colTotals: number[];
  grandTotal: number;
}

/**
 * The matrix as it is actually *printed*: every figure snapped to the 0.1-hour
 * display grid, allocated so that every addition a reader can perform on
 * screen comes out right — each project row against its total, each period
 * column against its total, and both margins against the grand total (#93).
 *
 * Rows are allocated first and columns fall out as sums of the printed cells,
 * rather than the other way round, for two reasons: a project's total over the
 * range is the figure that gets transcribed onto an invoice, so it is the one
 * worth anchoring to the truth; and the drift that has to land *somewhere*
 * lands on the margin summed over projects, which is the shorter of the two
 * axes (a range wide enough to have many columns has already been re-bucketed
 * to weeks or months). Every printed number stays within one 0.1h increment of
 * its true value, and the exact minutes are on hover either way.
 *
 * Takes the matrix's own total, not the report's: rows for vanished projects
 * are already gone by here, and borrowing the page-level total would hand
 * their time to whoever is left.
 */
export function buildMatrixDisplay(rows: MatrixRow[], bucketKeys: string[]): MatrixDisplay {
  const steps = (minutes: number) => minutes / DISPLAY_STEP_MIN;
  const grandSteps = Math.round(steps(rows.reduce((s, r) => s + r.total, 0)));

  const rowTotalSteps = allocateLargestRemainder(rows.map((r) => steps(r.total)), grandSteps);
  const cellSteps = rows.map((r, i) =>
    allocateLargestRemainder(bucketKeys.map((k) => steps(r.cells.get(k) || 0)), rowTotalSteps[i])
  );
  const colTotalSteps = bucketKeys.map((_, j) => cellSteps.reduce((s, row) => s + row[j], 0));

  const toMinutes = (n: number) => n * DISPLAY_STEP_MIN;
  return {
    cells: cellSteps.map((row) => row.map(toMinutes)),
    rowTotals: rowTotalSteps.map(toMinutes),
    colTotals: colTotalSteps.map(toMinutes),
    grandTotal: toMinutes(grandSteps),
  };
}

export interface TaskBreakdownRow {
  task: Task;
  /** Undefined when the task's project has been deleted outright. */
  project: Project | undefined;
  minutes: number;
}

/** Top `limit` tasks by logged time. Entries with no task are ignored. */
export function buildTaskBreakdown(
  entries: TimeEntry[],
  tasks: Task[],
  projects: Project[],
  limit = 8,
): TaskBreakdownRow[] {
  const projectById = indexById(projects);
  const taskById = indexById(tasks);
  const map = new Map<string, number>();
  entries.filter((e) => e.taskId).forEach((e) => {
    map.set(e.taskId!, (map.get(e.taskId!) || 0) + (e.durationMinutes || 0));
  });
  return [...map.entries()]
    .map(([id, minutes]) => {
      const task = taskById.get(id);
      return { task, project: byId(projectById, task?.projectId), minutes };
    })
    .filter((r): r is TaskBreakdownRow => Boolean(r.task))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, limit);
}
