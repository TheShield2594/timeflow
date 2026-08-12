import { useEffect, useRef } from "react";

// Deliberately no `pointermove`: it fires continuously throughout every scroll
// gesture and every mouse drift across the window, so it reports "working" for
// a page nobody is working on — the opposite failure from the one below, and
// it defeats idle detection entirely. Real intent (a click, a key, a scroll, a
// focus) is what counts as activity.
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll", "focus"];

/**
 * When the user last did something here. Time with the tab hidden doesn't
 * count against them: the most common reason to background this app is to go
 * and do the work being timed, and the app can't see that work happening
 * (#98). So the hidden interval is added back to `lastActivity` on the way in,
 * which subtracts it from the idle age without erasing idle time accrued
 * before the tab was hidden.
 */
export function useActivityTracker(): React.MutableRefObject<number> {
  const lastActivity = useRef<number>(Date.now());
  useEffect(() => {
    const bump = () => {
      lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, bump, { passive: true }));

    let hiddenSince: number | null = document.hidden ? Date.now() : null;
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenSince ??= Date.now();
        return;
      }
      if (hiddenSince === null) return;
      const now = Date.now();
      // Never past now — that would read as activity in the future.
      lastActivity.current = Math.min(now, lastActivity.current + (now - hiddenSince));
      hiddenSince = null;
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, bump));
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
  return lastActivity;
}

export const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
export const MAX_DURATION_MS = 12 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;

interface MonitorOpts {
  isRunning: boolean;
  startTime: string | null;
  lastActivity: React.MutableRefObject<number>;
  /** Fired once per idle event. Caller is responsible for not re-prompting. */
  onIdleDetected: (lastActiveAt: number) => void;
  onMaxDurationReached: () => void;
}

/**
 * Watches a running timer for two failure modes:
 *  - User went idle (> IDLE_THRESHOLD_MS without input) → prompt to trim / discard
 *  - Timer has run too long (> MAX_DURATION_MS) → auto-stop
 *
 * Re-arms when isRunning transitions false→true. The caller is responsible for
 * dismissing the idle prompt and not re-firing onIdleDetected while one is open.
 */
export function useTimerSafetyMonitor({
  isRunning,
  startTime,
  lastActivity,
  onIdleDetected,
  onMaxDurationReached,
}: MonitorOpts): void {
  const idleFiredRef = useRef(false);

  useEffect(() => {
    if (!isRunning || !startTime) {
      idleFiredRef.current = false;
      return;
    }

    const check = () => {
      const now = Date.now();
      const runningMs = now - new Date(startTime).getTime();
      if (runningMs > MAX_DURATION_MS) {
        onMaxDurationReached();
        return;
      }
      // Background timers still fire while the tab is hidden, but the tracker
      // only credits the hidden interval once the tab comes back — so an idle
      // age measured now is the frozen one, and prompting on it would offer to
      // trim a session the user worked straight through in another window
      // (#98). Wait until they're here to be asked. The max-duration stop
      // above is unaffected: it measures the timer, not the user.
      if (document.hidden) return;
      const idleMs = now - lastActivity.current;
      if (idleMs > IDLE_THRESHOLD_MS && !idleFiredRef.current) {
        idleFiredRef.current = true;
        onIdleDetected(lastActivity.current);
      }
    };
    check();
    const handle = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [isRunning, startTime, lastActivity, onIdleDetected, onMaxDurationReached]);
}
