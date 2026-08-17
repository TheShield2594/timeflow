import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { useTimeEntries } from "./useTimeEntries";
import * as svc from "../services/dataverseService";
import type { TimeEntry } from "../types";

const toastSpy = vi.fn();
const telemetrySpy = vi.fn();
vi.mock("../contexts/ToastContext", () => ({ useToast: () => toastSpy }));
vi.mock("../services/telemetry", () => ({ reportTelemetry: (e: unknown) => telemetrySpy(e) }));
vi.mock("../services/userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
}));
vi.mock("../services/dataverseService", () => ({
  getTimeEntries: vi.fn(),
  createTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
  hasForeignUserEntries: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(svc.hasForeignUserEntries).mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
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
    const foreign = makeEntry({ id: "e1", userId: "user-2" });
    vi.mocked(svc.getTimeEntries).mockResolvedValue([foreign]);
    vi.mocked(svc.hasForeignUserEntries).mockReturnValue(true);

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(svc.hasForeignUserEntries).toHaveBeenCalledWith([foreign], "user-1");
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("isolation"), "error");
    // The canary has to leave the browser, not just the render — this is the
    // one signal that means the whole company's time data may be visible (#111).
    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "data_isolation_personal",
        severity: "error",
        message: expect.stringContaining("row-level security"),
        props: expect.objectContaining({ foreignRows: 1, rowsReturned: 1 }),
      })
    );

    toastSpy.mockClear();
    await act(async () => { await result.current.refresh(); });
    expect(toastSpy).not.toHaveBeenCalled(); // only warns once per session
  });

  it("does not warn when hasForeignUserEntries reports no foreign entries", async () => {
    const own = makeEntry({ id: "e1", userId: "user-1" });
    vi.mocked(svc.getTimeEntries).mockResolvedValue([own]);
    vi.mocked(svc.hasForeignUserEntries).mockReturnValue(false);

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(svc.hasForeignUserEntries).toHaveBeenCalledWith([own], "user-1");
    expect(toastSpy).not.toHaveBeenCalled();
  });
});

describe("useTimeEntries with a dropped response body (#70)", () => {
  it("keeps the optimistic temp id and re-reads the range when no server id comes back", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue([]);
    // The create succeeded server-side but the connector dropped the body, so
    // the service can only report id: "".
    vi.mocked(svc.createTimeEntry).mockResolvedValue(
      makeEntry({ id: "", description: "Saved but unnamed" })
    );

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const reconciled = makeEntry({ id: "real-7", description: "Saved but unnamed" });
    vi.mocked(svc.getTimeEntries).mockResolvedValue([reconciled]);

    await act(async () => {
      await result.current.createEntry({
        projectId: "proj-1",
        startTime: "2024-06-01T09:00:00Z",
        date: "2024-06-01",
        userId: "user-1",
        userDisplayName: "User One",
      });
    });

    // Never id: "" — an empty id would make a later edit PATCH the collection
    // rather than the row. The refresh reconciles it to the real record.
    await waitFor(() => expect(result.current.entries).toEqual([reconciled]));
  });

  it("refuses to edit or delete an entry whose id is still unknown", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue([]);
    vi.mocked(svc.createTimeEntry).mockResolvedValue(makeEntry({ id: "" }));

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The reconciling re-read fails too, so the row stays pending — this is
    // the window in which the temp-id guards have to hold.
    vi.mocked(svc.getTimeEntries).mockRejectedValue(new Error("still offline"));

    await act(async () => {
      await result.current.createEntry({
        projectId: "proj-1",
        startTime: "2024-06-01T09:00:00Z",
        date: "2024-06-01",
        userId: "user-1",
        userDisplayName: "User One",
      });
    });

    const pendingId = result.current.entries[0].id;
    expect(pendingId).not.toBe("");

    await act(async () => {
      await expect(result.current.editEntry(pendingId, { description: "x" }))
        .rejects.toThrow(/not yet saved/);
      await expect(result.current.deleteEntry(pendingId)).rejects.toThrow(/not yet saved/);
    });

    expect(svc.updateTimeEntry).not.toHaveBeenCalled();
    expect(svc.deleteTimeEntry).not.toHaveBeenCalled();
  });

  it("merges an update over the existing entry instead of replacing it", async () => {
    const existing = makeEntry({ id: "e1", description: "Original", durationMinutes: 60, ratio: 2 });
    vi.mocked(svc.getTimeEntries).mockResolvedValue([existing]);
    // Dropped body on the patch: only the fields we sent come back.
    vi.mocked(svc.updateTimeEntry).mockResolvedValue(
      { id: "e1", description: "Edited" } as TimeEntry
    );

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.editEntry("e1", { description: "Edited" });
    });

    expect(result.current.entries[0]).toMatchObject({
      id: "e1",
      description: "Edited",
      // Untouched by the patch — a wholesale swap would have blanked these.
      durationMinutes: 60,
      ratio: 2,
      date: "2024-06-01",
    });
  });
});
