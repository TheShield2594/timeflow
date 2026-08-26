/**
 * The Team-path isolation assertion (#91). `hasForeignUserEntries()` guarded
 * the personal read path; the Team read had no equivalent check at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import { findUnexpectedOwners, hasNoReportRows, useTeamEntries } from "./useTeam";
import * as team from "../services/teamService";
import type { TeamContext, TeamEntry } from "../services/teamService";

/** The paged reads return `{ items, truncated }`; nothing here is truncated. */
const paged = <T,>(items: T[]) => ({ items, truncated: null });

const telemetrySpy = vi.fn();
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
  getCurrentUser: () => ({ id: "user-1", email: "u@example.com", displayName: "User One", environmentId: "env-1" }),
}));
vi.mock("../services/teamService", () => ({ getTeamTimeEntries: vi.fn() }));



const CONTEXT: TeamContext = {
  myUserId: "me",
  reports: [{ id: "report-a", name: "Avery" }, { id: "report-b", name: "Jordan" }],
};

function entry(ownerId: string, id = ownerId): TeamEntry {
  return {
    id: `entry-${id}`,
    projectId: "proj-1",
    startTime: "2026-06-01T09:00:00Z",
    endTime: "2026-06-01T17:00:00Z",
    durationMinutes: 480,
    date: "2026-06-01",
    userId: ownerId,
    userDisplayName: ownerId,
    ownerId,
    ownerName: ownerId,
  };
}

afterEach(() => {
  cleanup();
  telemetrySpy.mockClear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("findUnexpectedOwners", () => {
  it("accepts the caller's own rows and their direct reports'", () => {
    const entries = [entry("me"), entry("report-a"), entry("report-b")];

    expect(findUnexpectedOwners(entries, CONTEXT)).toEqual([]);
  });

  it("flags an owner who is neither, and reports each id once", () => {
    const entries = [entry("report-a"), entry("stranger", "1"), entry("stranger", "2")];

    expect(findUnexpectedOwners(entries, CONTEXT)).toEqual(["stranger"]);
  });

  it("ignores rows whose owner id didn't resolve", () => {
    expect(findUnexpectedOwners([entry("")], CONTEXT)).toEqual([]);
  });

  // Without a resolved id for the caller, their own rows would read as foreign.
  it("still flags strangers when myUserId is unresolved", () => {
    const ctx: TeamContext = { myUserId: null, reports: CONTEXT.reports };

    expect(findUnexpectedOwners([entry("report-a"), entry("stranger")], ctx)).toEqual(["stranger"]);
  });
});

describe("hasNoReportRows", () => {
  const TODAY = "2026-06-10";

  it("is true when a started week came back with the caller's rows and nothing else", () => {
    expect(hasNoReportRows([entry("me")], CONTEXT, "2026-06-01", TODAY)).toBe(true);
    expect(hasNoReportRows([], CONTEXT, "2026-06-01", TODAY)).toBe(true);
  });

  it("is false as soon as one report's row comes back", () => {
    expect(hasNoReportRows([entry("me"), entry("report-a")], CONTEXT, "2026-06-01", TODAY)).toBe(false);
  });

  // Indirect reports own rows too, and they are exactly the proof that the
  // hierarchy read is working.
  it("counts a row from outside the direct reports as rows coming back", () => {
    expect(hasNoReportRows([entry("indirect-report")], CONTEXT, "2026-06-01", TODAY)).toBe(false);
  });

  it("says nothing about a week that hasn't started", () => {
    expect(hasNoReportRows([], CONTEXT, "2026-06-15", TODAY)).toBe(false);
  });

  it("says nothing when the caller has no reports to be missing", () => {
    expect(hasNoReportRows([], { myUserId: "me", reports: [] }, "2026-06-01", TODAY)).toBe(false);
  });
});

describe("useTeamEntries isolation assertion", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("reports unexpected owners once per session, without blocking the load", async () => {
    const data = [entry("report-a"), entry("stranger")];
    vi.mocked(team.getTeamTimeEntries).mockResolvedValue(paged(data));

    const { result, rerender } = renderHook(
      ({ from }: { from: string }) => useTeamEntries(from, "2026-06-07", CONTEXT),
      { initialProps: { from: "2026-06-01" } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Logged, not blocked: the rows the server said we may see are still shown.
    expect(result.current.entries).toEqual(data);
    expect(result.current.error).toBeNull();
    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "data_isolation_team",
        // Deliberately not "error": indirect reports trip this legitimately.
        severity: "warning",
        props: expect.objectContaining({
          unexpectedOwners: 1,
          directReports: 2,
          rowsReturned: 2,
          unexpectedRows: 1,
        }),
      })
    );

    telemetrySpy.mockClear();
    rerender({ from: "2026-06-08" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(telemetrySpy).not.toHaveBeenCalled();
  });

  it("stays quiet when every row belongs to the caller or a direct report", async () => {
    vi.mocked(team.getTeamTimeEntries).mockResolvedValue(paged([entry("me"), entry("report-b")]));

    const { result } = renderHook(() => useTeamEntries("2026-06-01", "2026-06-07", CONTEXT));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(telemetrySpy).not.toHaveBeenCalled();
  });

  // Before the probe resolves, every owner would look unexpected — including
  // the caller's own rows.
  it("does not assert anything before the team context resolves", async () => {
    vi.mocked(team.getTeamTimeEntries).mockResolvedValue(paged([entry("stranger")]));

    const { result } = renderHook(() => useTeamEntries("2026-06-01", "2026-06-07", null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(telemetrySpy).not.toHaveBeenCalled();
  });

  it("reports a week with names but no rows once per session", async () => {
    // The Manager field resolved two reports; the hierarchy read returned only
    // the caller's own row. That pairing is the misconfiguration in §5.6, and
    // the person who can fix it isn't the one looking at the page.
    vi.mocked(team.getTeamTimeEntries).mockResolvedValue(paged([entry("me")]));

    const { result, rerender } = renderHook(
      ({ from }: { from: string }) => useTeamEntries(from, "2026-06-07", CONTEXT),
      { initialProps: { from: "2026-06-01" } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "team_no_report_rows",
        // An idle team trips this too — it is a hint, not a verdict.
        severity: "warning",
        props: expect.objectContaining({ directReports: 2, rowsReturned: 1 }),
      })
    );

    telemetrySpy.mockClear();
    rerender({ from: "2026-06-08" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(telemetrySpy).not.toHaveBeenCalled();
  });

  it("stays quiet about missing rows once a report's row comes back", async () => {
    vi.mocked(team.getTeamTimeEntries).mockResolvedValue(paged([entry("report-a")]));

    const { result } = renderHook(() => useTeamEntries("2026-06-01", "2026-06-07", CONTEXT));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(telemetrySpy).not.toHaveBeenCalled();
  });

  it("surfaces a failed load as an error and keeps no stale rows", async () => {
    vi.mocked(team.getTeamTimeEntries).mockRejectedValue(new Error("hierarchy read failed"));

    const { result } = renderHook(() => useTeamEntries("2026-06-01", "2026-06-07", CONTEXT));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.entries).toEqual([]);
    expect(result.current.error).toBe("hierarchy read failed");
    expect(telemetrySpy).not.toHaveBeenCalled();
  });
});
