/**
 * Geometry for the day bar — the time entry's second rendering.
 *
 * The bar is a flex track whose segments are proportional to minutes, so the
 * whole of it has to add up: every minute of the window is either an entry,
 * an untracked gap, or unclaimed slack. Building that list is arithmetic over
 * clock-face positions, so it lives here as a pure function rather than
 * inside a component that also has to worry about pointers and focus.
 *
 * Everything below is *geometry* — clock-face positions clipped to one day.
 * On a DST day a segment's width is not elapsed time, which is why the
 * totals shown beside a bar come from stored durations and never from
 * subtracting two of these (#87).
 */
import { spanOnDate, type Gap } from "./gaps";
import { MINUTES_PER_DAY, clockAt, clockAtCompact } from "./dates";
import { DEFAULT_PROJECT_COLOR } from "./colors";
import type { Project, TimeEntry } from "../types";

export interface BarSpan {
  key: string;
  startMin: number;
  endMin: number;
  kind: "entry" | "gap" | "slack";
  /** Project colour, for an entry segment. */
  color?: string;
  /** Draw in the accent instead of the project colour — the entry the
   *  surrounding sheet is *about*, which is a different claim from "this
   *  project". */
  accent?: boolean;
  running?: boolean;
  /** Hatched amber rather than quiet grey: a gap the surrounding copy is
   *  actively pointing at. */
  warn?: boolean;
  label: string;
}

export interface DayWindow {
  startMin: number;
  endMin: number;
}

/**
 * The span the bar draws: at least the working day, stretched out to the hour
 * to cover anything logged outside it. A day whose work all happened at 06:00
 * still gets a bar it fits inside.
 */
export function dayWindow(
  entries: TimeEntry[],
  date: string,
  nowMinutes: number,
  workDayStartMin: number,
  workDayEndMin: number
): DayWindow {
  const spans = entries.map((e) => spanOnDate(e, date, nowMinutes)).filter((s): s is Gap => s !== null);
  const earliest = spans.length > 0 ? Math.min(...spans.map((s) => s.startMin)) : workDayStartMin;
  const latest = spans.length > 0 ? Math.max(...spans.map((s) => s.endMin)) : workDayEndMin;
  const startMin = Math.max(0, Math.min(workDayStartMin, Math.floor(earliest / 60) * 60));
  const endMin = Math.min(MINUTES_PER_DAY, Math.max(workDayEndMin, Math.ceil(latest / 60) * 60));
  // A window has to have width even if the working hours are set to nothing.
  return endMin > startMin ? { startMin, endMin } : { startMin, endMin: startMin + 60 };
}

interface BuildOptions {
  entries: TimeEntry[];
  projects: Project[];
  date: string;
  nowMinutes: number;
  window: DayWindow;
  /** Gaps worth offering, from findUntrackedGaps. Anything else between two
   *  entries is slack, not a hole in the timesheet. */
  gaps: Gap[];
  /** The entry currently being timed, drawn with a fading leading edge. */
  runningEntryId?: string;
  /** The entry the surrounding sheet is about, drawn in the accent. */
  accentEntryId?: string;
  /** Draw the offered gaps hatched amber rather than quiet grey. */
  warnGaps?: boolean;
  describeEntry: (entry: TimeEntry, startMin: number, endMin: number) => string;
}

/**
 * Every segment of one day's bar, left to right, with no holes and no
 * overlaps.
 *
 * Overlapping entries are legal — two timers, an edit that widened a block —
 * and the bar can't draw them side by side without lying about the width of
 * the day. The later one is clipped to start where the previous segment
 * ended, so the track still sums to the window and no entry disappears.
 */
export function buildDaySpans({
  entries, projects, date, nowMinutes, window, gaps,
  runningEntryId, accentEntryId, warnGaps, describeEntry,
}: BuildOptions): BarSpan[] {
  const colorOf = new Map(projects.map((p) => [p.id, p.color || DEFAULT_PROJECT_COLOR]));

  const placed = entries
    .map((e) => ({ entry: e, span: spanOnDate(e, date, nowMinutes) }))
    .filter((x): x is { entry: TimeEntry; span: Gap } => x.span !== null)
    .map(({ entry, span }) => ({
      entry,
      startMin: Math.max(span.startMin, window.startMin),
      endMin: Math.min(span.endMin, window.endMin),
    }))
    .filter((x) => x.endMin > x.startMin)
    .sort((a, b) => a.startMin - b.startMin);

  const out: BarSpan[] = [];
  let cursor = window.startMin;

  /**
   * Fill the hole between two entries, split where an offered gap starts and
   * ends.
   *
   * Intersection, not an exact boundary match. The gap search is capped at the
   * current minute so the rest of today isn't offered before it has happened,
   * while the bar is drawn to the end of the working day — so today's trailing
   * hole is `[last entry, now]` in the gap list and `[last entry, 18:00]` here.
   * Keyed on equality those never matched, and the one gap a person most wants
   * to fill in — the one they are standing in — was the one segment of the bar
   * that wasn't a button.
   */
  const fill = (from: number, to: number) => {
    if (to <= from) return;
    // Every boundary in [from, to]: the ends, plus any offered gap edge
    // falling strictly inside it.
    const cuts = new Set<number>([from, to]);
    for (const gap of gaps) {
      if (gap.startMin > from && gap.startMin < to) cuts.add(gap.startMin);
      if (gap.endMin > from && gap.endMin < to) cuts.add(gap.endMin);
    }
    const edges = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < edges.length - 1; i++) {
      const [lo, hi] = [edges[i], edges[i + 1]];
      const gap = gaps.find((g) => g.startMin <= lo && g.endMin >= hi);
      out.push({
        key: `hole-${lo}-${hi}`,
        startMin: lo, endMin: hi,
        kind: gap ? "gap" : "slack",
        warn: !!gap && warnGaps,
        label: gap
          ? `${clockAt(lo)} to ${clockAt(hi)} untracked`
          : `${clockAt(lo)} to ${clockAt(hi)}`,
      });
    }
  };

  for (const { entry, startMin, endMin } of placed) {
    fill(cursor, Math.max(cursor, startMin));
    const from = Math.max(cursor, startMin);
    if (endMin > from) {
      out.push({
        key: `entry-${entry.id}`,
        startMin: from, endMin,
        kind: "entry",
        color: colorOf.get(entry.projectId) || DEFAULT_PROJECT_COLOR,
        accent: entry.id === accentEntryId,
        running: entry.id === runningEntryId,
        label: describeEntry(entry, from, endMin),
      });
      cursor = endMin;
    }
  }
  fill(cursor, window.endMin);
  return out;
}

/**
 * Five labels under the bar, one at the centre of each fifth of the window.
 * Centres rather than edges because a label under the join between two
 * segments reads as belonging to neither.
 */
export function axisLabels(window: DayWindow, count = 5): string[] {
  const span = window.endMin - window.startMin;
  return Array.from({ length: count }, (_, i) =>
    clockAtCompact(window.startMin + Math.round(((i + 0.5) * span) / count / 60) * 60)
  );
}
