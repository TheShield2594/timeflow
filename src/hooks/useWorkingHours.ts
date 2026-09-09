import { useCallback, useState } from "react";
import { getCurrentUser } from "../services/userService";
import { GAP_MUST_EXCEED_MINUTES, WORK_DAY_END_MIN, WORK_DAY_START_MIN } from "../utils/gaps";
import { MINUTES_PER_DAY } from "../utils/dates";

/**
 * The window gap detection is confined to, and the floor below which a hole
 * isn't worth offering.
 *
 * These were constants — 08:00, 18:00, and "longer than 15 minutes" — which
 * is a correctness bug, not a preference: someone on a 06:00 start has two
 * hours of real work outside the search window every day, so the app quietly
 * told them their day was complete when it wasn't, and someone on nights got
 * gaps for the hours they were asleep.
 */
export interface WorkingHours {
  startMin: number;
  endMin: number;
  /** Strictly-greater-than, matching findUntrackedGaps. */
  gapMustExceedMinutes: number;
}

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  startMin: WORK_DAY_START_MIN,
  endMin: WORK_DAY_END_MIN,
  gapMustExceedMinutes: GAP_MUST_EXCEED_MINUTES,
};

// Same scoping as the weekly target and the timer: Power Apps Code Apps have
// no per-user settings store, so this is localStorage keyed by environment +
// user inside the host iframe.
const KEY_PREFIX = "tt_working_hours:";

function storageKey(): string {
  const user = getCurrentUser();
  return `${KEY_PREFIX}${user.environmentId}:${user.id}`;
}

/**
 * A minute of the day, held to 00:00–23:59.
 *
 * Not 24:00, even though the gap search would happily take it: these values
 * are read and written through `<input type="time">`, whose own range stops
 * at 23:59. A stored 1440 has no representation there — it renders as an
 * empty field, reads back as 0, fails the `endMin > startMin` check below,
 * and resets the entire window to the 18:00 default without saying so. The
 * search loses its last minute of the day and nothing else; the default gap
 * threshold is fifteen times that.
 */
function clampMinute(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MINUTES_PER_DAY - 1, Math.max(0, Math.round(n)));
}

/**
 * Read, then sanity-check.
 *
 * A window whose end is at or before its start makes `findUntrackedGaps`
 * return nothing at all, on every day, silently — the exact failure this
 * setting exists to prevent. So the invariant `endMin > startMin` has to hold
 * for *every* input, including the ones that reach the fallback: falling back
 * to the default 18:00 against a stored 23:59 start is still inverted. The
 * start is clamped against the resolved end last, so there is no path out of
 * here with an empty window.
 */
export function normalizeWorkingHours(raw: Partial<WorkingHours> | null): WorkingHours {
  if (!raw) return DEFAULT_WORKING_HOURS;
  const requestedStart = clampMinute(raw.startMin, DEFAULT_WORKING_HOURS.startMin);
  const requestedEnd = clampMinute(raw.endMin, DEFAULT_WORKING_HOURS.endMin);
  const floor = Number(raw.gapMustExceedMinutes);

  const endMin = requestedEnd > requestedStart ? requestedEnd : DEFAULT_WORKING_HOURS.endMin;
  // A start the resolved end can't clear falls back too, and if even the
  // default start doesn't clear it (an end before 08:00), the day opens at
  // midnight rather than collapsing.
  const startMin = requestedStart < endMin
    ? requestedStart
    : DEFAULT_WORKING_HOURS.startMin < endMin ? DEFAULT_WORKING_HOURS.startMin : 0;

  return {
    startMin,
    endMin,
    gapMustExceedMinutes:
      Number.isFinite(floor) && floor >= 0 ? Math.min(240, Math.round(floor)) : DEFAULT_WORKING_HOURS.gapMustExceedMinutes,
  };
}

function read(): WorkingHours {
  try {
    return normalizeWorkingHours(JSON.parse(localStorage.getItem(storageKey()) || "null"));
  } catch {
    return DEFAULT_WORKING_HOURS;
  }
}

export function useWorkingHours(): {
  workingHours: WorkingHours;
  setWorkingHours: (next: Partial<WorkingHours>) => void;
} {
  const [workingHours, setState] = useState<WorkingHours>(read);

  const setWorkingHours = useCallback((next: Partial<WorkingHours>) => {
    setState((prev) => {
      const merged = normalizeWorkingHours({ ...prev, ...next });
      try {
        localStorage.setItem(storageKey(), JSON.stringify(merged));
      } catch { /* storage unavailable — keep the in-memory value */ }
      return merged;
    });
  }, []);

  return { workingHours, setWorkingHours };
}
