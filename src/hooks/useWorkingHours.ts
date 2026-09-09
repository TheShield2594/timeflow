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

function clampMinute(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MINUTES_PER_DAY, Math.max(0, Math.round(n)));
}

/** Read, then sanity-check: a stored end at or before its start would make
 *  every day gapless, which is the failure mode this whole setting exists to
 *  prevent. */
export function normalizeWorkingHours(raw: Partial<WorkingHours> | null): WorkingHours {
  if (!raw) return DEFAULT_WORKING_HOURS;
  const startMin = clampMinute(raw.startMin, DEFAULT_WORKING_HOURS.startMin);
  const endMin = clampMinute(raw.endMin, DEFAULT_WORKING_HOURS.endMin);
  const floor = Number(raw.gapMustExceedMinutes);
  return {
    startMin,
    endMin: endMin > startMin ? endMin : DEFAULT_WORKING_HOURS.endMin,
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
