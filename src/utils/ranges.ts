/**
 * The date ranges the segmented controls offer, resolved to concrete bounds.
 *
 * Both screens that filter by date now do it with a segmented control rather
 * than a dropdown, so the set is small and named after what a person actually
 * asks for — "last week", not "the last 7 days", which is a different span
 * with a different answer.
 */
import {
  DATE_LOCALE, addDaysStr, localDateStr, weekStartStr,
} from "./dates";

export type RangePreset = "thisWeek" | "lastWeek" | "month" | "quarter" | "custom";

export interface RangeState {
  preset: RangePreset;
  customFrom: string;
  customTo: string;
}

export const RANGE_LABEL: Record<RangePreset, string> = {
  thisWeek: "This week",
  lastWeek: "Last week",
  month: "Month",
  quarter: "Quarter",
  custom: "Custom",
};

/**
 * Resolve a preset to inclusive YYYY-MM-DD bounds.
 *
 * `todayStr` is a parameter rather than a call to localDateStr() so callers
 * that memoize the result can list it as a dependency and recompute at the
 * midnight rollover — see useToday.
 */
export function resolveRange(state: RangeState, todayStr: string = localDateStr()): { from: string; to: string } {
  if (state.preset === "custom") {
    // An unfinished custom range collapses to today rather than to the whole
    // of history: a half-typed date must never become a 100,000-row read.
    return { from: state.customFrom || todayStr, to: state.customTo || todayStr };
  }
  if (state.preset === "thisWeek") {
    const from = weekStartStr(todayStr);
    return { from, to: addDaysStr(from, 6) };
  }
  if (state.preset === "lastWeek") {
    const from = addDaysStr(weekStartStr(todayStr), -7);
    return { from, to: addDaysStr(from, 6) };
  }
  const start = new Date(`${todayStr}T00:00:00`);
  if (state.preset === "month") {
    start.setDate(1);
  } else {
    // Calendar quarter, not "the last 90 days" — a quarter is what a report
    // is compared against.
    start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
  }
  return { from: localDateStr(start), to: todayStr };
}

/** The same span, one period earlier — what a delta is measured against. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const days = Math.round(
    (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000
  ) + 1;
  return { from: addDaysStr(from, -days), to: addDaysStr(to, -days) };
}

/** "31 August – 6 September", or a single date when the range is one day. */
export function rangeLabel(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const fmt = (d: Date, withMonth: boolean) =>
    d.toLocaleDateString(DATE_LOCALE, withMonth ? { day: "numeric", month: "long" } : { day: "numeric" });
  if (from === to) return fmt(start, true);
  return `${fmt(start, !sameMonth)} – ${fmt(end, true)}`;
}
