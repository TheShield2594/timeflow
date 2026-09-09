import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { useIdleGuard } from "./useIdleGuard";
import { MAX_DURATION_MS } from "./useTimerSafety";
import type { TimeEntry, TimerState } from "../types";
import type { ToastAction, ToastKind } from "../contexts/ToastContext";

const RUNNING: TimerState = {
  isRunning: true,
  startTime: "2026-08-14T09:00:00.000Z",
  projectId: "proj-1",
  taskId: null,
  description: "Working",
  draftEntryId: "draft-1",
};

const STOPPED: TimerState = {
  isRunning: false, startTime: null, projectId: null, taskId: null, description: "",
};

function setup(timer: TimerState = RUNNING) {
  const spies = {
    stopAt: vi.fn<(endIso: string) => Promise<TimeEntry | undefined>>().mockResolvedValue({ id: "entry-1" } as TimeEntry),
    cancel: vi.fn<() => Promise<TimerState | null>>().mockResolvedValue(timer),
    restore: vi.fn<(session: TimerState) => Promise<boolean>>().mockResolvedValue(true),
    refresh: vi.fn<() => void>(),
    toast: vi.fn<(message: string, kind?: ToastKind, action?: ToastAction) => void>(),
  };
  const { result, rerender } = renderHook(
    ({ t }: { t: TimerState }) => {
      const saveToastSuppressed = useRef(false);
      return {
        guard: useIdleGuard({
          timer: t,
          stopAt: spies.stopAt,
          cancel: spies.cancel,
          restore: spies.restore,
          refresh: spies.refresh,
          toast: spies.toast,
          saveToastSuppressed,
        }),
        saveToastSuppressed,
      };
    },
    { initialProps: { t: timer } }
  );
  return { result, rerender, ...spies };
}

/** The action attached to the most recent toast that carried one. */
function lastToastAction(toast: ReturnType<typeof setup>["toast"]): ToastAction {
  const withAction = toast.mock.calls.filter((c) => c[2]);
  return withAction[withAction.length - 1][2]!;
}

// The clock is pinned just after RUNNING.startTime, not left at the real
// "now". The safety monitor compares Date.now() against the timer's start, so
// with a real clock these fixtures aged into a >12h session and every idle test
// tripped the 12-hour auto-stop instead — the file passed when it was written
// and started failing days later with no code change.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-08-14T09:05:00.000Z") });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

describe("useIdleGuard — discard", () => {
  it("offers a Restore action that re-opens the discarded session (#105)", async () => {
    const { result, cancel, restore, refresh, toast } = setup();

    await act(async () => { await result.current.guard.onDiscard(); });

    expect(cancel).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Session discarded.", "info", expect.objectContaining({ label: "Restore" }));

    refresh.mockClear();
    await act(async () => { lastToastAction(toast).onAction(); });

    // The session handed to restore is the one cancel returned — start time and
    // all — so the restored timer covers the same minutes it did before.
    expect(restore).toHaveBeenCalledWith(RUNNING);
    expect(refresh).toHaveBeenCalled();
  });

  it("does not claim a restore the timer refused", async () => {
    const { result, restore, refresh, toast } = setup();
    restore.mockResolvedValue(false);

    await act(async () => { await result.current.guard.onDiscard(); });
    refresh.mockClear();
    await act(async () => { lastToastAction(toast).onAction(); });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("says the entry was kept, and offers no undo, when there was nothing to discard", async () => {
    const { result, cancel, refresh, toast } = setup();
    cancel.mockResolvedValue(null);

    await act(async () => { await result.current.guard.onDiscard(); });

    expect(toast).toHaveBeenCalledWith(expect.stringContaining("already stopped"), "info");
    // No third argument: there is no session to put back, and a Restore button
    // that no-ops is worse than none.
    expect(toast.mock.calls.every((c) => !c[2])).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("useIdleGuard — trim and keep", () => {
  it("trims to the moment the user went idle", async () => {
    const { result, rerender, stopAt } = setup();

    // Drive a real idle detection rather than poking state: 31 minutes with no
    // activity, checked on the monitor's interval.
    await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60 * 1000); });
    rerender({ t: RUNNING });
    const alert = result.current.guard.idleAlert;
    expect(alert).not.toBeNull();

    await act(async () => { await result.current.guard.onTrim(); });

    expect(stopAt).toHaveBeenCalledWith(new Date(alert!.lastActiveAt).toISOString());
    expect(result.current.guard.idleAlert).toBeNull();
  });

  it("reports a trim that landed on an already-stopped timer instead of doing nothing visible", async () => {
    const { result, rerender, stopAt, toast } = setup();
    stopAt.mockResolvedValue(undefined);

    await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60 * 1000); });
    rerender({ t: RUNNING });
    await act(async () => { await result.current.guard.onTrim(); });

    expect(toast).toHaveBeenCalledWith(expect.stringContaining("nothing to trim"), "info");
  });

  it("keeping the session dismisses the prompt and does not re-fire immediately", async () => {
    const { result, rerender, stopAt } = setup();

    await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60 * 1000); });
    rerender({ t: RUNNING });
    expect(result.current.guard.idleAlert).not.toBeNull();

    act(() => { result.current.guard.onKeep(); });
    expect(result.current.guard.idleAlert).toBeNull();

    // The idle clock restarts from the click, so the next check is quiet.
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    expect(result.current.guard.idleAlert).toBeNull();
    expect(stopAt).not.toHaveBeenCalled();
  });
});

describe("useIdleGuard — safety net", () => {
  it("auto-stops at the 12h cap and raises the sheet instead of a toast", async () => {
    const started = new Date(Date.now() - (MAX_DURATION_MS + 60_000)).toISOString();
    const { result, stopAt, toast } = setup({ ...RUNNING, startTime: started });

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    expect(stopAt).toHaveBeenCalledWith(
      new Date(new Date(started).getTime() + MAX_DURATION_MS).toISOString()
    );
    // A message that reports something the user didn't ask for *and* needs an
    // answer is not a toast: the capped entry is handed up so the shell can
    // put a sheet over it.
    expect(toast).not.toHaveBeenCalled();
    expect(result.current.guard.autoStopped).not.toBeNull();
    // Cleared once the stop resolved, so the suppression can't leak onto a
    // later save the user makes themselves.
    expect(result.current.saveToastSuppressed.current).toBe(false);
  });

  it("drops the prompt when the timer stops for a reason the modal didn't drive", async () => {
    const { result, rerender } = setup();

    await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60 * 1000); });
    rerender({ t: RUNNING });
    expect(result.current.guard.idleAlert).not.toBeNull();

    // e.g. another tab stopped the timer; the storage sync lands here.
    rerender({ t: STOPPED });
    expect(result.current.guard.idleAlert).toBeNull();
  });
});
