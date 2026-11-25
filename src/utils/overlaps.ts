import type { TimeEntry } from "../types";

/**
 * Overlapping entries (#206).
 *
 * Two entries covering the same minutes are legal — two things at once is
 * sometimes true — and so the app never blocks them. What it must not do is
 * stay silent: a day that reads 14h 15m because an 8-hour entry was laid over
 * a normal day is double-counted time in the billing record, the exact wrong
 * number this app exists to prevent.
 *
 * Everything here works on instants, never minutes-of-day: an entry's
 * timestamps are the truth about when it ran, and on a DST day the clock
 * readings disagree with them by an hour (#87). Open entries (a running
 * timer's draft) are left out — they have no end to overlap with yet.
 */

interface Span { start: number; end: number }

function spanOf(entry: TimeEntry): Span | null {
  if (!entry.endTime) return null;
  const start = new Date(entry.startTime).getTime();
  const end = new Date(entry.endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

/**
 * The entries among `others` that share time with [start, end), earliest
 * first. Touching ends (one finishing at 3:00, the next starting at 3:00) are
 * back-to-back, not overlapping.
 */
export function findOverlapping(start: Date, end: Date, others: TimeEntry[], excludeId?: string): TimeEntry[] {
  const s = start.getTime();
  const e = end.getTime();
  if (!(e > s)) return [];
  return others
    .filter((o) => o.id !== excludeId)
    .filter((o) => {
      const span = spanOf(o);
      return !!span && span.start < e && s < span.end;
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

/**
 * Minutes of `entries` counted more than once — the amount by which a day
 * total that sums durations overstates the time that actually passed.
 *
 * A sweep over start/end events: wherever more than one entry is open, every
 * entry beyond the first is double-counting. Three entries stacked over the
 * same hour overstate it by two hours, which is what this returns.
 */
export function overlappingMinutes(entries: TimeEntry[]): number {
  const events: [number, number][] = [];
  for (const entry of entries) {
    const span = spanOf(entry);
    if (!span) continue;
    events.push([span.start, 1], [span.end, -1]);
  }
  // Ends before starts at the same instant, so back-to-back entries don't
  // count as overlapping for the zero-length moment they share.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0;
  let last = 0;
  let extraMs = 0;
  for (const [at, delta] of events) {
    if (open > 1) extraMs += (at - last) * (open - 1);
    open += delta;
    last = at;
  }
  return Math.round(extraMs / 60000);
}
