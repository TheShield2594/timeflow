import { describe, it, expect, vi } from "vitest";
import type { TimeEntry } from "../types";

vi.mock("./userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One" }),
  isPowerAppsHost: () => false,
}));

// The mapper functions under test never touch the SDK; avoid importing it so these
// tests don't depend on @microsoft/power-apps/data being installed/buildable.
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const { mapEntry, entryToDataverse, mergeOver, hasForeignUserEntries } = await import("./dataverseService");

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
});
