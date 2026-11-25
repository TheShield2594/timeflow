import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { useTimer } from "./useTimer";
import * as svc from "../services/dataverseService";
import type { TimeEntry, TimerState } from "../types";

const toastSpy = vi.fn();
vi.mock("../contexts/ToastContext", () => ({ useToast: () => toastSpy }));
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
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
}));
vi.mock("../services/dataverseService", () => ({
  getOpenTimerEntry: vi.fn().mockResolvedValue(null),
  createDraftTimerEntry: vi.fn().mockResolvedValue("draft-1"),
  createTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn().mockResolvedValue(undefined),
  isNotFoundError: vi.fn((err: unknown) => (err as { status?: number } | null)?.status === 404),
}));

const TIMER_STORAGE_KEY = "tt_active_timer:env-1:user-1";

// Only Date is faked, so waitFor's own timers still run. A stop at the same
// instant as its start rounds to 0m and is discarded rather than saved
// (#188); the tests that mean "a normal stop" move the clock on first.
const T0 = new Date("2026-09-08T16:00:00.000Z");
const LATER = new Date("2026-09-08T16:45:00.000Z");

/** A plain Stop, pressed 45 minutes after the session began. */
function stopLater(timer: ReturnType<typeof useTimer>) {
  vi.setSystemTime(LATER);
  return timer.stop();
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: T0 });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

describe("useTimer", () => {
  it("starts a timer, persists it to localStorage, and writes a draft entry", async () => {
    const { result } = renderHook(() => useTimer(vi.fn()));

    act(() => {
      result.current.start("proj-1", null, "Working");
    });

    expect(result.current.timer.isRunning).toBe(true);
    expect(result.current.timer.projectId).toBe("proj-1");
    expect(JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY)!).isRunning).toBe(true);

    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));
    expect(svc.createDraftTimerEntry).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", description: "Working" })
    );
  });

  // The guard reads timerRef, not the render snapshot (#94): inside one React
  // batch the closed-over state still says "not running" for both calls, so a
  // snapshot guard let both through and both created a draft row. The second
  // one won, and the first was left open — resurfacing on the next reload as a
  // phantom running timer.
  it("creates one draft, not two, for a double-click on Start", async () => {
    const { result } = renderHook(() => useTimer(vi.fn()));

    act(() => {
      result.current.start("proj-1", null, "Working");
      result.current.start("proj-1", null, "Working");
    });

    expect(svc.createDraftTimerEntry).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("already running"), "error");
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));
    expect(svc.deleteTimeEntry).not.toHaveBeenCalled();
  });

  it("lets a session start again in the same tick it was discarded in", async () => {
    const { result } = renderHook(() => useTimer(vi.fn()));

    await act(async () => {
      result.current.start("proj-1", null, "First");
    });
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));

    // Discard and immediately restart — the snapshot guard rejected this with
    // "Timer is already running" because `cancel` hadn't been committed yet.
    await act(async () => {
      const discarded = result.current.cancel();
      result.current.start("proj-2", null, "Second");
      await discarded;
    });

    expect(result.current.timer.isRunning).toBe(true);
    expect(result.current.timer.projectId).toBe("proj-2");
    expect(toastSpy).not.toHaveBeenCalledWith(expect.stringContaining("already running"), "error");
  });

  it("refuses to start without a project and shows a toast instead", () => {
    const { result } = renderHook(() => useTimer(vi.fn()));

    act(() => {
      result.current.start("", null, "");
    });

    expect(result.current.timer.isRunning).toBe(false);
    expect(localStorage.getItem(TIMER_STORAGE_KEY)).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("Pick a project"), "error");
  });

  it("stops the running timer, clears localStorage, and reports the saved entry via onStop", async () => {
    const savedEntry = { id: "entry-1" } as TimeEntry;
    vi.mocked(svc.updateTimeEntry).mockResolvedValue(savedEntry);
    const onStop = vi.fn();

    const { result } = renderHook(() => useTimer(onStop));

    await act(async () => {
      result.current.start("proj-1", null, "Working");
    });
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));

    await act(async () => {
      await stopLater(result.current);
    });

    expect(result.current.timer.isRunning).toBe(false);
    expect(localStorage.getItem(TIMER_STORAGE_KEY)).toBeNull();
    expect(onStop).toHaveBeenCalledWith(savedEntry, [savedEntry]);
    expect(svc.updateTimeEntry).toHaveBeenCalledWith(
      "draft-1",
      expect.objectContaining({ description: "Working" })
    );
  });

  it("saves once when a second stop arrives while the first is still in flight", async () => {
    // No draft row (its create failed at Start), so the stop is a create —
    // and "Retry save" is on screen before that create has answered. Each
    // extra press used to be its own create: duplicate billable entries.
    vi.mocked(svc.createDraftTimerEntry).mockRejectedValueOnce(new Error("offline"));
    let land!: (e: TimeEntry) => void;
    vi.mocked(svc.createTimeEntry).mockReturnValue(new Promise<TimeEntry>((r) => { land = r; }));
    const onStop = vi.fn();
    const { result } = renderHook(() => useTimer(onStop));

    await act(async () => { result.current.start("proj-1", null, "Working"); });

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      // The same end, as Retry and the shortcut send: `pendingStopAt`.
      first = result.current.stopAt("2026-09-08T17:00:00.000Z");
      second = result.current.stopAt("2026-09-08T17:00:00.000Z");
    });
    await act(async () => {
      land({ id: "entry-1" } as TimeEntry);
      await Promise.all([first, second]);
    });

    expect(svc.createTimeEntry).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("doesn't hand a stop for a different end time the in-flight stop's result", async () => {
    // The idle prompt's Trim, pressed while a plain stop is saving, asks for
    // an earlier end. Joined to the first attempt it would report the entry
    // as trimmed when it was saved at the later time. It waits instead, and
    // finding the session already saved, says there was nothing to stop.
    vi.mocked(svc.createDraftTimerEntry).mockRejectedValueOnce(new Error("offline"));
    let land!: (e: TimeEntry) => void;
    vi.mocked(svc.createTimeEntry).mockReturnValue(new Promise<TimeEntry>((r) => { land = r; }));
    const { result } = renderHook(() => useTimer(vi.fn()));
    await act(async () => { result.current.start("proj-1", null, "Working"); });

    let plain!: Promise<unknown>;
    let trim!: Promise<unknown>;
    act(() => {
      plain = result.current.stopAt("2026-09-08T17:00:00.000Z");
      trim = result.current.stopAt("2026-09-08T16:30:00.000Z");
    });
    await act(async () => { land({ id: "entry-1" } as TimeEntry); await plain; });

    await expect(plain).resolves.toEqual({ id: "entry-1" });
    await expect(trim).resolves.toBeUndefined();
    expect(svc.createTimeEntry).toHaveBeenCalledTimes(1);
  });

  it("leaves the timer running and prompts a retry if saving the stop fails", async () => {
    vi.mocked(svc.updateTimeEntry).mockRejectedValue(new Error("offline"));
    const onStop = vi.fn();

    const { result } = renderHook(() => useTimer(onStop));

    await act(async () => {
      result.current.start("proj-1", null, "Working");
    });
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));

    await act(async () => {
      await expect(stopLater(result.current)).rejects.toThrow("offline");
    });

    expect(onStop).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/retry/i), "error");
    // Stop persists pendingStopAt so the user can retry without losing the running state.
    expect(JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY)!).pendingStopAt).toBeTruthy();
  });

  it("cancel clears the timer without saving or invoking onStop", async () => {
    const onStop = vi.fn();
    const { result } = renderHook(() => useTimer(onStop));

    await act(async () => {
      result.current.start("proj-1", null, "Working");
    });
    expect(result.current.timer.isRunning).toBe(true);

    let discarded: TimerState | null | undefined;
    await act(async () => {
      discarded = await result.current.cancel();
    });

    // The discarded session comes back so the caller can offer to restore it.
    expect(discarded).toMatchObject({ projectId: "proj-1", description: "Working" });
    expect(result.current.timer.isRunning).toBe(false);
    expect(localStorage.getItem(TIMER_STORAGE_KEY)).toBeNull();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("cancel reports nothing discarded when there was no session", async () => {
    const { result } = renderHook(() => useTimer(vi.fn()));

    let discarded: TimerState | null | undefined;
    await act(async () => {
      discarded = await result.current.cancel();
    });

    expect(discarded).toBeNull();
    expect(svc.deleteTimeEntry).not.toHaveBeenCalled();
  });

  it("cancel deletes the draft row so no phantom timer is restored on reload", async () => {
    const { result } = renderHook(() => useTimer(vi.fn()));

    await act(async () => {
      result.current.start("proj-1", null, "Working");
    });
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));

    await act(async () => {
      await result.current.cancel();
    });

    expect(svc.deleteTimeEntry).toHaveBeenCalledWith("draft-1");
    expect(result.current.timer.isRunning).toBe(false);
  });

  it("falls back to creating the entry when the draft row was deleted (update 404s)", async () => {
    const notFound = Object.assign(new Error("gone"), { status: 404 });
    vi.mocked(svc.updateTimeEntry).mockRejectedValue(notFound);
    const savedEntry = { id: "entry-2" } as TimeEntry;
    vi.mocked(svc.createTimeEntry).mockResolvedValue(savedEntry);
    const onStop = vi.fn();

    const { result } = renderHook(() => useTimer(onStop));

    await act(async () => {
      result.current.start("proj-1", null, "Working");
    });
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));

    await act(async () => {
      await stopLater(result.current);
    });

    expect(svc.createTimeEntry).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", description: "Working" })
    );
    expect(onStop).toHaveBeenCalledWith(savedEntry, [savedEntry]);
    expect(result.current.timer.isRunning).toBe(false);
    expect(localStorage.getItem(TIMER_STORAGE_KEY)).toBeNull();
  });

  it("deletes an orphaned draft when its create resolves after the timer already stopped", async () => {
    let resolveDraft!: (id: string) => void;
    vi.mocked(svc.createDraftTimerEntry).mockImplementationOnce(
      () => new Promise<string>((res) => { resolveDraft = res; })
    );
    vi.mocked(svc.createTimeEntry).mockResolvedValue({ id: "entry-3" } as TimeEntry);
    const { result } = renderHook(() => useTimer(vi.fn()));

    await act(async () => {
      result.current.start("proj-1", null, "Working");
    });
    // Stop before the draft create resolves — the completed entry is created
    // through the no-draft path.
    await act(async () => {
      await stopLater(result.current);
    });
    expect(svc.createTimeEntry).toHaveBeenCalled();

    await act(async () => {
      resolveDraft("draft-late");
    });

    await waitFor(() => expect(svc.deleteTimeEntry).toHaveBeenCalledWith("draft-late"));
    expect(result.current.timer.draftEntryId).toBeUndefined();
  });

  it("keeps a freshly started timer when the mount-time server restore resolves late", async () => {
    let resolveOpen!: (entry: TimeEntry | null) => void;
    vi.mocked(svc.getOpenTimerEntry).mockImplementationOnce(
      () => new Promise<TimeEntry | null>((res) => { resolveOpen = res; })
    );
    const { result } = renderHook(() => useTimer(vi.fn()));

    act(() => {
      result.current.start("proj-new", null, "Fresh session");
    });
    const startedAt = result.current.timer.startTime;

    // A stale open draft from a crashed session on another device lands after
    // the user already started a new timer.
    await act(async () => {
      resolveOpen({
        id: "stale-draft",
        projectId: "proj-old",
        startTime: "2020-01-01T00:00:00Z",
        date: "2020-01-01",
        userId: "user-1",
        userDisplayName: "User One",
      } as TimeEntry);
    });

    expect(result.current.timer.projectId).toBe("proj-new");
    expect(result.current.timer.startTime).toBe(startedAt);
    expect(result.current.timer.description).toBe("Fresh session");
    // The new session's own draft survives — the old code deleted it here.
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));
    expect(svc.deleteTimeEntry).not.toHaveBeenCalled();
  });

  it("adopts the restored row as the draft id when it is the running session's own draft", async () => {
    let resolveOpen!: (entry: TimeEntry | null) => void;
    vi.mocked(svc.getOpenTimerEntry).mockImplementationOnce(
      () => new Promise<TimeEntry | null>((res) => { resolveOpen = res; })
    );
    // Draft create still in flight, so the timer has no draftEntryId yet.
    vi.mocked(svc.createDraftTimerEntry).mockImplementationOnce(() => new Promise<string>(() => {}));
    const { result } = renderHook(() => useTimer(vi.fn()));

    act(() => {
      result.current.start("proj-1", null, "Working");
    });
    act(() => {
      result.current.update({ description: "edited after start" });
    });
    const startedAt = result.current.timer.startTime!;

    await act(async () => {
      resolveOpen({
        id: "server-draft",
        projectId: "proj-1",
        startTime: startedAt,
        description: "Working",
        date: "2026-01-01",
        userId: "user-1",
        userDisplayName: "User One",
      } as TimeEntry);
    });

    expect(result.current.timer.draftEntryId).toBe("server-draft");
    // The local edit wins over the server's older copy of the same row.
    expect(result.current.timer.description).toBe("edited after start");
    expect(svc.deleteTimeEntry).not.toHaveBeenCalled();
  });

  it("adopts its own draft when the server hands the start back at second precision (#193)", async () => {
    // We send toISOString() with milliseconds; Dataverse returns the column
    // to the second. A string compare never matched in the host.
    let resolveOpen!: (entry: TimeEntry | null) => void;
    vi.mocked(svc.getOpenTimerEntry).mockImplementationOnce(
      () => new Promise<TimeEntry | null>((res) => { resolveOpen = res; })
    );
    vi.mocked(svc.createDraftTimerEntry).mockImplementationOnce(() => new Promise<string>(() => {}));
    const { result } = renderHook(() => useTimer(vi.fn()));
    act(() => { result.current.start("proj-1", null, "Working"); });
    const startedAt = result.current.timer.startTime!;
    const truncated = new Date(Math.floor(new Date(startedAt).getTime() / 1000) * 1000)
      .toISOString().replace(".000Z", "Z");

    await act(async () => {
      resolveOpen({
        id: "server-draft", projectId: "proj-1", startTime: truncated,
        date: "2026-01-01", userId: "user-1", userDisplayName: "User One",
      } as TimeEntry);
    });

    expect(result.current.timer.draftEntryId).toBe("server-draft");
  });

  describe("an orphaned draft after a stop that had to create (#193)", () => {
    // The draft create landed but its response was lost, so the session has
    // no draftEntryId and stop creates a second, complete row. The open
    // draft left behind would come back on the next load as a timer started
    // hours ago — and the 12-hour safety net would save it as 720 minutes.
    // clearAllMocks keeps implementations; put the module default back so the
    // open rows planted here don't reach the bootstrap of later tests.
    afterEach(() => { vi.mocked(svc.getOpenTimerEntry).mockResolvedValue(null); });

    async function stopWithoutDraftId(open: Partial<TimeEntry> | null) {
      vi.mocked(svc.createDraftTimerEntry).mockResolvedValueOnce(null);
      vi.mocked(svc.createTimeEntry).mockResolvedValue({ id: "entry-1" } as TimeEntry);
      const { result } = renderHook(() => useTimer(vi.fn()));
      await act(async () => { result.current.start("proj-1", null, "Working"); });
      const startedAt = result.current.timer.startTime!;
      vi.mocked(svc.getOpenTimerEntry).mockResolvedValue(
        open ? ({ projectId: "proj-1", date: "2026-01-01", ...open, startTime: open.startTime ?? startedAt } as TimeEntry) : null
      );
      await act(async () => { await stopLater(result.current); });
      return result;
    }

    it("deletes the session's open draft once the entry is saved", async () => {
      await stopWithoutDraftId({ id: "orphan" });
      await waitFor(() => expect(svc.deleteTimeEntry).toHaveBeenCalledWith("orphan"));
      expect(svc.createTimeEntry).toHaveBeenCalledTimes(1);
    });

    it("leaves a different session's open draft alone", async () => {
      await stopWithoutDraftId({ id: "someone-else", startTime: "2020-01-01T00:00:00Z" });
      await waitFor(() => expect(svc.getOpenTimerEntry).toHaveBeenCalledTimes(2));
      expect(svc.deleteTimeEntry).not.toHaveBeenCalled();
    });

    it("spares a session started since, inside the same second", async () => {
      // At the server's second precision a restart within that second matches
      // the stopped session's start; its draft is live, not an orphan.
      vi.mocked(svc.createDraftTimerEntry).mockResolvedValueOnce(null);
      vi.mocked(svc.createTimeEntry).mockResolvedValue({ id: "entry-1" } as TimeEntry);
      const { result } = renderHook(() => useTimer(vi.fn()));
      await act(async () => { result.current.start("proj-1", null, "Working"); });
      const firstStart = result.current.timer.startTime!;
      let resolveOpen!: (e: TimeEntry | null) => void;
      vi.mocked(svc.getOpenTimerEntry).mockImplementationOnce(
        () => new Promise<TimeEntry | null>((res) => { resolveOpen = res; })
      );
      await act(async () => { await stopLater(result.current); });
      // Back inside the first session's second, which is the point.
      vi.setSystemTime(T0);
      await act(async () => { result.current.start("proj-1", null, "Next"); });
      await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));

      await act(async () => {
        resolveOpen({ id: "draft-1", projectId: "proj-1", startTime: firstStart, date: "2026-01-01" } as TimeEntry);
      });

      expect(svc.deleteTimeEntry).not.toHaveBeenCalled();
    });

    it("still reports the stop as saved when the clean-up read fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(svc.createDraftTimerEntry).mockResolvedValueOnce(null);
      vi.mocked(svc.createTimeEntry).mockResolvedValue({ id: "entry-1" } as TimeEntry);
      const onStop = vi.fn();
      const { result } = renderHook(() => useTimer(onStop));
      await act(async () => { result.current.start("proj-1", null, "Working"); });
      vi.mocked(svc.getOpenTimerEntry).mockRejectedValue(new Error("throttled"));

      await act(async () => { await stopLater(result.current); });

      expect(onStop).toHaveBeenCalledWith({ id: "entry-1" }, [{ id: "entry-1" }]);
      expect(result.current.timer.isRunning).toBe(false);
      await waitFor(() => expect(warn).toHaveBeenCalled());
      expect(svc.deleteTimeEntry).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("doesn't look when the stop updated its own draft", async () => {
      vi.mocked(svc.updateTimeEntry).mockResolvedValue({ id: "draft-1" } as TimeEntry);
      const { result } = renderHook(() => useTimer(vi.fn()));
      await act(async () => { result.current.start("proj-1", null, "Working"); });
      await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));
      await act(async () => { await stopLater(result.current); });
      // Once on mount, never after.
      expect(svc.getOpenTimerEntry).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the local timer when the open-draft check fails outright", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let rejectOpen!: (err: unknown) => void;
    vi.mocked(svc.getOpenTimerEntry).mockImplementationOnce(
      () => new Promise<TimeEntry | null>((_res, rej) => { rejectOpen = rej; })
    );
    const { result } = renderHook(() => useTimer(vi.fn()));

    act(() => {
      result.current.start("proj-1", null, "Working");
    });

    await act(async () => {
      rejectOpen(Object.assign(new Error("429 throttled"), { status: 429 }));
    });

    expect(result.current.timer.isRunning).toBe(true);
    expect(result.current.timer.projectId).toBe("proj-1");
    warn.mockRestore();
  });

  it("keeps edits made while the draft create is in flight", async () => {
    let resolveDraft!: (id: string) => void;
    vi.mocked(svc.createDraftTimerEntry).mockImplementationOnce(
      () => new Promise<string>((res) => { resolveDraft = res; })
    );
    const { result } = renderHook(() => useTimer(vi.fn()));

    await act(async () => {
      result.current.start("proj-1", null, "Working");
    });
    act(() => {
      result.current.update({ description: "typed while saving", ratio: 1.5 });
    });

    await act(async () => {
      resolveDraft("draft-late");
    });

    expect(result.current.timer.draftEntryId).toBe("draft-late");
    expect(result.current.timer.description).toBe("typed while saving");
    expect(result.current.timer.ratio).toBe(1.5);
    expect(JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY)!).description).toBe("typed while saving");
  });

  it("still saves the entry when persisting the timer to localStorage throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const savedEntry = { id: "entry-9" } as TimeEntry;
    vi.mocked(svc.updateTimeEntry).mockResolvedValue(savedEntry);
    const onStop = vi.fn();
    const { result } = renderHook(() => useTimer(onStop));

    await act(async () => {
      result.current.start("proj-1", null, "Working");
    });
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));

    // Quota exceeded / storage disabled kicks in before the stop is saved.
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    try {
      await act(async () => {
        await stopLater(result.current);
      });
    } finally {
      setItem.mockRestore();
    }

    expect(svc.updateTimeEntry).toHaveBeenCalledWith("draft-1", expect.objectContaining({ endTime: expect.any(String) }));
    expect(onStop).toHaveBeenCalledWith(savedEntry, [savedEntry]);
    expect(result.current.timer.isRunning).toBe(false);
    expect(toastSpy).not.toHaveBeenCalledWith(expect.stringMatching(/retry/i), "error");
    // The save above only proves the stop path survived; this proves it
    // survived *because* persistTimer swallowed the write, not because the
    // spied setItem was never reached.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not be persisted"));
    warn.mockRestore();
  });

  it("adopts another tab's timer state from its storage event", () => {
    const { result } = renderHook(() => useTimer(vi.fn()));
    const otherTab = {
      isRunning: true,
      startTime: new Date().toISOString(),
      projectId: "proj-9",
      taskId: null,
      description: "started elsewhere",
    };

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: TIMER_STORAGE_KEY,
        newValue: JSON.stringify(otherTab),
      }));
    });

    expect(result.current.timer.isRunning).toBe(true);
    expect(result.current.timer.projectId).toBe("proj-9");

    // The other tab stopping (key removed) resets this tab too.
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: TIMER_STORAGE_KEY,
        newValue: null,
      }));
    });
    expect(result.current.timer.isRunning).toBe(false);
  });
});

describe("useTimer restore", () => {
  it("re-opens a discarded session on its original start time, not on now", async () => {
    const { result } = renderHook(() => useTimer(vi.fn()));

    await act(async () => {
      result.current.start("proj-1", "task-1", "Working", 2, "PROJ-9");
    });
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));
    const startedAt = result.current.timer.startTime;

    let discarded: TimerState | null | undefined;
    await act(async () => { discarded = await result.current.cancel(); });

    vi.mocked(svc.createDraftTimerEntry).mockResolvedValueOnce("draft-2");
    let restored: boolean | undefined;
    await act(async () => { restored = await result.current.restore(discarded!); });

    expect(restored).toBe(true);
    expect(result.current.timer.isRunning).toBe(true);
    // The whole point of the undo: the clock picks up where it was. A restore
    // that re-stamped startTime would silently shorten the session it claims
    // to have brought back.
    expect(result.current.timer.startTime).toBe(startedAt);
    expect(result.current.timer.projectId).toBe("proj-1");
    expect(result.current.timer.taskId).toBe("task-1");
    expect(result.current.timer.ratio).toBe(2);
    expect(result.current.timer.jiraTicket).toBe("PROJ-9");
    expect(JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY)!).startTime).toBe(startedAt);
  });

  it("writes a fresh draft row, since cancel deleted the old one", async () => {
    const { result } = renderHook(() => useTimer(vi.fn()));

    await act(async () => { result.current.start("proj-1", null, "Working"); });
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));

    let discarded: TimerState | null | undefined;
    await act(async () => { discarded = await result.current.cancel(); });
    expect(svc.deleteTimeEntry).toHaveBeenCalledWith("draft-1");

    vi.mocked(svc.createDraftTimerEntry).mockResolvedValueOnce("draft-2");
    await act(async () => { await result.current.restore(discarded!); });

    // Stamped with the original start time, so the restored row spans the same
    // minutes the discarded one did.
    expect(svc.createDraftTimerEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: "proj-1", startTime: discarded!.startTime })
    );
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-2"));
  });

  it("refuses to restore over a session the user has already started since", async () => {
    const { result } = renderHook(() => useTimer(vi.fn()));

    await act(async () => { result.current.start("proj-1", null, "First"); });
    let discarded: TimerState | null | undefined;
    await act(async () => { discarded = await result.current.cancel(); });

    await act(async () => { result.current.start("proj-2", null, "Second"); });
    vi.mocked(svc.createDraftTimerEntry).mockClear();

    let restored: boolean | undefined;
    await act(async () => { restored = await result.current.restore(discarded!); });

    expect(restored).toBe(false);
    expect(result.current.timer.projectId).toBe("proj-2");
    expect(svc.createDraftTimerEntry).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("already running"), "error");
  });
});

describe("useTimer — a stop that rounds to nothing (#188)", () => {
  it("discards the session and its draft row instead of filing 0m", async () => {
    const onStop = vi.fn();
    const { result } = renderHook(() => useTimer(onStop));
    await act(async () => { result.current.start("proj-1", null, "Oops"); });
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));

    vi.setSystemTime(new Date(T0.getTime() + 20_000));
    let returned: TimeEntry | undefined;
    await act(async () => { returned = await result.current.stop(); });

    expect(returned).toBeUndefined();
    expect(onStop).not.toHaveBeenCalled();
    expect(svc.updateTimeEntry).not.toHaveBeenCalled();
    expect(svc.createTimeEntry).not.toHaveBeenCalled();
    expect(svc.deleteTimeEntry).toHaveBeenCalledWith("draft-1");
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("nothing was saved"), "info");
    expect(result.current.timer.isRunning).toBe(false);
    expect(localStorage.getItem(TIMER_STORAGE_KEY)).toBeNull();
  });

  it("still saves a session that rounds up to a minute", async () => {
    vi.mocked(svc.updateTimeEntry).mockResolvedValue({ id: "draft-1" } as TimeEntry);
    const onStop = vi.fn();
    const { result } = renderHook(() => useTimer(onStop));
    await act(async () => { result.current.start("proj-1", null, "Quick"); });
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));

    vi.setSystemTime(new Date(T0.getTime() + 40_000));
    await act(async () => { await result.current.stop(); });

    expect(svc.updateTimeEntry).toHaveBeenCalledWith("draft-1", expect.objectContaining({ durationMinutes: 1 }));
    expect(onStop).toHaveBeenCalled();
  });
});

describe("useTimer — a session that crosses midnight (#185)", () => {
  // Local wall-clock times; the suite runs in America/New_York.
  const SUN_10PM = new Date(2026, 10, 22, 22, 0);
  const MON_MIDNIGHT = new Date(2026, 10, 23, 0, 0).toISOString();
  const MON_2AM = new Date(2026, 10, 23, 2, 0).toISOString();

  it("saves one row per day: the draft up to midnight, a new row after", async () => {
    vi.setSystemTime(SUN_10PM);
    const before = { id: "draft-1", durationMinutes: 120 } as TimeEntry;
    const after = { id: "entry-2", durationMinutes: 120 } as TimeEntry;
    vi.mocked(svc.updateTimeEntry).mockResolvedValue(before);
    vi.mocked(svc.createTimeEntry).mockResolvedValue(after);
    const onStop = vi.fn();
    const { result } = renderHook(() => useTimer(onStop));
    await act(async () => { result.current.start("proj-1", null, "Late one"); });
    await waitFor(() => expect(result.current.timer.draftEntryId).toBe("draft-1"));

    await act(async () => { await result.current.stopAt(MON_2AM); });

    expect(svc.updateTimeEntry).toHaveBeenCalledWith("draft-1", expect.objectContaining({
      endTime: MON_MIDNIGHT, durationMinutes: 120,
    }));
    expect(svc.createTimeEntry).toHaveBeenCalledTimes(1);
    expect(svc.createTimeEntry).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "proj-1", description: "Late one",
      date: "2026-11-23", startTime: MON_MIDNIGHT, endTime: MON_2AM, durationMinutes: 120,
    }));
    expect(onStop).toHaveBeenCalledWith(before, [before, after]);
    expect(result.current.timer.isRunning).toBe(false);
  });

  it("does not write the first day twice when Retry follows a half-saved split", async () => {
    // No draft row, so both halves are creates — and the second one fails.
    vi.setSystemTime(SUN_10PM);
    vi.mocked(svc.createDraftTimerEntry).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(svc.createTimeEntry)
      .mockResolvedValueOnce({ id: "entry-1" } as TimeEntry)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ id: "entry-2" } as TimeEntry);
    vi.mocked(svc.updateTimeEntry).mockResolvedValue({ id: "entry-1" } as TimeEntry);
    const onStop = vi.fn();
    const { result } = renderHook(() => useTimer(onStop));
    await act(async () => { result.current.start("proj-1", null, "Late one"); });

    await act(async () => { await expect(result.current.stopAt(MON_2AM)).rejects.toThrow("offline"); });
    expect(result.current.timer.pendingStopAt).toBe(MON_2AM);

    await act(async () => { await result.current.stopAt(MON_2AM); });

    // The first day's row was updated in place on the retry, not re-created.
    expect(svc.updateTimeEntry).toHaveBeenCalledWith("entry-1", expect.objectContaining({ endTime: MON_MIDNIGHT }));
    const creates = vi.mocked(svc.createTimeEntry).mock.calls.map(([row]) => row.date);
    expect(creates).toEqual(["2026-11-22", "2026-11-23", "2026-11-23"]);
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
