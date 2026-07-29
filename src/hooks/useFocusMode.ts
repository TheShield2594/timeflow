import { useCallback, useEffect, useRef, useState } from "react";
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

export function useFocusMode(isRunning: boolean, elapsed: number): {
  enabled: boolean;
  settings: FocusSettings;
  phase: FocusPhase;
  /** Seconds left in the current focus block or break; 0 outside both. */
  remainingSeconds: number;
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
  // Elapsed-seconds value at which the current focus block started — non-zero
  // after "keep going", so the next prompt lands a full block later.
  const anchorRef = useRef(0);
  const [breakEndsAt, setBreakEndsAt] = useState<number | null>(null);
  // Ticker for the break countdown (the focus countdown rides on `elapsed`).
  const [now, setNow] = useState(() => Date.now());

  const { enabled, focusMinutes, breakMinutes } = stored;

  // Persistence happens in effects keyed on the settled state, never inside
  // setState updater functions — React may replay updaters (StrictMode,
  // concurrent renders), which would duplicate the side effect.
  useEffect(() => {
    persistSettings(stored);
  }, [stored]);

  useEffect(() => {
    if (sessionsToday > 0) persistSessionsToday(sessionsToday);
  }, [sessionsToday]);

  // Each new running session starts its focus countdown from zero elapsed.
  // (Ref write lives here, not in a setPhase updater, for the same
  // replay-safety reason as the persistence effects above.)
  useEffect(() => {
    if (isRunning) anchorRef.current = 0;
  }, [isRunning]);

  // Enter/leave the focus phase as the timer starts/stops. A manual stop
  // mid-block (or disabling the mode) drops any pending prompt — the user
  // has already decided what happens next.
  useEffect(() => {
    if (!enabled) {
      setPhase("off");
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

  // Focus block complete → prompt, and count the completed block.
  const focusRemaining = Math.max(0, focusMinutes * 60 - (elapsed - anchorRef.current));
  useEffect(() => {
    if (phase !== "focus" || !isRunning) return;
    if (focusRemaining > 0) return;
    setPhase("prompt-break");
    setSessionsToday((prev) => prev + 1);
  }, [phase, isRunning, focusRemaining]);

  // Break countdown.
  useEffect(() => {
    if (phase !== "break") return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [phase]);

  const breakRemaining = phase === "break" && breakEndsAt
    ? Math.max(0, Math.ceil((breakEndsAt - now) / 1000))
    : 0;

  useEffect(() => {
    if (phase !== "break" || breakEndsAt === null) return;
    if (breakRemaining > 0) return;
    setBreakEndsAt(null);
    setPhase("prompt-resume");
  }, [phase, breakEndsAt, breakRemaining]);

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
    anchorRef.current = elapsed;
    setPhase("focus");
  }, [elapsed]);

  const beginBreak = useCallback(() => {
    const endsAt = Date.now() + breakMinutes * 60 * 1000;
    setNow(Date.now());
    setBreakEndsAt(endsAt);
    setPhase("break");
  }, [breakMinutes]);

  const dismissResume = useCallback(() => {
    setPhase("off");
  }, []);

  return {
    enabled,
    settings: { focusMinutes, breakMinutes },
    phase,
    remainingSeconds: phase === "break" ? breakRemaining : phase === "focus" ? focusRemaining : 0,
    sessionsToday,
    toggleEnabled,
    updateSettings,
    keepGoing,
    beginBreak,
    dismissResume,
  };
}
