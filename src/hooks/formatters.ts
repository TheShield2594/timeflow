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
 * Ratio is a billing account identifier, not a multiplier (#71) — hence the
 * rounding to a non-negative whole number rather than accepting fractions
 * like 0.5. See the note on `Project.ratio` in src/types.
 */
export function parseRatioInput(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Math.max(0, Math.round(Number(v)));
  return Number.isFinite(n) ? n : undefined;
}
