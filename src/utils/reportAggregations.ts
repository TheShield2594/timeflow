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
  const map = new Map<string, number>();
  entries.forEach((e) => {
    map.set(e.projectId, (map.get(e.projectId) || 0) + (e.durationMinutes || 0));
  });
  return [...map.entries()]
    .map(([id, minutes]) => ({
      project: projects.find((p) => p.id === id),
      minutes,
      percent: totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0,
    }))
    .filter((r): r is ProjectBreakdownRow => Boolean(r.project))
    .sort((a, b) => b.minutes - a.minutes);
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
  const byProject = new Map<string, Map<string, number>>();
  entries.forEach((e) => {
    const k = bucketKeyFor(e.date, bucket);
    if (!byProject.has(e.projectId)) byProject.set(e.projectId, new Map());
    const row = byProject.get(e.projectId)!;
    row.set(k, (row.get(k) || 0) + (e.durationMinutes || 0));
  });
  const rows = [...byProject.entries()]
    .map(([id, cells]) => ({
      project: projects.find((p) => p.id === id),
      cells,
      total: [...cells.values()].reduce((s, m) => s + m, 0),
    }))
    .filter((r): r is MatrixRow => Boolean(r.project))
    .sort((a, b) => b.total - a.total);
  const colTotals = bucketKeys.map((k) => rows.reduce((s, r) => s + (r.cells.get(k) || 0), 0));
  return { rows, colTotals };
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
  const map = new Map<string, number>();
  entries.filter((e) => e.taskId).forEach((e) => {
    map.set(e.taskId!, (map.get(e.taskId!) || 0) + (e.durationMinutes || 0));
  });
  return [...map.entries()]
    .map(([id, minutes]) => {
      const task = tasks.find((t) => t.id === id);
      return { task, project: projects.find((p) => p.id === task?.projectId), minutes };
    })
    .filter((r): r is TaskBreakdownRow => Boolean(r.task))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, limit);
}
