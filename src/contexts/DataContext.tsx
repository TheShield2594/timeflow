import React, { createContext, useContext, useMemo } from "react";
import type { NewTimeEntry, Project, Task, TimeEntry } from "../types";
import { useProjects } from "../hooks/useProjects";
import { useTasks } from "../hooks/useTasks";
import { useTimeEntries } from "../hooks/useTimeEntries";
import { useUndoableMutations } from "../hooks/useUndoableMutations";
import { useDataRange } from "./DataRangeContext";

/**
 * Entries, projects, tasks, and the mutations over them — the app's data
 * layer, as the pages see it.
 *
 * This is the third context alongside toasts and the data range, and it
 * exists because the pass-through was the app's dominant coupling: PageRouter
 * took 19 props, every one of them forwarded verbatim from AppContent, so
 * adding a field to any page meant editing three files that don't care about
 * it (#115).
 *
 * It sits *above* AppContent deliberately. AppContent owns the page selection
 * and the timer, and neither should be able to re-render the data layer; with
 * the provider above it, a page change or a timer tick can't reach the
 * memoized value below.
 *
 * The undo-wrapped mutators are the ones exposed, not the raw ones. A page
 * that deletes an entry should get the undo toast — the raw delete exists so
 * the wrapper can call it, not so a caller can choose to skip the safety net.
 */
export interface DataApi {
  entries: TimeEntry[];
  projects: Project[];
  tasks: Task[];
  /** First load only — pages show a skeleton. */
  loading: boolean;
  /** Any load, including a range widening. */
  rangeLoading: boolean;
  /** A read came back holding another user's rows: Dataverse row-level
   *  security is misconfigured. Sticky for the session, and the shell raises
   *  a persistent alarm on it. */
  isolationBreach: boolean;

  createEntry: (data: NewTimeEntry) => Promise<TimeEntry>;
  editEntry: (id: string, data: Partial<TimeEntry>) => Promise<TimeEntry>;
  /** Deletes, then offers Undo. See useUndoableMutations. */
  deleteEntry: (id: string) => Promise<void>;
  /** Re-read the current range from the server. */
  refreshEntries: () => Promise<void>;

  addProject: (data: Omit<Project, "id" | "createdAt">) => Promise<Project>;
  editProject: (id: string, data: Partial<Project>) => Promise<Project>;
  /** Deactivates, then offers Undo. */
  archiveProject: (project: Project) => Promise<void>;
  restoreProject: (project: Project) => Promise<void>;

  addTask: (data: Omit<Task, "id">) => Promise<Task>;
  /** Deactivates, then offers Undo. */
  deleteTask: (task: Task) => Promise<void>;
  renameTask: (task: Task, newName: string) => Promise<void>;
  loadTasksForProject: (projectId: string) => void;
}

const DataCtx = createContext<DataApi | null>(null);

/**
 * The provider that just supplies a value.
 *
 * DataProvider below builds that value out of the real hooks; this is the
 * seam a test uses to render a page against a fixed data layer without
 * standing up Dataverse, localStorage and four hooks to do it.
 */
export const DataApiProvider: React.FC<{ value: DataApi; children: React.ReactNode }> = ({ value, children }) => (
  <DataCtx.Provider value={value}>{children}</DataCtx.Provider>
);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { from, to } = useDataRange();

  const { projects, addProject, editProject, archiveProject, restoreProject } = useProjects();
  const { tasks, addTask, deleteTask, restoreTask, renameTask, loadTasksForProject } = useTasks();
  const {
    entries, loading, isFetching, isolationBreach, deleteEntry, editEntry, createEntry, refresh,
  } = useTimeEntries(from, to);

  const undoable = useUndoableMutations({
    entries, deleteEntry, createEntry, deleteTask, restoreTask, archiveProject, restoreProject,
  });

  const value = useMemo<DataApi>(() => ({
    entries, projects, tasks,
    loading,
    // `loading` already covers the first paint; this is the *subsequent*
    // fetch, which pages show without unmounting their content.
    rangeLoading: isFetching && !loading,
    isolationBreach,
    createEntry, editEntry, deleteEntry: undoable.deleteEntry, refreshEntries: refresh,
    addProject, editProject, archiveProject: undoable.archiveProject, restoreProject,
    addTask, deleteTask: undoable.deleteTask, renameTask, loadTasksForProject,
  }), [
    entries, projects, tasks, loading, isFetching, isolationBreach,
    createEntry, editEntry, refresh, undoable,
    addProject, editProject, restoreProject,
    addTask, renameTask, loadTasksForProject,
  ]);

  return <DataApiProvider value={value}>{children}</DataApiProvider>;
};

export function useData(): DataApi {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error("useData must be used inside DataProvider");
  return ctx;
}
