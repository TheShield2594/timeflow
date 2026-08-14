export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
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
  return (minutes / 60).toFixed(digits);
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
