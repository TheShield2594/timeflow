/**
 * Pure aggregation helpers behind the Reports dashboard.
 *
 * These are the numbers people bill from, so they live outside the component
 * that renders them and are unit-tested directly: a rendering test can only
 * ever check the handful of figures that reach the screen, while a silent
 * off-by-one in bucketing or a dropped entry in a breakdown is exactly the
 * kind of thing that looks plausible on a dashboard.
 */
import type { Project, Task, TimeEntry } from "../types";
import { localDateStr, weekStartStr } from "./dates";
import { byId, indexById } from "./entityIndex";
import { allocatePercentages } from "./rounding";

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
