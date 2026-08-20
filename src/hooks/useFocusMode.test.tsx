import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFocusMode, DEFAULT_FOCUS_SETTINGS } from "./useFocusMode";

// The SDK's app entrypoint has an extensionless internal import that Node's
// ESM resolver can't follow, which is why userService used to be replaced
// wholesale here. Stubbing just that one module lets the real userService
// load, so the mock below can spread it.
vi.mock("@microsoft/power-apps/app", () => ({ getContext: vi.fn() }));
vi.mock("../services/userService", async (importOriginal) => ({
  // Spread the real module: replacing it wholesale left isPowerAppsHost
  // undefined, and the resulting TypeError was swallowed into a hook
  // error state that the assertions never looked at (#114).
  ...(await importOriginal<typeof import("../services/userService")>()),
  getCurrentUser: () => ({ id: "user-1", email: "u@example.com", displayName: "User One", environmentId: "env-1" }),
}));

// A fixed clock throughout: the hook now works in instants rather than a
// seconds counter handed to it, so advancing the timers *is* the passage of
// time under test — there is no tick to fake by re-rendering.
const START = new Date("2026-08-14T09:00:00.000Z").getTime();
const FOCUS_MS = DEFAULT_FOCUS_SETTINGS.focusMinutes * 60_000;
const BREAK_MS = DEFAULT_FOCUS_SETTINGS.breakMinutes * 60_000;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function renderFocus(initial: { isRunning: boolean; startTime: string | null }) {
  return renderHook(
    ({ isRunning, startTime }: { isRunning: boolean; startTime: string | null }) =>
      useFocusMode(isRunning, startTime),
    { initialProps: initial }
  );
}

const iso = (ms: number) => new Date(ms).toISOString();
const idle = { isRunning: false, startTime: null };

describe("useFocusMode", () => {
  it("is off by default and persists the toggle per user", () => {
    const { result } = renderFocus(idle);
    expect(result.current.enabled).toBe(false);
    act(() => result.current.toggleEnabled());
    expect(result.current.enabled).toBe(true);
    expect(localStorage.getItem("tt_focus_mode:env-1:user-1")).toContain('"enabled":true');
  });

  it("counts a running timer down and prompts at the block boundary, counting the session", () => {
    const { result, rerender } = renderFocus(idle);
    act(() => result.current.toggleEnabled());
    rerender({ isRunning: true, startTime: iso(START) });
    expect(result.current.phase).toBe("focus");
    // Anchored to the session's own start, not to when this hook mounted.
    expect(result.current.endsAt).toBe(START + FOCUS_MS);

    act(() => { vi.advanceTimersByTime(FOCUS_MS - 1000); });
    expect(result.current.phase).toBe("focus");

    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.phase).toBe("prompt-break");
    expect(result.current.sessionsToday).toBe(1);
    expect(localStorage.getItem("tt_focus_sessions:env-1:user-1")).toContain('"count":1');
  });

  it("prompts straight away for a session already past its block boundary", () => {
    const { result, rerender } = renderFocus(idle);
    act(() => result.current.toggleEnabled());
    // A timer restored on reload, started well over a block ago.
    rerender({ isRunning: true, startTime: iso(START - FOCUS_MS - 60_000) });
    expect(result.current.phase).toBe("prompt-break");
    expect(result.current.sessionsToday).toBe(1);
  });

  it("'keep going' re-anchors the countdown to a full block from now", () => {
    const { result, rerender } = renderFocus(idle);
    act(() => result.current.toggleEnabled());
    rerender({ isRunning: true, startTime: iso(START) });
    act(() => { vi.advanceTimersByTime(FOCUS_MS); });
    expect(result.current.phase).toBe("prompt-break");

    act(() => result.current.keepGoing());
    expect(result.current.phase).toBe("focus");
    expect(result.current.endsAt).toBe(START + FOCUS_MS + FOCUS_MS);

    act(() => { vi.advanceTimersByTime(FOCUS_MS); });
    expect(result.current.phase).toBe("prompt-break");
    expect(result.current.sessionsToday).toBe(2);
  });

  it("moves the boundary when the interval is edited mid-block", () => {
    const { result, rerender } = renderFocus(idle);
    act(() => result.current.toggleEnabled());
    rerender({ isRunning: true, startTime: iso(START) });

    act(() => result.current.updateSettings({ focusMinutes: 50 }));
    expect(result.current.endsAt).toBe(START + 50 * 60_000);
    act(() => { vi.advanceTimersByTime(FOCUS_MS); });
    expect(result.current.phase).toBe("focus");
  });

  it("runs the break countdown and prompts to resume when it ends", () => {
    const { result, rerender } = renderFocus(idle);
    act(() => result.current.toggleEnabled());
    rerender({ isRunning: true, startTime: iso(START) });
    act(() => { vi.advanceTimersByTime(FOCUS_MS); });

    act(() => result.current.beginBreak());
    // The caller stops the timer right after; the break must survive that.
    rerender(idle);
    expect(result.current.phase).toBe("break");
    expect(result.current.endsAt).toBe(START + FOCUS_MS + BREAK_MS);

    act(() => { vi.advanceTimersByTime(BREAK_MS); });
    expect(result.current.phase).toBe("prompt-resume");
    expect(result.current.endsAt).toBeNull();

    // Restarting the timer (continue) rolls straight into the next block.
    rerender({ isRunning: true, startTime: iso(Date.now()) });
    expect(result.current.phase).toBe("focus");
  });

  it("drops the block (without counting it) when the timer stops mid-focus", () => {
    const { result, rerender } = renderFocus(idle);
    act(() => result.current.toggleEnabled());
    rerender({ isRunning: true, startTime: iso(START) });
    expect(result.current.phase).toBe("focus");

    act(() => { vi.advanceTimersByTime(60_000); });
    rerender(idle);
    expect(result.current.phase).toBe("off");
    expect(result.current.sessionsToday).toBe(0);

    // And the abandoned block's boundary must not still be scheduled.
    act(() => { vi.advanceTimersByTime(FOCUS_MS); });
    expect(result.current.phase).toBe("off");
    expect(result.current.sessionsToday).toBe(0);
  });

  it("clamps and persists interval edits", () => {
    const { result } = renderFocus(idle);
    act(() => result.current.updateSettings({ focusMinutes: 50, breakMinutes: 10 }));
    expect(result.current.settings).toEqual({ focusMinutes: 50, breakMinutes: 10 });
    act(() => result.current.updateSettings({ focusMinutes: 0 }));
    // Out-of-range input keeps the previous value.
    expect(result.current.settings.focusMinutes).toBe(50);
    expect(localStorage.getItem("tt_focus_mode:env-1:user-1")).toContain('"focusMinutes":50');
  });

  it("resets the daily session count on a new day", () => {
    localStorage.setItem("tt_focus_sessions:env-1:user-1", JSON.stringify({ date: "2000-01-01", count: 7 }));
    const { result } = renderFocus(idle);
    expect(result.current.sessionsToday).toBe(0);
  });
});
