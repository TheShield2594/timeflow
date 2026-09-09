import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { useTimeEntries, uncoveredSpans } from "./useTimeEntries";
import * as svc from "../services/dataverseService";
import type { TimeEntry } from "../types";

/** The paged reads return `{ items, truncated }`; nothing here is truncated. */
const paged = <T,>(items: T[]) => ({ items, truncated: null });

const toastSpy = vi.fn();
const telemetrySpy = vi.fn();
vi.mock("../contexts/ToastContext", () => ({ useToast: () => toastSpy }));
vi.mock("../services/telemetry", () => ({ reportTelemetry: (e: unknown) => telemetrySpy(e) }));
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
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([makeEntry()]));

    const { result } = renderHook(() => useTimeEntries());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([makeEntry()]);
  });

  it("shows the new entry optimistically, then replaces it with the server record", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([]));
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

  it("stamps ownership on the optimistic row so callers never pass it (#115)", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([]));
    let resolveCreate!: (e: TimeEntry) => void;
    vi.mocked(svc.createTimeEntry).mockReturnValue(new Promise((res) => { resolveCreate = res; }));

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      // NewTimeEntry — no userId, no userDisplayName. Components used to
      // supply both by calling getCurrentUser() themselves, and the service
      // overwrote them anyway.
      void result.current.createEntry({
        projectId: "proj-1",
        startTime: "2024-06-01T09:00:00Z",
        date: "2024-06-01",
      });
    });

    // The optimistic row still renders as the user's own, before any reply.
    expect(result.current.entries[0]).toMatchObject({
      userId: "user-1",
      userDisplayName: "User One",
    });
    // The service received exactly what the caller passed — no ownership.
    expect(svc.createTimeEntry).toHaveBeenCalledWith({
      projectId: "proj-1",
      startTime: "2024-06-01T09:00:00Z",
      date: "2024-06-01",
    });

    await act(async () => {
      resolveCreate({ id: "real-1", projectId: "proj-1", startTime: "2024-06-01T09:00:00Z", date: "2024-06-01", userId: "user-1", userDisplayName: "User One" });
    });
  });

  it("rolls back the optimistic entry and toasts on create failure", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([]));
    vi.mocked(svc.createTimeEntry).mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(
        result.current.createEntry({
          projectId: "proj-1",
          startTime: "2024-06-01T09:00:00Z",
          date: "2024-06-01",
        })
      ).rejects.toThrow("network down");
    });

    expect(result.current.entries).toEqual([]);
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("network down"), "error");
  });

  it("restores a deleted entry at its original position on delete failure", async () => {
    const first = makeEntry({ id: "e1" });
    const second = makeEntry({ id: "e2" });
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([first, second]));
    vi.mocked(svc.deleteTimeEntry).mockRejectedValue(new Error("delete failed"));

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.deleteEntry("e1")).rejects.toThrow("delete failed");
    });

    expect(result.current.entries).toEqual([first, second]);
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("delete failed"), "error");
  });

  it("raises a sticky alarm when the server returns another user's entries (row security misconfigured)", async () => {
    const foreign = makeEntry({ id: "e1", userId: "user-2" });
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([foreign]));
    vi.mocked(svc.hasForeignUserEntries).mockReturnValue(true);

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(svc.hasForeignUserEntries).toHaveBeenCalledWith([foreign], "user-1");
    // Not a toast: this is the one signal in the app that means nothing on any
    // screen can be trusted, and the old version told the one person who could
    // not act on it and then vanished. It's a flag the shell raises a
    // persistent banner from, and it never clears for the session.
    expect(toastSpy).not.toHaveBeenCalled();
    expect(result.current.isolationBreach).toBe(true);
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

    // The telemetry is de-duplicated per session — it reports a configuration,
    // not a per-read event — but the flag stays up.
    telemetrySpy.mockClear();
    await act(async () => { await result.current.refresh(); });
    expect(telemetrySpy).not.toHaveBeenCalled();
    expect(result.current.isolationBreach).toBe(true);
  });

  it("does not warn when hasForeignUserEntries reports no foreign entries", async () => {
    const own = makeEntry({ id: "e1", userId: "user-1" });
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([own]));
    vi.mocked(svc.hasForeignUserEntries).mockReturnValue(false);

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(svc.hasForeignUserEntries).toHaveBeenCalledWith([own], "user-1");
    expect(toastSpy).not.toHaveBeenCalled();
    expect(result.current.isolationBreach).toBe(false);
  });
});

describe("useTimeEntries with a dropped response body (#70)", () => {
  it("keeps the optimistic temp id and re-reads the range when no server id comes back", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([]));
    // The create succeeded server-side but the connector dropped the body, so
    // the service can only report id: "".
    vi.mocked(svc.createTimeEntry).mockResolvedValue(
      makeEntry({ id: "", description: "Saved but unnamed" })
    );

    const { result } = renderHook(() => useTimeEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const reconciled = makeEntry({ id: "real-7", description: "Saved but unnamed" });
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([reconciled]));

    await act(async () => {
      await result.current.createEntry({
        projectId: "proj-1",
        startTime: "2024-06-01T09:00:00Z",
        date: "2024-06-01",
      });
    });

    // Never id: "" — an empty id would make a later edit PATCH the collection
    // rather than the row. The refresh reconciles it to the real record.
    await waitFor(() => expect(result.current.entries).toEqual([reconciled]));
  });

  it("refuses to edit or delete an entry whose id is still unknown", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([]));
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
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([existing]));
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

describe("uncoveredSpans (#115)", () => {
  it("asks for everything when nothing is held yet", () => {
    expect(uncoveredSpans(null, { from: "2026-01-01", to: "2026-03-31" }))
      .toEqual([{ from: "2026-01-01", to: "2026-03-31" }]);
  });

  it("asks for nothing when the wanted range is already inside the held one", () => {
    // Reports: "All time" then back to "Last 7 days". The old code re-read
    // the whole 7-day window from the server; there is nothing to read.
    const covered = { from: "1970-01-01", to: "9999-12-31" };
    expect(uncoveredSpans(covered, { from: "2026-03-01", to: "2026-03-07" })).toEqual([]);
    expect(uncoveredSpans(covered, covered)).toEqual([]);
  });

  it("asks only for the newly-uncovered side when the range widens", () => {
    const covered = { from: "2026-03-01", to: "2026-03-31" };
    // Widening backwards: the day before the held span, backwards.
    expect(uncoveredSpans(covered, { from: "2026-01-01", to: "2026-03-31" }))
      .toEqual([{ from: "2026-01-01", to: "2026-02-28" }]);
    // Widening forwards.
    expect(uncoveredSpans(covered, { from: "2026-03-01", to: "2026-04-30" }))
      .toEqual([{ from: "2026-04-01", to: "2026-04-30" }]);
    // Both, as two reads rather than one that re-reads March.
    expect(uncoveredSpans(covered, { from: "2026-02-01", to: "2026-04-30" }))
      .toEqual([
        { from: "2026-02-01", to: "2026-02-28" },
        { from: "2026-04-01", to: "2026-04-30" },
      ]);
  });

  it("re-reads the whole range when the two spans don't touch", () => {
    // Stitching disjoint spans would leave `entries` claiming a range with a
    // hole in the middle, and every later read would skip that hole.
    expect(uncoveredSpans({ from: "2026-03-01", to: "2026-03-31" }, { from: "2026-06-01", to: "2026-06-30" }))
      .toEqual([{ from: "2026-06-01", to: "2026-06-30" }]);
  });
});

describe("useTimeEntries range widening (#115)", () => {
  const inRange = (date: string, id: string): TimeEntry => ({
    id, projectId: "proj-1", startTime: `${date}T09:00:00Z`, date,
    userId: "user-1", userDisplayName: "User One",
  });

  it("reads only the uncovered span when the range widens, and keeps what it had", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([inRange("2026-03-15", "march")]));

    const { result, rerender } = renderHook(
      ({ from, to }) => useTimeEntries(from, to),
      { initialProps: { from: "2026-03-01", to: "2026-03-31" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(svc.getTimeEntries).toHaveBeenCalledWith({ from: "2026-03-01", to: "2026-03-31" });

    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([inRange("2026-01-15", "january")]));
    rerender({ from: "2026-01-01", to: "2026-03-31" });

    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    // Only the new span — not the whole widened window.
    expect(svc.getTimeEntries).toHaveBeenLastCalledWith({ from: "2026-01-01", to: "2026-02-28" });
    expect(result.current.entries.map((e) => e.id).sort()).toEqual(["january", "march"]);
  });

  it("issues no request at all when the range narrows back inside what's held", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([inRange("2026-03-15", "march")]));

    const { result, rerender } = renderHook(
      ({ from, to }) => useTimeEntries(from, to),
      { initialProps: { from: "2026-01-01", to: "2026-12-31" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(svc.getTimeEntries).toHaveBeenCalledTimes(1);

    rerender({ from: "2026-03-01", to: "2026-03-07" });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(svc.getTimeEntries).toHaveBeenCalledTimes(1);
    expect(result.current.entries).toHaveLength(1);
  });

  it("forgets its coverage after a truncated read, so the missing rows can still arrive", async () => {
    vi.mocked(svc.getTimeEntries).mockResolvedValue({
      items: [inRange("2026-03-15", "march")],
      truncated: { reason: "max_pages", entitySet: "ever_timeentrieses", rowsLoaded: 1, message: "Some entries may not be shown" },
    });

    const { result, rerender } = renderHook(
      ({ from, to }) => useTimeEntries(from, to),
      { initialProps: { from: "2026-01-01", to: "2026-12-31" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(toastSpy).toHaveBeenCalledWith("Some entries may not be shown", "error");

    // A short read leaves holes; treating that span as covered would make the
    // missing rows permanently missing for the session.
    vi.mocked(svc.getTimeEntries).mockResolvedValue(paged([inRange("2026-03-15", "march")]));
    rerender({ from: "2026-03-01", to: "2026-03-07" });

    await waitFor(() => expect(svc.getTimeEntries).toHaveBeenCalledTimes(2));
  });
});
