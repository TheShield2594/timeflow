import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll", "focus", "pointermove"];

export function useActivityTracker(): React.MutableRefObject<number> {
  const lastActivity = useRef<number>(Date.now());
  useEffect(() => {
    const bump = () => {
      lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, bump));
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
