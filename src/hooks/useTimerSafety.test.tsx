import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  IDLE_THRESHOLD_MS,
  MAX_DURATION_MS,
  useActivityTracker,
  useTimerSafetyMonitor,
} from "./useTimerSafety";

const START = new Date("2026-06-01T09:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
});

/** The monitor takes a ref, not a value — a plain object stands in for one. */
function activityRef(at = Date.now()): React.MutableRefObject<number> {
  return { current: at };
}

function mountMonitor(opts: {
  isRunning?: boolean;
  startTime?: string | null;
  lastActivity?: React.MutableRefObject<number>;
} = {}) {
  const onIdleDetected = vi.fn();
  const onMaxDurationReached = vi.fn();
  const lastActivity = opts.lastActivity ?? activityRef();
  const view = renderHook(
    ({ isRunning, startTime }: { isRunning: boolean; startTime: string | null }) =>
      useTimerSafetyMonitor({ isRunning, startTime, lastActivity, onIdleDetected, onMaxDurationReached }),
    {
      initialProps: {
        isRunning: opts.isRunning ?? true,
        startTime: opts.startTime === undefined ? START.toISOString() : opts.startTime,
      },
    }
  );
  return { ...view, onIdleDetected, onMaxDurationReached, lastActivity };
}

describe("useTimerSafetyMonitor idle detection", () => {
  it("stays quiet while the user is active", () => {
    const { onIdleDetected, onMaxDurationReached, lastActivity } = mountMonitor();

    for (let i = 0; i < 5; i++) {
      act(() => { vi.advanceTimersByTime(10 * 60 * 1000); });
      lastActivity.current = Date.now(); // still typing
    }

    expect(onIdleDetected).not.toHaveBeenCalled();
    expect(onMaxDurationReached).not.toHaveBeenCalled();
  });

  it("fires once the idle threshold is crossed, reporting when activity stopped", () => {
    const lastActivity = activityRef();
    const lastActiveAt = lastActivity.current;
    const { onIdleDetected } = mountMonitor({ lastActivity });

    act(() => { vi.advanceTimersByTime(IDLE_THRESHOLD_MS - 1000); });
    expect(onIdleDetected).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(2 * 60 * 1000); });
    expect(onIdleDetected).toHaveBeenCalledTimes(1);
    expect(onIdleDetected).toHaveBeenCalledWith(lastActiveAt);
  });

  it("does not re-prompt every minute once it has fired", () => {
    const { onIdleDetected } = mountMonitor();

    act(() => { vi.advanceTimersByTime(IDLE_THRESHOLD_MS + 60_000); });
    expect(onIdleDetected).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(30 * 60 * 1000); });
    expect(onIdleDetected).toHaveBeenCalledTimes(1);
  });

  it("re-arms for the next session when the timer stops and starts again", () => {
    const lastActivity = activityRef();
    const { rerender, onIdleDetected } = mountMonitor({ lastActivity });

    act(() => { vi.advanceTimersByTime(IDLE_THRESHOLD_MS + 60_000); });
    expect(onIdleDetected).toHaveBeenCalledTimes(1);

    // Timer stopped, user came back, timer started again.
    rerender({ isRunning: false, startTime: null });
    lastActivity.current = Date.now();
    rerender({ isRunning: true, startTime: new Date().toISOString() });

    act(() => { vi.advanceTimersByTime(IDLE_THRESHOLD_MS + 60_000); });
    expect(onIdleDetected).toHaveBeenCalledTimes(2);
  });

  it("watches nothing while no timer is running", () => {
    const { onIdleDetected, onMaxDurationReached } = mountMonitor({ isRunning: false, startTime: null });

    act(() => { vi.advanceTimersByTime(MAX_DURATION_MS + 60_000); });

    expect(onIdleDetected).not.toHaveBeenCalled();
    expect(onMaxDurationReached).not.toHaveBeenCalled();
  });

  it("ignores a running flag with no start time rather than treating 0 as the epoch", () => {
    const { onMaxDurationReached } = mountMonitor({ isRunning: true, startTime: null });

    act(() => { vi.advanceTimersByTime(MAX_DURATION_MS + 60_000); });

    expect(onMaxDurationReached).not.toHaveBeenCalled();
  });
});

describe("useTimerSafetyMonitor 12h auto-stop", () => {
  it("fires once the timer has run past the maximum duration", () => {
    const { onMaxDurationReached } = mountMonitor();

    act(() => { vi.advanceTimersByTime(MAX_DURATION_MS - 60_000); });
    expect(onMaxDurationReached).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(2 * 60 * 1000); });
    expect(onMaxDurationReached).toHaveBeenCalled();
  });

  it("catches a timer that was already over the limit when the app loaded", () => {
    const startedLongAgo = new Date(START.getTime() - MAX_DURATION_MS - 60_000).toISOString();
    const { onMaxDurationReached, onIdleDetected } = mountMonitor({ startTime: startedLongAgo });

    // The first check runs immediately, without waiting a minute for the
    // interval — a 13h timer restored from storage stops on sight.
    expect(onMaxDurationReached).toHaveBeenCalled();
    // …and the idle prompt doesn't also fire; the session is being stopped.
    expect(onIdleDetected).not.toHaveBeenCalled();
  });
});

/** Drive document.hidden the way a tab switch does. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: hidden ? "hidden" : "visible",
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useTimerSafetyMonitor with the tab in the background", () => {
  it("does not prompt while the tab is hidden", () => {
    const { onIdleDetected } = mountMonitor();

    act(() => { setHidden(true); });
    act(() => { vi.advanceTimersByTime(IDLE_THRESHOLD_MS + 5 * 60 * 1000); });

    // The user is in another app doing the work being timed. Nothing here can
    // see that, and a prompt they can't see is one they'd come back to (#98).
    expect(onIdleDetected).not.toHaveBeenCalled();
  });

  it("does not prompt for time the tab spent hidden once it comes back", () => {
    const lastActivity = renderHook(() => useActivityTracker()).result.current;
    const { onIdleDetected } = mountMonitor({ lastActivity });

    act(() => { setHidden(true); });
    act(() => { vi.advanceTimersByTime(60 * 60 * 1000); });
    act(() => { setHidden(false); });
    act(() => { vi.advanceTimersByTime(60 * 1000); });

    expect(onIdleDetected).not.toHaveBeenCalled();
  });

  it("still prompts for idle time accrued before the tab was hidden", () => {
    const lastActivity = renderHook(() => useActivityTracker()).result.current;
    const { onIdleDetected } = mountMonitor({ lastActivity });
    const lastActiveAt = lastActivity.current;

    // 25 minutes at the desk doing nothing, an hour away, then back. The hour
    // away is forgiven; the 25 minutes are not, so five more minutes here
    // crosses the threshold.
    act(() => { vi.advanceTimersByTime(25 * 60 * 1000); });
    act(() => { setHidden(true); });
    act(() => { vi.advanceTimersByTime(60 * 60 * 1000); });
    act(() => { setHidden(false); });
    expect(onIdleDetected).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(6 * 60 * 1000); });
    expect(onIdleDetected).toHaveBeenCalledTimes(1);
    // The reported "last active" is shifted by the hidden hour, so trimming
    // to it doesn't throw away the time spent away.
    expect(onIdleDetected).toHaveBeenCalledWith(lastActiveAt + 60 * 60 * 1000);
  });

  it("still auto-stops a 12h timer while the tab is hidden", () => {
    const { onMaxDurationReached } = mountMonitor();

    act(() => { setHidden(true); });
    act(() => { vi.advanceTimersByTime(MAX_DURATION_MS + 60_000); });

    // That limit measures the timer, not the user — being away is exactly
    // when a forgotten timer needs stopping.
    expect(onMaxDurationReached).toHaveBeenCalled();
  });
});

describe("useActivityTracker", () => {
  it("bumps the timestamp on user input", () => {
    const { result } = renderHook(() => useActivityTracker());
    const initial = result.current.current;

    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });
    expect(result.current.current).toBe(initial);

    act(() => { window.dispatchEvent(new Event("keydown")); });
    expect(result.current.current).toBe(Date.now());
    expect(result.current.current).toBeGreaterThan(initial);
  });

  it("does not count time the tab spent hidden as idle time", () => {
    const { result } = renderHook(() => useActivityTracker());
    const initial = result.current.current;

    act(() => { setHidden(true); });
    act(() => { vi.advanceTimersByTime(45 * 60 * 1000); });
    act(() => { setHidden(false); });

    // The hidden interval is credited back, so the idle age is unchanged
    // rather than the 45 minutes the clock says.
    expect(result.current.current).toBe(initial + 45 * 60 * 1000);
    expect(Date.now() - result.current.current).toBe(0);
  });

  it("never reports activity in the future", () => {
    const { result } = renderHook(() => useActivityTracker());

    act(() => { vi.advanceTimersByTime(10 * 60 * 1000); });
    act(() => { window.dispatchEvent(new Event("keydown")); });
    // Hidden and back inside the same tick: crediting the interval must not
    // push lastActivity past now.
    act(() => { setHidden(true); });
    act(() => { setHidden(false); });

    expect(result.current.current).toBe(Date.now());
  });

  it("stops listening once unmounted", () => {
    const { result, unmount } = renderHook(() => useActivityTracker());
    unmount();
    const afterUnmount = result.current.current;

    act(() => { vi.advanceTimersByTime(60_000); });
    act(() => { window.dispatchEvent(new Event("keydown")); });
    act(() => { setHidden(true); });
    act(() => { vi.advanceTimersByTime(60_000); });
    act(() => { setHidden(false); });

    expect(result.current.current).toBe(afterUnmount);
  });
});
