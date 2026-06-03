/**
 * dataverseService.ts
 *
 * Talks to Microsoft Dataverse via the Power Apps Code App connector wrapper
 * (window.PowerApps.Connectors.MicrosoftDataverse). When the app runs outside
 * the Power Apps host (local dev), it falls back to a localStorage-backed mock
 * with identical semantics.
 *
 * Dataverse tables (create in your environment before deploying):
 *   ever_projects        — Project records
 *   ever_tasks           — Task records (lookup → ever_projects)
 *   ever_time_entries    — Time Entry records (lookups → ever_projects, ever_tasks;
 *                          ever_userid, ever_userdisplayname for owner attribution)
 *
 * Time entries are user-scoped: reads filter by ever_userid eq <current user>,
 * writes stamp the current user. The current user comes from userService —
 * make sure initCurrentUser() has resolved before calling these functions.
 *
 * Lookup convention (per the README): writes use `<field>@odata.bind` with the
 * target collection path; reads see lookups as `_<field>_value`. Adjust the
 * mapXxx / xxxToDataverse helpers if your SDK version uses a different form.
 */
import type { Project, Task, TimeEntry } from "../types";
import { getCurrentUser, isPowerAppsHost } from "./userService";

// ---------------------------------------------------------------------------
// Table + field naming
// ---------------------------------------------------------------------------
const TABLES = {
  projects: "ever_projects",
  tasks: "ever_workitems",
  entries: "ever_time_entries",
} as const;

// ---------------------------------------------------------------------------
// Connector accessor
// ---------------------------------------------------------------------------
function dv() {
  const c = typeof window !== "undefined" ? window.PowerApps?.Connectors?.MicrosoftDataverse : undefined;
  if (!c) {
    throw new Error(
      "Power Apps Dataverse connector unavailable. This call should only run inside the Power Apps host."
    );
  }
  return c;
}

function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// Dataverse <-> model mapping
// ---------------------------------------------------------------------------
type Raw = Record<string, unknown>;

function str(r: Raw, key: string): string | undefined {
  const v = r[key];
  return typeof v === "string" ? v : undefined;
}

function num(r: Raw, key: string): number | undefined {
  const v = r[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function bool(r: Raw, key: string, fallback: boolean): boolean {
  const v = r[key];
  return typeof v === "boolean" ? v : fallback;
}

function mapProject(r: Raw): Project {
  return {
    id: (str(r, "ever_projectsid") ?? str(r, "ever_projectid") ?? str(r, "id")) as string,
    name: str(r, "ever_name") ?? "",
    color: str(r, "ever_color") ?? "#6366f1",
    description: str(r, "ever_description"),
    ratio: num(r, "ever_ratio"),
    jiraTicket: str(r, "ever_jiraticket"),
    isActive: num(r, "statecode") === 0,
    createdAt: str(r, "createdon") ?? new Date().toISOString(),
  };
}

function mapTask(r: Raw): Task {
  return {
    id: (str(r, "ever_tasksid") ?? str(r, "ever_taskid") ?? str(r, "id")) as string,
    projectId: (str(r, "_ever_projectid_value") ?? str(r, "ever_projectid")) as string,
    name: str(r, "ever_name") ?? "",
    description: str(r, "ever_description"),
    isActive: num(r, "statecode") === 0,
  };
}

function mapEntry(r: Raw): TimeEntry {
  return {
    id: (str(r, "ever_time_entriesid") ?? str(r, "ever_time_entryid") ?? str(r, "id")) as string,
    projectId: (str(r, "_ever_projectid_value") ?? str(r, "ever_projectid")) as string,
    taskId: str(r, "_ever_taskid_value") ?? str(r, "ever_taskid"),
    description: str(r, "ever_description"),
    startTime: str(r, "ever_starttime") ?? "",
    endTime: str(r, "ever_endtime"),
    durationMinutes: num(r, "ever_durationminutes"),
    ratio: num(r, "ever_ratio"),
    date: str(r, "ever_date") ?? "",
    userId: str(r, "ever_userid") ?? "",
    userDisplayName: str(r, "ever_userdisplayname") ?? "",
  };
}

function projectToDataverse(p: Omit<Project, "id" | "createdAt"> | Partial<Project>): Raw {
  const out: Raw = {};
  if (p.name !== undefined) out.ever_name = p.name;
  if (p.color !== undefined) out.ever_color = p.color;
  if (p.description !== undefined) out.ever_description = p.description ?? null;
  if (p.ratio !== undefined) out.ever_ratio = p.ratio ?? null;
  if (p.jiraTicket !== undefined) out.ever_jiraticket = p.jiraTicket || null;
  return out;
}

function taskToDataverse(t: Omit<Task, "id"> | Partial<Task>): Raw {
  const out: Raw = {};
  if (t.name !== undefined) out.ever_name = t.name;
  if (t.description !== undefined) out.ever_description = t.description ?? null;
  if (t.projectId !== undefined) {
    out["ever_projectid@odata.bind"] = `/${TABLES.projects}(${t.projectId})`;
  }
  return out;
}

function entryToDataverse(e: Omit<TimeEntry, "id"> | Partial<TimeEntry>): Raw {
  const out: Raw = {};
  if (e.description !== undefined) out.ever_description = e.description ?? null;
  if (e.startTime !== undefined) out.ever_starttime = e.startTime;
  if (e.endTime !== undefined) out.ever_endtime = e.endTime ?? null;
  if (e.durationMinutes !== undefined) out.ever_durationminutes = e.durationMinutes ?? null;
  if (e.ratio !== undefined) out.ever_ratio = e.ratio ?? null;
  if (e.date !== undefined) out.ever_date = e.date;
  if (e.userId !== undefined) out.ever_userid = e.userId;
  if (e.userDisplayName !== undefined) out.ever_userdisplayname = e.userDisplayName;
  if (e.projectId !== undefined) {
    out["ever_projectid@odata.bind"] = `/${TABLES.projects}(${e.projectId})`;
  }
  if ("taskId" in e) {
    out["ever_taskid@odata.bind"] = e.taskId ? `/${TABLES.tasks}(${e.taskId})` : null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Local mock store (dev only)
// ---------------------------------------------------------------------------
const STORAGE_KEYS = {
  projects: "tt_projects",
  tasks: "tt_tasks",
  entries: "tt_entries",
} as const;

function load<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]") as T[];
  } catch {
    return [];
  }
}

function persist<T>(key: string, data: T[]): void {
  localStorage.setItem(key, JSON.stringify(data));
}

function uuid(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export async function getProjects(): Promise<Project[]> {
  if (!isPowerAppsHost()) {
    return load<Project>(STORAGE_KEYS.projects)
      .filter((p) => p.isActive)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const result = await dv().listRecords(TABLES.projects, {
    $filter: "statecode eq 0",
    $orderby: "ever_name asc",
  });
  return result.value.map((r) => mapProject(r as Raw));
}

export async function createProject(data: Omit<Project, "id" | "createdAt">): Promise<Project> {
  if (!isPowerAppsHost()) {
    const project: Project = { ...data, id: uuid(), createdAt: new Date().toISOString() };
    const all = load<Project>(STORAGE_KEYS.projects);
    persist(STORAGE_KEYS.projects, [...all, project]);
    return project;
  }
  const created = await dv().createRecord(TABLES.projects, projectToDataverse(data));
  return mapProject(created as Raw);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export async function getTasksForProject(projectId: string): Promise<Task[]> {
  if (!isPowerAppsHost()) {
    return load<Task>(STORAGE_KEYS.tasks).filter((t) => t.projectId === projectId && t.isActive);
  }
  const result = await dv().listRecords(TABLES.tasks, {
    $filter: `statecode eq 0 and _ever_projectid_value eq ${projectId}`,
    $orderby: "ever_name asc",
  });
  return result.value.map((r) => mapTask(r as Raw));
}

export async function getAllTasks(): Promise<Task[]> {
  if (!isPowerAppsHost()) {
    return load<Task>(STORAGE_KEYS.tasks).filter((t) => t.isActive);
  }
  const result = await dv().listRecords(TABLES.tasks, {
    $filter: "statecode eq 0",
    $orderby: "ever_name asc",
  });
  return result.value.map((r) => mapTask(r as Raw));
}

export async function createTask(data: Omit<Task, "id">): Promise<Task> {
  if (!isPowerAppsHost()) {
    const task: Task = { ...data, id: uuid() };
    const all = load<Task>(STORAGE_KEYS.tasks);
    persist(STORAGE_KEYS.tasks, [...all, task]);
    return task;
  }
  const created = await dv().createRecord(TABLES.tasks, taskToDataverse(data));
  return mapTask(created as Raw);
}

// ---------------------------------------------------------------------------
// Time Entries — scoped to the current user
// ---------------------------------------------------------------------------
export async function getTimeEntries(opts: { from?: string; to?: string } = {}): Promise<TimeEntry[]> {
  const user = getCurrentUser();
  if (!isPowerAppsHost()) {
    let entries = load<TimeEntry>(STORAGE_KEYS.entries).filter((e) => e.userId === user.id);
    if (opts.from) entries = entries.filter((e) => e.date >= opts.from!);
    if (opts.to) entries = entries.filter((e) => e.date <= opts.to!);
    return entries.sort((a, b) => b.startTime.localeCompare(a.startTime));
  }
  const filters = [`ever_userid eq '${escapeOData(user.id)}'`];
  if (opts.from) filters.push(`ever_date ge ${opts.from}`);
  if (opts.to) filters.push(`ever_date le ${opts.to}`);
  const result = await dv().listRecords(TABLES.entries, {
    $filter: filters.join(" and "),
    $orderby: "ever_starttime desc",
  });
  return result.value.map((r) => mapEntry(r as Raw));
}

export async function createTimeEntry(data: Omit<TimeEntry, "id">): Promise<TimeEntry> {
  if (!isPowerAppsHost()) {
    const entry: TimeEntry = { ...data, id: uuid() };
    const all = load<TimeEntry>(STORAGE_KEYS.entries);
    persist(STORAGE_KEYS.entries, [...all, entry]);
    return entry;
  }
  const created = await dv().createRecord(TABLES.entries, entryToDataverse(data));
  return mapEntry(created as Raw);
}

export async function updateTimeEntry(id: string, data: Partial<TimeEntry>): Promise<TimeEntry> {
  if (!isPowerAppsHost()) {
    const all = load<TimeEntry>(STORAGE_KEYS.entries);
    const idx = all.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error("Entry not found");
    all[idx] = { ...all[idx], ...data };
    persist(STORAGE_KEYS.entries, all);
    return all[idx];
  }
  const updated = await dv().updateRecord(TABLES.entries, id, entryToDataverse(data));
  return mapEntry(updated as Raw);
}

export async function deleteTimeEntry(id: string): Promise<void> {
  if (!isPowerAppsHost()) {
    const all = load<TimeEntry>(STORAGE_KEYS.entries).filter((e) => e.id !== id);
    persist(STORAGE_KEYS.entries, all);
    return;
  }
  await dv().deleteRecord(TABLES.entries, id);
}
