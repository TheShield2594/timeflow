import { useCallback, useState } from "react";
import { getCurrentUser } from "../services/userService";

// Weekly target hours, persisted per environment + user in localStorage —
// Power Apps Code Apps have no per-user settings store, and this mirrors the
// key scoping the timer already uses inside the host iframe. 0 = unset.
const TARGET_KEY_PREFIX = "tt_weekly_target:";

function targetKey(): string {
  const user = getCurrentUser();
  return `${TARGET_KEY_PREFIX}${user.environmentId}:${user.id}`;
}

function readTarget(): number {
  try {
    const n = Number(localStorage.getItem(targetKey()) ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 168) : 0;
  } catch {
    return 0;
  }
}

export function useWeeklyTarget(): {
  targetHours: number;
  setTargetHours: (hours: number) => void;
} {
  const [targetHours, setTargetHoursState] = useState<number>(readTarget);

  const setTargetHours = useCallback((hours: number) => {
    const clamped = Number.isFinite(hours) && hours > 0 ? Math.min(Math.round(hours * 2) / 2, 168) : 0;
    setTargetHoursState(clamped);
    try {
      if (clamped > 0) localStorage.setItem(targetKey(), String(clamped));
      else localStorage.removeItem(targetKey());
    } catch { /* storage unavailable — keep in-memory value */ }
  }, []);

  return { targetHours, setTargetHours };
}
