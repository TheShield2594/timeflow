/**
 * dataverseService.ts
 *
 * Wraps Power Apps connector calls to Microsoft Dataverse.
 * In a Power Apps Code App, connectors are available via window.__POWER_APPS_CONNECTORS__
 * or imported from the @microsoft/powerapps-component-framework packages.
 *
 * For local development, this service uses localStorage-backed mock data.
 * Replace the mock implementations with real Dataverse connector calls before deploying.
 *
 * Dataverse Table Names (create these in your environment):
 *   - cr_projects       (Project records)
 *   - cr_tasks          (Task records, linked to Project)
 *   - cr_time_entries   (Time Entry records, linked to Project + Task)
 */

import type { Project, Task, TimeEntry } from "../types";

const IS_LOCAL = !("PowerApps" in window);

// ---------------------------------------------------------------------------
// Mock data store (local dev only)
// ---------------------------------------------------------------------------
const STORAGE_KEYS = {
  projects: "tt_projects",
  tasks: "tt_tasks",
  entries: "tt_entries",
};

function load<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]") as T[];
  } catch {
    return [];
  }
}

function save<T>(key: string, data: T[]): void {
  localStorage.setItem(key, JSON.stringify(data));
}

function uuid(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export async function getProjects(): Promise<Project[]> {
  if (IS_LOCAL) {
    return load<Project>(STORAGE_KEYS.projects).filter((p) => p.isActive);
  }
  // TODO: Replace with real Dataverse call
  // const connector = window.PowerApps.Connectors.MicrosoftDataverse;
  // const result = await connector.listRecords("cr_projects", { $filter: "cr_isactive eq true" });
  // return result.value.map(mapProject);
  return [];
}

export async function createProject(data: Omit<Project, "id" | "createdAt">): Promise<Project> {
  if (IS_LOCAL) {
    const project: Project = { ...data, id: uuid(), createdAt: new Date().toISOString() };
    const all = load<Project>(STORAGE_KEYS.projects);
    save(STORAGE_KEYS.projects, [...all, project]);
    return project;
  }
  // TODO: Dataverse create record
  throw new Error("Not implemented");
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export async function getTasksForProject(projectId: string): Promise<Task[]> {
  if (IS_LOCAL) {
    return load<Task>(STORAGE_KEYS.tasks).filter((t) => t.projectId === projectId && t.isActive);
  }
  // TODO: Dataverse list with filter
  return [];
}

export async function getAllTasks(): Promise<Task[]> {
  if (IS_LOCAL) {
    return load<Task>(STORAGE_KEYS.tasks).filter((t) => t.isActive);
  }
  return [];
}

export async function createTask(data: Omit<Task, "id">): Promise<Task> {
  if (IS_LOCAL) {
    const task: Task = { ...data, id: uuid() };
    const all = load<Task>(STORAGE_KEYS.tasks);
    save(STORAGE_KEYS.tasks, [...all, task]);
    return task;
  }
  throw new Error("Not implemented");
}

// ---------------------------------------------------------------------------
// Time Entries
// ---------------------------------------------------------------------------
export async function getTimeEntries(opts: { from?: string; to?: string } = {}): Promise<TimeEntry[]> {
  if (IS_LOCAL) {
    let entries = load<TimeEntry>(STORAGE_KEYS.entries);
    if (opts.from) entries = entries.filter((e) => e.date >= opts.from!);
    if (opts.to) entries = entries.filter((e) => e.date <= opts.to!);
    return entries.sort((a, b) => b.startTime.localeCompare(a.startTime));
  }
  return [];
}

export async function createTimeEntry(data: Omit<TimeEntry, "id">): Promise<TimeEntry> {
  if (IS_LOCAL) {
    const entry: TimeEntry = { ...data, id: uuid() };
    const all = load<TimeEntry>(STORAGE_KEYS.entries);
    save(STORAGE_KEYS.entries, [...all, entry]);
    return entry;
  }
  throw new Error("Not implemented");
}

export async function updateTimeEntry(id: string, data: Partial<TimeEntry>): Promise<TimeEntry> {
  if (IS_LOCAL) {
    const all = load<TimeEntry>(STORAGE_KEYS.entries);
    const idx = all.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error("Entry not found");
    all[idx] = { ...all[idx], ...data };
    save(STORAGE_KEYS.entries, all);
    return all[idx];
  }
  throw new Error("Not implemented");
}

export async function deleteTimeEntry(id: string): Promise<void> {
  if (IS_LOCAL) {
    const all = load<TimeEntry>(STORAGE_KEYS.entries).filter((e) => e.id !== id);
    save(STORAGE_KEYS.entries, all);
    return;
  }
  throw new Error("Not implemented");
}

