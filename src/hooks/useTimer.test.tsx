import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { useTimer } from "./useTimer";
import * as svc from "../services/dataverseService";
import type { TimeEntry } from "../types";

const toastSpy = vi.fn();
vi.mock("../contexts/ToastContext", () => ({ useToast: () => toastSpy }));
vi.mock("../services/userService", () => ({
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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
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
      await result.current.stop();
    });

    expect(result.current.timer.isRunning).toBe(false);
    expect(localStorage.getItem(TIMER_STORAGE_KEY)).toBeNull();
    expect(onStop).toHaveBeenCalledWith(savedEntry);
    expect(svc.updateTimeEntry).toHaveBeenCalledWith(
      "draft-1",
      expect.objectContaining({ description: "Working" })
    );
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
      await expect(result.current.stop()).rejects.toThrow("offline");
    });

    expect(onStop).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("retry"), "error");
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

    let discarded: boolean | undefined;
    await act(async () => {
      discarded = await result.current.cancel();
    });

    expect(discarded).toBe(true);
    expect(result.current.timer.isRunning).toBe(false);
    expect(localStorage.getItem(TIMER_STORAGE_KEY)).toBeNull();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("cancel reports false when there is no session to discard", async () => {
    const { result } = renderHook(() => useTimer(vi.fn()));

    let discarded: boolean | undefined;
    await act(async () => {
      discarded = await result.current.cancel();
    });

    expect(discarded).toBe(false);
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
      await result.current.stop();
    });

    expect(svc.createTimeEntry).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", description: "Working" })
    );
    expect(onStop).toHaveBeenCalledWith(savedEntry);
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
      await result.current.stop();
    });
    expect(svc.createTimeEntry).toHaveBeenCalled();

    await act(async () => {
      resolveDraft("draft-late");
    });

    await waitFor(() => expect(svc.deleteTimeEntry).toHaveBeenCalledWith("draft-late"));
    expect(result.current.timer.draftEntryId).toBeUndefined();
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
