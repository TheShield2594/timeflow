import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { useTimer } from "./useTimer";
import * as svc from "../services/dataverseService";
import type { TimeEntry } from "../types";

const toastSpy = vi.fn();
vi.mock("../contexts/ToastContext", () => ({ useToast: () => toastSpy }));
vi.mock("../services/userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One" }),
}));
vi.mock("../services/dataverseService", () => ({
  getOpenTimerEntry: vi.fn().mockResolvedValue(null),
  createDraftTimerEntry: vi.fn().mockResolvedValue("draft-1"),
  createTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
}));

const TIMER_STORAGE_KEY = "tt_active_timer:user-1";

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

    act(() => {
      result.current.cancel();
    });

    expect(result.current.timer.isRunning).toBe(false);
    expect(localStorage.getItem(TIMER_STORAGE_KEY)).toBeNull();
    expect(onStop).not.toHaveBeenCalled();
  });
});
