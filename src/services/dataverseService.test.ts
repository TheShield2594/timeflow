import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task, TimeEntry } from "../types";
import { __setTelemetryTransportForTests } from "./telemetry";

vi.mock("./userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
  isPowerAppsHost: () => false,
}));

// The mapper functions under test never touch the SDK; avoid importing it so these
// tests don't depend on @microsoft/power-apps/data being installed/buildable.
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const {
  mapEntry, mapEntryDate, entryToDataverse, mergeOver, hasForeignUserEntries,
  deactivateTask, reactivateTask, getAllTasks, getTasksForProject,
  deactivateProject, reactivateProject, getProjects, updateTask,
  updateProject, isNotFoundError,
} = await import("./dataverseService");

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

describe("mapEntryDate (#114)", () => {
  beforeEach(() => { __setTelemetryTransportForTests(null); });

  it("passes a bare DateOnly value through untouched", () => {
    expect(mapEntryDate("2024-06-01")).toBe("2024-06-01");
  });

  it("splits every midnight-UTC spelling on the literal date", () => {
    // All four are DateOnly serializations, and the date is the prefix even
    // though the tests run in America/New_York where that instant is the
    // previous evening.
    expect(mapEntryDate("2024-06-01T00:00:00Z")).toBe("2024-06-01");
    expect(mapEntryDate("2024-06-01T00:00:00.0000000Z")).toBe("2024-06-01");
    expect(mapEntryDate("2024-06-01T00:00:00+00:00")).toBe("2024-06-01");
    expect(mapEntryDate("2024-06-01T00:00Z")).toBe("2024-06-01");
  });

  it("reads a non-midnight value as an instant on the local clock, and reports it", () => {
    const events: string[] = [];
    __setTelemetryTransportForTests((e) => { events.push(e.name); });
    // A DateTime (User Local) column: 2024-06-01 22:00Z is still 2024-06-01
    // in America/New_York (18:00 EDT), which the naive split also gets right...
    expect(mapEntryDate("2024-06-01T22:00:00Z")).toBe("2024-06-01");
    // ...but 2024-06-02 01:00Z is 2024-06-01 21:00 EDT, and the split would
    // move the entry a day forward. This is the bug the branch exists for.
    expect(mapEntryDate("2024-06-02T01:00:00Z")).toBe("2024-06-01");
    expect(events).toContain("date_column_not_dateonly");
  });

  it("falls back to the prefix when the timestamp is unparseable", () => {
    expect(mapEntryDate("2024-06-01Tnonsense")).toBe("2024-06-01");
  });
});

describe("mapEntry", () => {
  it("maps a full Dataverse row to a TimeEntry", () => {
    const entry = mapEntry({
      ever_timeentriesid: "entry-1",
      _ever_project_value: "proj-1",
      _ever_workitem_value: "task-1",
      ever_description: "Did stuff",
      ever_starttime: "2024-06-01T09:00:00Z",
      ever_endtime: "2024-06-01T10:00:00Z",
      ever_durationminutes: 60,
      ever_ratio: 1.5,
      ever_jiraticket: "PROJ-123",
      ever_date: "2024-06-01",
      ever_userid: "user-1",
      owninguser: { fullname: "User One" },
    });

    expect(entry).toEqual({
      id: "entry-1",
      projectId: "proj-1",
      taskId: "task-1",
      description: "Did stuff",
      startTime: "2024-06-01T09:00:00Z",
      endTime: "2024-06-01T10:00:00Z",
      durationMinutes: 60,
      ratio: 1.5,
      jiraTicket: "PROJ-123",
      date: "2024-06-01",
      userId: "user-1",
      userDisplayName: "User One",
    });
  });

  it("strips the time component when ever_date is a full ISO timestamp", () => {
    const entry = mapEntry({ ever_date: "2024-06-01T00:00:00Z" });
    expect(entry.date).toBe("2024-06-01");
  });

  it("returns an empty id rather than undefined-typed-as-string (#114)", () => {
    // teamService calls mapEntry directly with no mergeOver guard, so a
    // malformed row must not hand it an id that fails `id.startsWith(...)`.
    expect(mapEntry({}).id).toBe("");
    expect(typeof mapEntry({}).id).toBe("string");
  });

  it("falls back to empty/undefined for missing optional fields", () => {
    const entry = mapEntry({});
    expect(entry.taskId).toBeUndefined();
    expect(entry.description).toBeUndefined();
    expect(entry.jiraTicket).toBeUndefined();
    expect(entry.durationMinutes).toBeUndefined();
    expect(entry.projectId).toBe("");
    expect(entry.startTime).toBe("");
    expect(entry.date).toBe("");
    expect(entry.userDisplayName).toBe("");
  });

  it("falls back through the userDisplayName chain: owninguser -> ownerid -> ownerid_fullname", () => {
    expect(mapEntry({ ownerid: { fullname: "Owner Name" } }).userDisplayName).toBe("Owner Name");
    expect(mapEntry({ ownerid_fullname: "Flat Owner Name" }).userDisplayName).toBe("Flat Owner Name");
    expect(
      mapEntry({
        owninguser: { fullname: "Primary" },
        ownerid: { fullname: "Secondary" },
      }).userDisplayName
    ).toBe("Primary");
  });
});

describe("entryToDataverse", () => {
  it("maps a new entry to Dataverse field names, including @odata.bind for project and task", () => {
    const raw = entryToDataverse({
      projectId: "proj-1",
      taskId: "task-1",
      description: "Did stuff",
      startTime: "2024-06-01T09:00:00Z",
      endTime: "2024-06-01T10:00:00Z",
      durationMinutes: 60,
      ratio: 1.5,
      jiraTicket: "PROJ-123",
      date: "2024-06-01",
    } as Omit<TimeEntry, "id">);

    expect(raw).toMatchObject({
      ever_description: "Did stuff",
      ever_starttime: "2024-06-01T09:00:00Z",
      ever_endtime: "2024-06-01T10:00:00Z",
      ever_durationminutes: 60,
      ever_ratio: 1.5,
      ever_jiraticket: "PROJ-123",
      ever_date: "2024-06-01",
      ever_userid: "user-1",
      "ever_project@odata.bind": "/ever_projectses(proj-1)",
      "ever_workitem@odata.bind": "/ever_workitemses(task-1)",
    });
  });

  it("omits the task @odata.bind key when taskId is not present in the input", () => {
    const raw = entryToDataverse({ projectId: "proj-1" });
    expect(raw).not.toHaveProperty("ever_workitem@odata.bind");
  });

  it("clears the task binding to null when taskId is explicitly present but falsy", () => {
    const raw = entryToDataverse({ projectId: "proj-1", taskId: undefined });
    expect(raw["ever_workitem@odata.bind"]).toBeNull();
  });

  it("converts an empty jiraTicket to null rather than an empty string", () => {
    const raw = entryToDataverse({ jiraTicket: "" });
    expect(raw.ever_jiraticket).toBeNull();
  });

  it("trims the jiraTicket, and treats a whitespace-only one as absent", () => {
    // Every path into this — the timer bar, the entry modal, "Continue" —
    // gets the same normalisation, rather than each remembering to trim.
    expect(entryToDataverse({ jiraTicket: "  PROJ-123  " }).ever_jiraticket).toBe("PROJ-123");
    expect(entryToDataverse({ jiraTicket: "   " }).ever_jiraticket).toBeNull();
  });

  it("always stamps ever_userid from the current user, overriding any caller-supplied value", () => {
    const raw = entryToDataverse({ userId: "someone-else" } as Partial<TimeEntry>);
    expect(raw.ever_userid).toBe("user-1");
  });

  it("round-trips core fields through entryToDataverse -> mapEntry", () => {
    const input: Omit<TimeEntry, "id" | "userId" | "userDisplayName"> = {
      projectId: "proj-1",
      taskId: "task-1",
      description: "Round trip",
      startTime: "2024-06-01T09:00:00Z",
      endTime: "2024-06-01T10:00:00Z",
      durationMinutes: 60,
      ratio: 1.5,
      jiraTicket: "PROJ-123",
      date: "2024-06-01",
    };
    const raw = entryToDataverse(input);
    // Simulate what a Dataverse read would surface for the lookups.
    raw._ever_project_value = "proj-1";
    raw._ever_workitem_value = "task-1";
    const mapped = mapEntry(raw);

    expect(mapped).toMatchObject(input);
  });
});

describe("mergeOver", () => {
  it("prefers mapped values when they are present", () => {
    const result = mergeOver({ name: "old" }, { name: "new" });
    expect(result).toEqual({ name: "new" });
  });

  it("falls back to the input value when the mapped value is empty", () => {
    const result = mergeOver({ name: "kept", description: "kept-desc" }, { name: "", description: undefined as unknown as string });
    expect(result).toEqual({ name: "kept", description: "kept-desc" });
  });

  it("falls back to the input value when the mapped value is null", () => {
    const result = mergeOver({ ratio: 1.5 }, { ratio: null as unknown as number });
    expect(result).toEqual({ ratio: 1.5 });
  });

  it("keeps non-empty falsy-looking values like 0", () => {
    const result = mergeOver({ ratio: 1 }, { ratio: 0 });
    expect(result).toEqual({ ratio: 0 });
  });
});

describe("task soft delete (dev mock path)", () => {
  const seed = (tasks: Task[]) => localStorage.setItem("tt_tasks", JSON.stringify(tasks));

  beforeEach(() => {
    localStorage.clear();
    seed([
      { id: "t1", projectId: "p1", name: "Design", isActive: true },
      { id: "t2", projectId: "p1", name: "Build", isActive: true },
    ]);
  });

  it("deactivateTask flags the task inactive instead of removing the record", async () => {
    await deactivateTask("t1");
    const all = (await getAllTasks()).items;
    expect(all).toHaveLength(2);
    expect(all.find((t) => t.id === "t1")?.isActive).toBe(false);
    expect(all.find((t) => t.id === "t2")?.isActive).toBe(true);
  });

  it("reactivateTask restores the same record (delete-undo flow)", async () => {
    await deactivateTask("t1");
    await reactivateTask("t1");
    const all = (await getAllTasks()).items;
    expect(all.find((t) => t.id === "t1")?.isActive).toBe(true);
  });

  it("getTasksForProject still returns inactive tasks so old entries resolve their names", async () => {
    await deactivateTask("t1");
    const tasks = (await getTasksForProject("p1")).items;
    expect(tasks.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  it("deactivating a missing task is a no-op rather than an error", async () => {
    await expect(deactivateTask("nope")).resolves.toBeUndefined();
    expect((await getAllTasks()).items).toHaveLength(2);
  });

  // Update-only (If-Match) semantics in the host: a missing row 404s instead
  // of being upserted into existence. The mock has to match, or dev never
  // exercises the callers' isNotFoundError branches.
  it("reactivating a missing task 404s, matching the host's update-only semantics", async () => {
    const err = await reactivateTask("nope").catch((e) => e);
    expect(isNotFoundError(err)).toBe(true);
    expect((await getAllTasks()).items).toHaveLength(2);
  });

  it("renaming a missing task 404s rather than creating one", async () => {
    const err = await updateTask("nope", { name: "Ghost" }).catch((e) => e);
    expect(isNotFoundError(err)).toBe(true);
    expect((await getAllTasks()).items).toHaveLength(2);
  });
});

describe("project archive (dev mock path)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("tt_projects", JSON.stringify([
      { id: "p1", name: "Alpha", color: "#719500", isActive: true, createdAt: "2026-01-01" },
      { id: "p2", name: "Beta", color: "#0080BD", isActive: true, createdAt: "2026-01-02" },
    ]));
  });

  it("deactivateProject flags the project inactive instead of removing it", async () => {
    await deactivateProject("p1");
    const all = (await getProjects()).items;
    expect(all).toHaveLength(2);
    expect(all.find((p) => p.id === "p1")?.isActive).toBe(false);
    expect(all.find((p) => p.id === "p2")?.isActive).toBe(true);
  });

  it("reactivateProject restores the same record (archive-undo flow)", async () => {
    await deactivateProject("p1");
    await reactivateProject("p1");
    const all = (await getProjects()).items;
    expect(all.find((p) => p.id === "p1")?.isActive).toBe(true);
  });

  it("getProjects keeps returning archived projects for name/color resolution", async () => {
    await deactivateProject("p1");
    expect((await getProjects()).items.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("updating a missing project 404s rather than creating one", async () => {
    const err = await updateProject("nope", { name: "Ghost" }).catch((e) => e);
    expect(isNotFoundError(err)).toBe(true);
    expect((await getProjects()).items.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });
});

describe("updateTask (dev mock path)", () => {
  it("renames a task in place, preserving its other fields", async () => {
    localStorage.clear();
    localStorage.setItem("tt_tasks", JSON.stringify([
      { id: "t1", projectId: "p1", name: "Old name", isActive: true },
    ]));
    const updated = await updateTask("t1", { name: "New name" });
    expect(updated).toMatchObject({ id: "t1", projectId: "p1", name: "New name", isActive: true });
    const all = (await getAllTasks()).items;
    expect(all[0].name).toBe("New name");
  });
});

describe("hasForeignUserEntries", () => {
  it("returns false when every entry belongs to the current user", () => {
    const entries = [makeEntry({ id: "e1" }), makeEntry({ id: "e2" })];
    expect(hasForeignUserEntries(entries, "user-1")).toBe(false);
  });

  it("returns true when at least one entry belongs to another user", () => {
    const entries = [makeEntry({ id: "e1" }), makeEntry({ id: "e2", userId: "user-2" })];
    expect(hasForeignUserEntries(entries, "user-1")).toBe(true);
  });

  it("returns false for an empty list", () => {
    expect(hasForeignUserEntries([], "user-1")).toBe(false);
  });

  it("ignores entries with no userId rather than treating them as foreign", () => {
    const entries = [makeEntry({ id: "e1", userId: "" })];
    expect(hasForeignUserEntries(entries, "user-1")).toBe(false);
  });

  it("flags an entry as foreign if its stored userId merely drifted across sessions for the same person (known limitation, see comment)", () => {
    const entries = [makeEntry({ id: "e1", userId: "user-1-old-session-id" })];
    expect(hasForeignUserEntries(entries, "user-1")).toBe(true);
  });
});
