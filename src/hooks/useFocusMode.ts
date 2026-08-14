import { useCallback, useEffect, useState } from "react";
import { getCurrentUser } from "../services/userService";
import { localDateStr } from "../utils/dates";

/**
 * Focus (Pomodoro) mode — a prescriptive cadence layered on the existing
 * timer. The tracked timer stays the record of what happened; this hook only
 * decides when to *prompt*: after `focusMinutes` of running timer it asks
 * "break or keep going?", and when a break ends it asks to start the next
 * block. Taking a break stops (and saves) the running entry — honest
 * tracking; the break itself is never logged as work.
 *
 * Everything is per-user localStorage (settings, sessions-completed-today),
 * matching the weekly target's scoping. Prompts only fire while the app tab
 * is open: a Code App has no OS-level presence, so there are no background
 * notifications (that's why Clockify ships Pomodoro as a browser extension).
 */
export type FocusPhase =
  | "off"           // disabled, or enabled but no block in progress
  | "focus"         // timer running, counting down a focus block
  | "prompt-break"  // block complete — ask break / keep going
  | "break"         // timer stopped, counting down the break
  | "prompt-resume"; // break over — ask to start the next block

export interface FocusSettings {
  focusMinutes: number;
  breakMinutes: number;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = { focusMinutes: 25, breakMinutes: 5 };

const SETTINGS_KEY_PREFIX = "tt_focus_mode:";
const SESSIONS_KEY_PREFIX = "tt_focus_sessions:";

function userScopedKey(prefix: string): string {
  const user = getCurrentUser();
  return `${prefix}${user.environmentId}:${user.id}`;
}

function clampMinutes(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 180 ? Math.round(n) : fallback;
}

interface StoredSettings extends FocusSettings { enabled: boolean }

function readSettings(): StoredSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(userScopedKey(SETTINGS_KEY_PREFIX)) || "{}") as Record<string, unknown>;
    return {
      enabled: raw.enabled === true,
      focusMinutes: clampMinutes(raw.focusMinutes, DEFAULT_FOCUS_SETTINGS.focusMinutes),
      breakMinutes: clampMinutes(raw.breakMinutes, DEFAULT_FOCUS_SETTINGS.breakMinutes),
    };
  } catch {
    return { enabled: false, ...DEFAULT_FOCUS_SETTINGS };
  }
}

function persistSettings(s: StoredSettings): void {
  try {
    localStorage.setItem(userScopedKey(SETTINGS_KEY_PREFIX), JSON.stringify(s));
  } catch { /* storage unavailable — settings just won't persist */ }
}

function readSessionsToday(): number {
  try {
    const raw = JSON.parse(localStorage.getItem(userScopedKey(SESSIONS_KEY_PREFIX)) || "{}") as Record<string, unknown>;
    return raw.date === localDateStr() && typeof raw.count === "number" && raw.count > 0
      ? Math.floor(raw.count)
      : 0;
  } catch {
    return 0;
  }
}

function persistSessionsToday(count: number): void {
  try {
    localStorage.setItem(userScopedKey(SESSIONS_KEY_PREFIX), JSON.stringify({ date: localDateStr(), count }));
  } catch { /* storage unavailable */ }
}

/**
 * Takes the timer's `startTime` rather than a seconds counter, and schedules
 * its transitions on the boundaries themselves instead of watching a 1 Hz
 * tick. This hook is called in AppContent, so any state it updates every
 * second re-renders the entire page tree (#95) — and the only thing that
 * genuinely happens every second is a label, which the component drawing it
 * can tick for itself from `endsAt`.
 */
export function useFocusMode(isRunning: boolean, startTime: string | null): {
  enabled: boolean;
  settings: FocusSettings;
  phase: FocusPhase;
  /** Instant the current focus block or break ends; null outside both. */
  endsAt: number | null;
  sessionsToday: number;
  toggleEnabled: () => void;
  updateSettings: (patch: Partial<FocusSettings>) => void;
  /** "Keep going" on the block-complete prompt: restart the countdown. */
  keepGoing: () => void;
  /** "Take a break": start the break countdown. The caller is responsible
   *  for stopping the timer (which saves the entry). */
  beginBreak: () => void;
  /** Dismiss the break-over prompt without starting a new block. */
  dismissResume: () => void;
} {
  const [stored, setStored] = useState<StoredSettings>(readSettings);
  const [phase, setPhase] = useState<FocusPhase>("off");
  const [sessionsToday, setSessionsToday] = useState<number>(readSessionsToday);
  // Instant the current focus block began — the session's own start, or the
  // moment "keep going" was pressed, so the next prompt lands a full block
  // later. The block's *end* is derived rather than stored, which is what lets
  // editing the interval mid-block move the boundary you're counting down to.
  const [blockStartedAt, setBlockStartedAt] = useState<number | null>(null);
  const [breakEndsAt, setBreakEndsAt] = useState<number | null>(null);

  const { enabled, focusMinutes, breakMinutes } = stored;
  const blockEndsAt = blockStartedAt === null ? null : blockStartedAt + focusMinutes * 60_000;

  // Persistence happens in effects keyed on the settled state, never inside
  // setState updater functions — React may replay updaters (StrictMode,
  // concurrent renders), which would duplicate the side effect.
  useEffect(() => {
    persistSettings(stored);
  }, [stored]);

  useEffect(() => {
    if (sessionsToday > 0) persistSessionsToday(sessionsToday);
  }, [sessionsToday]);

  // Each new running session anchors its focus countdown to its own start, so
  // a block measures tracked time and not time-since-this-component-mounted.
  useEffect(() => {
    if (isRunning && startTime) setBlockStartedAt(new Date(startTime).getTime());
    else if (!isRunning) setBlockStartedAt(null);
  }, [isRunning, startTime]);

  // Enter/leave the focus phase as the timer starts/stops. A manual stop
  // mid-block (or disabling the mode) drops any pending prompt — the user
  // has already decided what happens next.
  useEffect(() => {
    if (!enabled) {
      setPhase("off");
      setBlockStartedAt(null);
      setBreakEndsAt(null);
      return;
    }
    if (isRunning) {
      setPhase((p) => (p === "focus" || p === "prompt-break" ? p : "focus"));
      setBreakEndsAt(null);
    } else {
      setPhase((p) => (p === "focus" || p === "prompt-break" ? "off" : p));
    }
  }, [enabled, isRunning]);

  // Focus block complete → prompt, and count the completed block. Scheduled on
  // the boundary rather than re-checked every second: the only moment worth a
  // render between here and the end of the block is the end of the block.
  useEffect(() => {
    if (phase !== "focus" || !isRunning || blockEndsAt === null) return;
    const reachBoundary = () => {
      setPhase("prompt-break");
      setSessionsToday((prev) => prev + 1);
    };
    const delay = blockEndsAt - Date.now();
    // Already past it (a restored session, or an interval edited down below
    // what's already elapsed) — prompt now instead of scheduling the past.
    if (delay <= 0) {
      reachBoundary();
      return;
    }
    const handle = setTimeout(reachBoundary, delay);
    return () => clearTimeout(handle);
  }, [phase, isRunning, blockEndsAt]);

  // Break over → prompt. Same shape, and the reason the break no longer needs
  // a 1 Hz interval of its own.
  useEffect(() => {
    if (phase !== "break" || breakEndsAt === null) return;
    const reachBoundary = () => {
      setBreakEndsAt(null);
      setPhase("prompt-resume");
    };
    const delay = breakEndsAt - Date.now();
    if (delay <= 0) {
      reachBoundary();
      return;
    }
    const handle = setTimeout(reachBoundary, delay);
    return () => clearTimeout(handle);
  }, [phase, breakEndsAt]);

  const toggleEnabled = useCallback(() => {
    setStored((prev) => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  const updateSettings = useCallback((patch: Partial<FocusSettings>) => {
    setStored((prev) => ({
      enabled: prev.enabled,
      focusMinutes: clampMinutes(patch.focusMinutes ?? prev.focusMinutes, prev.focusMinutes),
      breakMinutes: clampMinutes(patch.breakMinutes ?? prev.breakMinutes, prev.breakMinutes),
    }));
  }, []);

  const keepGoing = useCallback(() => {
    setBlockStartedAt(Date.now());
    setPhase("focus");
  }, []);

  // The break's end is pinned when it starts, unlike a focus block's: a break
  // is a promise about when you come back, so editing the interval mid-break
  // shouldn't move it.
  const beginBreak = useCallback(() => {
    setBreakEndsAt(Date.now() + breakMinutes * 60_000);
    setPhase("break");
  }, [breakMinutes]);

  const dismissResume = useCallback(() => {
    setPhase("off");
  }, []);

  return {
    enabled,
    settings: { focusMinutes, breakMinutes },
    phase,
    endsAt: phase === "break" ? breakEndsAt : phase === "focus" ? blockEndsAt : null,
    sessionsToday,
    toggleEnabled,
    updateSettings,
    keepGoing,
    beginBreak,
    dismissResume,
  };
}
