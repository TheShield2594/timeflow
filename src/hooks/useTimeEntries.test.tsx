import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { useTimeEntries } from "./useTimeEntries";
import * as svc from "../services/dataverseService";
import type { TimeEntry } from "../types";

const toastSpy = vi.fn();
vi.mock("../contexts/ToastContext", () => ({ useToast: () => toastSpy }));
vi.mock("../services/userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One" }),
}));
vi.mock("../services/dataverseService", () => ({
  getTimeEntries: vi.fn(),
  createTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
  hasForeignUserEntries: (entries: TimeEntry[], currentUserId: string) =>
    entries.some((e) => e.userId && e.userId !== currentUserId),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "e1",
    projectId: "proj-1",
    startTime: "2024-06-01T09:00:00Z",
    date: "2024-06-01",
    userId: "user-1",
    userDisplayName: "User One",
    ...overrides,
  };
}

describe("useTimeEntries", () => {
  it("loads entries on mount", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue([makeEntry()]);

    const { result } = renderHook(() => useTimeEntries());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([makeEntry()]);
  });

  it("shows the new entry optimistically, then replaces it with the server record", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue([]);
    const real = makeEntry({ id: "real-1" });
    let resolveCreate!: (e: TimeEntry) => void;
    vi.mocked(svc.createTimeEntry).mockImplementation(
      () => new Promise((res) => { resolveCreate = res; })
    );

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let createPromise!: Promise<TimeEntry>;
    act(() => {
      createPromise = result.current.createEntry({
        projectId: "proj-1",
        startTime: "2024-06-01T09:00:00Z",
        date: "2024-06-01",
        userId: "user-1",
        userDisplayName: "User One",
      });
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].id).not.toBe("real-1");

    await act(async () => {
      resolveCreate(real);
      await createPromise;
    });

    expect(result.current.entries).toEqual([real]);
  });

  it("rolls back the optimistic entry and toasts on create failure", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue([]);
    vi.mocked(svc.createTimeEntry).mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(
        result.current.createEntry({
          projectId: "proj-1",
          startTime: "2024-06-01T09:00:00Z",
          date: "2024-06-01",
          userId: "user-1",
          userDisplayName: "User One",
        })
      ).rejects.toThrow("network down");
    });

    expect(result.current.entries).toEqual([]);
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("network down"), "error");
  });

  it("restores a deleted entry at its original position on delete failure", async () => {
    const first = makeEntry({ id: "e1" });
    const second = makeEntry({ id: "e2" });
    vi.mocked(svc.getTimeEntries).mockResolvedValue([first, second]);
    vi.mocked(svc.deleteTimeEntry).mockRejectedValue(new Error("delete failed"));

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.deleteEntry("e1")).rejects.toThrow("delete failed");
    });

    expect(result.current.entries).toEqual([first, second]);
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("delete failed"), "error");
  });

  it("warns once when the server returns another user's entries (row security misconfigured)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const foreign = makeEntry({ id: "e1", userId: "user-2" });
    vi.mocked(svc.getTimeEntries).mockResolvedValue([foreign]);

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("isolation"), "error");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("row-level security"));

    toastSpy.mockClear();
    await act(async () => { await result.current.refresh(); });
    expect(toastSpy).not.toHaveBeenCalled(); // only warns once per session

    errorSpy.mockRestore();
  });

  it("does not warn when all returned entries belong to the current user", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue([makeEntry({ id: "e1", userId: "user-1" })]);

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(toastSpy).not.toHaveBeenCalled();
  });
});
