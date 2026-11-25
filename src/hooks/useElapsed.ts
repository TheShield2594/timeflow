import { useEffect, useState } from "react";

/**
 * Seconds since `startTime`, ticked by whoever calls this rather than higher up.
 *
 * A clock is the only thing on the screen that changes every second, so it
 * is the only thing that should re-render every second — a counter held in the
 * app shell re-reconciled every mounted page once a second for the whole
 * length of a session (#95). That is why this is a hook and not shell state:
 * the timer hero and the sidebar's Timer item (#203) each call it, and each
 * re-renders only its own digits.
 */
export function useElapsed(startTime: string | null, isRunning: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning || !startTime) {
      setElapsed(0);
      return;
    }
    const startMs = new Date(startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - startMs) / 1000));
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [startTime, isRunning]);
  return elapsed;
}
