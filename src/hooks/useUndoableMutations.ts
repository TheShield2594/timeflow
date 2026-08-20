import { useCallback } from "react";
import type { Project, Task, TimeEntry } from "../types";
import { useToast } from "../contexts/ToastContext";

interface Deps {
  entries: TimeEntry[];
  deleteEntry: (id: string) => Promise<void>;
  createEntry: (data: Omit<TimeEntry, "id" | "userId" | "userDisplayName">) => Promise<TimeEntry>;
  deleteTask: (task: Task) => Promise<void>;
  restoreTask: (task: Task) => Promise<void>;
  archiveProject: (project: Project) => Promise<void>;
  restoreProject: (project: Project) => Promise<void>;
}

export interface UndoableMutations {
  deleteEntry: (id: string) => Promise<void>;
  deleteTask: (task: Task) => Promise<void>;
  archiveProject: (project: Project) => Promise<void>;
}

/**
 * The three destructive actions, each wrapped in the toast that can take it
 * back (#115).
 *
 * They belong together because they share one rule that isn't obvious from
 * any of them alone: the undo offer only appears once the destructive call
 * has *succeeded*. A failed delete already toasted its own error inside the
 * data hook, and offering to undo something that didn't happen would be a lie
 * the user then acts on.
 *
 * The three differ in what "undo" means, and that difference is load-bearing:
 * a deleted entry is genuinely gone (time entries are the only hard delete in
 * the app), so undo re-creates it from a snapshot taken before the delete; a
 * deleted task and an archived project were only deactivated, so undo
 * reactivates the very same record and every historical entry keeps pointing
 * at it. Turning either of the latter into a re-create would strip names off
 * old reports.
 */
export function useUndoableMutations({
  entries, deleteEntry, createEntry, deleteTask, restoreTask, archiveProject, restoreProject,
}: Deps): UndoableMutations {
  const toast = useToast();

  const deleteEntryWithUndo = useCallback(async (id: string) => {
    const snapshot = entries.find((e) => e.id === id);
    try {
      await deleteEntry(id);
    } catch {
      return;
    }
    if (snapshot) {
      const { id: _omit, userId: _u, userDisplayName: _n, ...data } = snapshot;
      toast("Entry deleted.", "info", {
        label: "Undo",
        onAction: () => { createEntry(data).catch(() => { /* toasted by hook */ }); },
      });
    }
  }, [entries, deleteEntry, createEntry, toast]);

  const deleteTaskWithUndo = useCallback(async (task: Task) => {
    try {
      await deleteTask(task);
    } catch {
      return;
    }
    // Only saved tasks get this far — deleteTask refuses a task whose id is
    // still pending — so there's no recreate-instead case to handle.
    toast("Task deleted.", "info", {
      label: "Undo",
      onAction: () => { restoreTask(task).catch(() => { /* toasted by hook */ }); },
    });
  }, [deleteTask, restoreTask, toast]);

  const archiveProjectWithUndo = useCallback(async (project: Project) => {
    try {
      await archiveProject(project);
    } catch {
      return;
    }
    toast("Project archived.", "info", {
      label: "Undo",
      onAction: () => { restoreProject(project).catch(() => { /* toasted by hook */ }); },
    });
  }, [archiveProject, restoreProject, toast]);

  return {
    deleteEntry: deleteEntryWithUndo,
    deleteTask: deleteTaskWithUndo,
    archiveProject: archiveProjectWithUndo,
  };
}
