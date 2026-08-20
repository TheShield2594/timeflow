/**
 * Every duration this module formats is a span of elapsed time, so a negative
 * input is always a bug upstream — a clock that went backwards, a start time
 * ahead of now, an entry whose end precedes its start. What it must not do is
 * render as one: `String(-1).padStart(2, "0")` is a no-op, so an unclamped
 * `formatElapsed` emits `-1:-1:-5` and `formatMinutes(-90)` emits `-2h -30m`.
 * Clamping at the boundary keeps a skewed clock reading 00:00:00 until it
 * catches up, which is the honest rendering of "no time has elapsed yet"
 * (#114).
 */
function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function formatElapsed(seconds: number): string {
  const total = nonNegative(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function formatMinutes(minutes: number): string {
  const total = Math.floor(nonNegative(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Decimal hours — the unit timesheets and invoices are read in, and the one
 * duration format that had grown a copy per surface (#93).
 *
 * One decimal is the on-screen default because 0.1h is the standard billing
 * increment, and it is the grid the Reports matrix allocates its rounding
 * onto. The CSV export passes 2 deliberately: its duration columns are the
 * ones people bill from, its rounding rule is the user's own choice, and
 * quantizing an "Exact minutes" export to 6-minute buckets would throw away
 * information the screen never needed to carry.
 */
export const DECIMAL_HOURS_DIGITS = 1;

export function formatDecimalHours(minutes: number, digits = DECIMAL_HOURS_DIGITS): string {
  return (nonNegative(minutes) / 60).toFixed(digits);
}

/**
 * Ratio is a billing account identifier, not a multiplier (#71) — hence the
 * rounding to a non-negative whole number rather than accepting fractions
 * like 0.5. See the note on `Project.ratio` in src/types.
 */
export function parseRatioInput(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Math.max(0, Math.round(Number(v)));
  return Number.isFinite(n) ? n : undefined;
}
