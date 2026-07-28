import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFocusMode, DEFAULT_FOCUS_SETTINGS } from "./useFocusMode";

vi.mock("../services/userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "u@example.com", displayName: "User One", environmentId: "env-1" }),
}));

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function renderFocus(initial: { isRunning: boolean; elapsed: number }) {
  return renderHook(
    ({ isRunning, elapsed }: { isRunning: boolean; elapsed: number }) => useFocusMode(isRunning, elapsed),
    { initialProps: initial }
  );
}

const FOCUS_SEC = DEFAULT_FOCUS_SETTINGS.focusMinutes * 60;

describe("useFocusMode", () => {
  it("is off by default and persists the toggle per user", () => {
    const { result } = renderFocus({ isRunning: false, elapsed: 0 });
    expect(result.current.enabled).toBe(false);
    act(() => result.current.toggleEnabled());
    expect(result.current.enabled).toBe(true);
    expect(localStorage.getItem("tt_focus_mode:env-1:user-1")).toContain('"enabled":true');
  });

  it("counts a running timer down and prompts at the block boundary, counting the session", () => {
    const { result, rerender } = renderFocus({ isRunning: false, elapsed: 0 });
    act(() => result.current.toggleEnabled());
    rerender({ isRunning: true, elapsed: 0 });
    expect(result.current.phase).toBe("focus");
    expect(result.current.remainingSeconds).toBe(FOCUS_SEC);

    rerender({ isRunning: true, elapsed: FOCUS_SEC - 1 });
    expect(result.current.phase).toBe("focus");
    expect(result.current.remainingSeconds).toBe(1);

    rerender({ isRunning: true, elapsed: FOCUS_SEC });
    expect(result.current.phase).toBe("prompt-break");
    expect(result.current.sessionsToday).toBe(1);
    expect(localStorage.getItem("tt_focus_sessions:env-1:user-1")).toContain('"count":1');
  });

  it("'keep going' re-anchors the countdown to a full block from now", () => {
    const { result, rerender } = renderFocus({ isRunning: false, elapsed: 0 });
    act(() => result.current.toggleEnabled());
    rerender({ isRunning: true, elapsed: FOCUS_SEC });
    expect(result.current.phase).toBe("prompt-break");

    act(() => result.current.keepGoing());
    rerender({ isRunning: true, elapsed: FOCUS_SEC + 10 });
    expect(result.current.phase).toBe("focus");
    expect(result.current.remainingSeconds).toBe(FOCUS_SEC - 10);
  });

  it("runs the break countdown and prompts to resume when it ends", () => {
    const { result, rerender } = renderFocus({ isRunning: false, elapsed: 0 });
    act(() => result.current.toggleEnabled());
    rerender({ isRunning: true, elapsed: FOCUS_SEC });

    act(() => result.current.beginBreak());
    // The caller stops the timer right after; the break must survive that.
    rerender({ isRunning: false, elapsed: 0 });
    expect(result.current.phase).toBe("break");
    expect(result.current.remainingSeconds).toBe(DEFAULT_FOCUS_SETTINGS.breakMinutes * 60);

    act(() => {
      vi.advanceTimersByTime(DEFAULT_FOCUS_SETTINGS.breakMinutes * 60 * 1000 + 1000);
    });
    expect(result.current.phase).toBe("prompt-resume");

    // Restarting the timer (continue) rolls straight into the next block.
    rerender({ isRunning: true, elapsed: 0 });
    expect(result.current.phase).toBe("focus");
  });

  it("drops the block (without counting it) when the timer stops mid-focus", () => {
    const { result, rerender } = renderFocus({ isRunning: false, elapsed: 0 });
    act(() => result.current.toggleEnabled());
    rerender({ isRunning: true, elapsed: 60 });
    expect(result.current.phase).toBe("focus");
    rerender({ isRunning: false, elapsed: 0 });
    expect(result.current.phase).toBe("off");
    expect(result.current.sessionsToday).toBe(0);
  });

  it("clamps and persists interval edits", () => {
    const { result } = renderFocus({ isRunning: false, elapsed: 0 });
    act(() => result.current.updateSettings({ focusMinutes: 50, breakMinutes: 10 }));
    expect(result.current.settings).toEqual({ focusMinutes: 50, breakMinutes: 10 });
    act(() => result.current.updateSettings({ focusMinutes: 0 }));
    // Out-of-range input keeps the previous value.
    expect(result.current.settings.focusMinutes).toBe(50);
    expect(localStorage.getItem("tt_focus_mode:env-1:user-1")).toContain('"focusMinutes":50');
  });

  it("resets the daily session count on a new day", () => {
    localStorage.setItem("tt_focus_sessions:env-1:user-1", JSON.stringify({ date: "2000-01-01", count: 7 }));
    const { result } = renderFocus({ isRunning: false, elapsed: 0 });
    expect(result.current.sessionsToday).toBe(0);
  });
});
