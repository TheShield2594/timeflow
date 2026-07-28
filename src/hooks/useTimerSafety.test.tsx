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

  it("stops listening once unmounted", () => {
    const { result, unmount } = renderHook(() => useActivityTracker());
    unmount();
    const afterUnmount = result.current.current;

    act(() => { vi.advanceTimersByTime(60_000); });
    act(() => { window.dispatchEvent(new Event("keydown")); });

    expect(result.current.current).toBe(afterUnmount);
  });
});
