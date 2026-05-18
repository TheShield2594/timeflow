/**
 * dataverseService.ts
 *
 * Talks to Microsoft Dataverse via the Power Apps Code App connector wrapper
 * (window.PowerApps.Connectors.MicrosoftDataverse). When the app runs outside
 * the Power Apps host (local dev), it falls back to a localStorage-backed mock
 * with identical semantics.
 *
 * Dataverse tables (create in your environment before deploying):
 *   cr_projects        — Project records
 *   cr_tasks           — Task records (lookup → cr_projects)
 *   cr_time_entries    — Time Entry records (lookups → cr_projects, cr_tasks;
 *                        cr_userid, cr_userdisplayname for owner attribution)
 *
 * Time entries are user-scoped: reads filter by cr_userid eq <current user>,
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
  projects: "cr_projects",
  tasks: "cr_tasks",
  entries: "cr_time_entries",
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
    id: (str(r, "cr_projectsid") ?? str(r, "cr_projectid") ?? str(r, "id")) as string,
    name: str(r, "cr_name") ?? "",
    color: str(r, "cr_color") ?? "#6366f1",
    description: str(r, "cr_description"),
    ratio: num(r, "cr_ratio"),
    isActive: bool(r, "cr_isactive", true),
    createdAt: str(r, "createdon") ?? new Date().toISOString(),
  };
}

function mapTask(r: Raw): Task {
  return {
    id: (str(r, "cr_tasksid") ?? str(r, "cr_taskid") ?? str(r, "id")) as string,
    projectId: (str(r, "_cr_projectid_value") ?? str(r, "cr_projectid")) as string,
    name: str(r, "cr_name") ?? "",
    description: str(r, "cr_description"),
    isActive: bool(r, "cr_isactive", true),
  };
}

function mapEntry(r: Raw): TimeEntry {
  return {
    id: (str(r, "cr_time_entriesid") ?? str(r, "cr_time_entryid") ?? str(r, "id")) as string,
    projectId: (str(r, "_cr_projectid_value") ?? str(r, "cr_projectid")) as string,
    taskId: str(r, "_cr_taskid_value") ?? str(r, "cr_taskid"),
    description: str(r, "cr_description"),
    startTime: str(r, "cr_starttime") ?? "",
    endTime: str(r, "cr_endtime"),
    durationMinutes: num(r, "cr_durationminutes"),
    ratio: num(r, "cr_ratio"),
    date: str(r, "cr_date") ?? "",
    userId: str(r, "cr_userid") ?? "",
    userDisplayName: str(r, "cr_userdisplayname") ?? "",
  };
}

function projectToDataverse(p: Omit<Project, "id" | "createdAt"> | Partial<Project>): Raw {
  const out: Raw = {};
  if (p.name !== undefined) out.cr_name = p.name;
  if (p.color !== undefined) out.cr_color = p.color;
  if (p.description !== undefined) out.cr_description = p.description ?? null;
  if (p.ratio !== undefined) out.cr_ratio = p.ratio ?? null;
  if (p.isActive !== undefined) out.cr_isactive = p.isActive;
  return out;
}

function taskToDataverse(t: Omit<Task, "id"> | Partial<Task>): Raw {
  const out: Raw = {};
  if (t.name !== undefined) out.cr_name = t.name;
  if (t.description !== undefined) out.cr_description = t.description ?? null;
  if (t.isActive !== undefined) out.cr_isactive = t.isActive;
  if (t.projectId !== undefined) {
    out["cr_projectid@odata.bind"] = `/${TABLES.projects}(${t.projectId})`;
  }
  return out;
}

function entryToDataverse(e: Omit<TimeEntry, "id"> | Partial<TimeEntry>): Raw {
  const out: Raw = {};
  if (e.description !== undefined) out.cr_description = e.description ?? null;
  if (e.startTime !== undefined) out.cr_starttime = e.startTime;
  if (e.endTime !== undefined) out.cr_endtime = e.endTime ?? null;
  if (e.durationMinutes !== undefined) out.cr_durationminutes = e.durationMinutes ?? null;
  if (e.ratio !== undefined) out.cr_ratio = e.ratio ?? null;
  if (e.date !== undefined) out.cr_date = e.date;
  if (e.userId !== undefined) out.cr_userid = e.userId;
  if (e.userDisplayName !== undefined) out.cr_userdisplayname = e.userDisplayName;
  if (e.projectId !== undefined) {
    out["cr_projectid@odata.bind"] = `/${TABLES.projects}(${e.projectId})`;
  }
  if ("taskId" in e) {
    out["cr_taskid@odata.bind"] = e.taskId ? `/${TABLES.tasks}(${e.taskId})` : null;
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
    $filter: "cr_isactive eq true",
    $orderby: "cr_name asc",
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
    $filter: `cr_isactive eq true and _cr_projectid_value eq ${projectId}`,
    $orderby: "cr_name asc",
  });
  return result.value.map((r) => mapTask(r as Raw));
}

export async function getAllTasks(): Promise<Task[]> {
  if (!isPowerAppsHost()) {
    return load<Task>(STORAGE_KEYS.tasks).filter((t) => t.isActive);
  }
  const result = await dv().listRecords(TABLES.tasks, {
    $filter: "cr_isactive eq true",
    $orderby: "cr_name asc",
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
  const filters = [`cr_userid eq '${escapeOData(user.id)}'`];
  if (opts.from) filters.push(`cr_date ge ${opts.from}`);
  if (opts.to) filters.push(`cr_date le ${opts.to}`);
  const result = await dv().listRecords(TABLES.entries, {
    $filter: filters.join(" and "),
    $orderby: "cr_starttime desc",
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
