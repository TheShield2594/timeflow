import { useEffect, useState } from "react";
import { localDateStr } from "../utils/dates";

// The app is routinely left open across midnight, and anything that captured
// "today" at mount goes stale there: a session stopped after the rollover
// lands on a date outside the range that was derived from yesterday, so it
// stays invisible until the user navigates or reloads (#74).
const ROLLOVER_CHECK_MS = 60_000;

/**
 * Today as a local YYYY-MM-DD string, re-rendering the caller when the local
 * calendar day changes. The identity is stable within a day, so it's safe as
 * a useMemo/useEffect dependency.
 */
export function useToday(): string {
  const [today, setToday] = useState(localDateStr);

  useEffect(() => {
    const check = () => setToday((prev) => {
      const now = localDateStr();
      return now === prev ? prev : now;
    });
    // Polled rather than scheduled for the exact midnight boundary: a timer
    // set hours ahead drifts, doesn't fire while the tab is suspended, and
    // ignores clock/timezone changes. A minute of lag is imperceptible here.
    const handle = setInterval(check, ROLLOVER_CHECK_MS);
    // The tab can be backgrounded across the rollover with timers throttled,
    // so re-check as soon as it's visible again.
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(handle);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return today;
}
