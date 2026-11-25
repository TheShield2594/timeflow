import { useCallback } from "react";
import type { Project, Task, TimeEntry } from "../types";
import { useToast } from "../contexts/ToastContext";
import { DATE_LOCALE, clockAt, minutesOfDay } from "../utils/dates";

interface Deps {
  entries: TimeEntry[];
  deleteEntry: (id: string) => Promise<void>;
  createEntry: (data: Omit<TimeEntry, "id" | "userId" | "userDisplayName">) => Promise<TimeEntry>;
  editEntry: (id: string, data: Partial<TimeEntry>) => Promise<TimeEntry>;
  deleteTask: (task: Task) => Promise<void>;
  restoreTask: (task: Task) => Promise<void>;
  archiveProject: (project: Project) => Promise<void>;
  restoreProject: (project: Project) => Promise<void>;
}

export interface EditOptions {
  /**
   * False for a write that is one step of a larger change, whose undo would
   * only take back part of it — the first half of a midnight split (#205).
   */
  undoable?: boolean;
}

export interface UndoableMutations {
  deleteEntry: (id: string) => Promise<void>;
  editEntry: (id: string, data: Partial<TimeEntry>, opts?: EditOptions) => Promise<TimeEntry>;
  deleteTask: (task: Task) => Promise<void>;
  archiveProject: (project: Project) => Promise<void>;
}

/** “Standup”, or "the entry" when it has no description — for toasts. */
function nameOf(entry: TimeEntry): string {
  const what = entry.description?.trim();
  return what ? `“${what.length > 40 ? `${what.slice(0, 39)}…` : what}”` : "the entry";
}

/** Fields an edit can't change, so an undo never writes them back. */
const SERVICE_OWNED = new Set(["id", "userId", "userDisplayName"]);

const clockOf = (iso: string) => clockAt(minutesOfDay(iso));

/**
 * Whether an edit actually changed a field. Times are compared as instants:
 * the server hands back "…:00Z" where the calendar writes "…:00.000Z", and
 * reading that as a change would offer to undo a move that never happened.
 */
function sameValue(key: string, a: unknown, b: unknown): boolean {
  if ((key === "startTime" || key === "endTime") && typeof a === "string" && typeof b === "string") {
    return new Date(a).getTime() === new Date(b).getTime();
  }
  return (a ?? null) === (b ?? null);
}

/**
 * What an edit did, said the way the user would say it: a calendar drag is a
 * move, a dragged edge is a resize, anything else is a save.
 */
function describeEdit(before: TimeEntry, changed: Partial<TimeEntry>): string {
  const keys = Object.keys(changed);
  const timing = new Set(["date", "startTime", "endTime", "durationMinutes"]);
  const onlyTiming = keys.every((k) => timing.has(k));
  const name = nameOf(before);
  if (onlyTiming && changed.startTime && !("durationMinutes" in changed)) {
    const date = changed.date ?? before.date;
    const day = date !== before.date
      ? `${new Date(`${date}T00:00:00`).toLocaleDateString(DATE_LOCALE, { weekday: "short", month: "short", day: "numeric" })}, `
      : "";
    return `Moved ${name} to ${day}${clockOf(changed.startTime)}.`;
  }
  if (onlyTiming && (changed.startTime || changed.endTime)) {
    const start = changed.startTime ?? before.startTime;
    const end = changed.endTime ?? before.endTime;
    if (end) return `Resized ${name} to ${clockOf(start)} – ${clockOf(end)}.`;
  }
  return `Saved changes to ${name}.`;
}

/**
 * The destructive actions, each wrapped in the toast that can take it
 * back (#115).
 *
 * They belong together because they share one rule that isn't obvious from
 * any of them alone: the undo offer only appears once the destructive call
 * has *succeeded*. A failed delete already toasted its own error inside the
 * data hook, and offering to undo something that didn't happen would be a lie
 * the user then acts on.
 *
 * They differ in what "undo" means, and that difference is load-bearing:
 * a deleted entry is genuinely gone (time entries are the only hard delete in
 * the app), so undo re-creates it from a snapshot taken before the delete; a
 * deleted task and an archived project were only deactivated, so undo
 * reactivates the very same record and every historical entry keeps pointing
 * at it. Turning either of the latter into a re-create would strip names off
 * old reports.
 */
export function useUndoableMutations({
  entries, deleteEntry, createEntry, editEntry, deleteTask, restoreTask, archiveProject, restoreProject,
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
      // Named, so the toast says which entry the Undo would bring back.
      toast(`Deleted ${nameOf(snapshot)}.`, "info", {
        label: "Undo",
        onAction: () => { createEntry(data).catch(() => { /* toasted by hook */ }); },
      });
    }
  }, [entries, deleteEntry, createEntry, toast]);

  /**
   * An edit, then an offer to put the entry back the way it was (#205).
   *
   * A calendar drag, a resize, a Shift + arrow nudge and a sheet Save all land
   * here, and every one of them changes a billable entry; a slipped drag used
   * to do it with nothing on screen saying so.
   *
   * Unlike the deletes this rethrows: the entry sheet stays open on a failed
   * save so the user can retry, and it learns of the failure from the
   * rejection. The hook below has already toasted it.
   *
   * Undo writes back only the fields this edit changed, from a snapshot taken
   * before it. A field that was empty is written back as null rather than
   * undefined, because undefined means "leave alone" to the service and the
   * whole point is to clear what the edit filled in.
   */
  const editEntryWithUndo = useCallback(async (id: string, data: Partial<TimeEntry>, opts?: EditOptions) => {
    const snapshot = entries.find((e) => e.id === id);
    const updated = await editEntry(id, data);
    if (!snapshot || opts?.undoable === false) return updated;
    const changed: Partial<TimeEntry> = {};
    const previous: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (SERVICE_OWNED.has(key)) continue;
      const before = snapshot[key as keyof TimeEntry];
      if (sameValue(key, before, value)) continue;
      (changed as Record<string, unknown>)[key] = value;
      previous[key] = before ?? null;
    }
    // A Save that changed nothing has nothing to undo, and a toast saying it
    // did something would be noise.
    if (Object.keys(previous).length === 0) return updated;
    toast(describeEdit(snapshot, changed), "info", {
      label: "Undo",
      onAction: () => {
        editEntry(id, previous as Partial<TimeEntry>).catch(() => { /* toasted by hook */ });
      },
    });
    return updated;
  }, [entries, editEntry, toast]);

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
    editEntry: editEntryWithUndo,
    deleteTask: deleteTaskWithUndo,
    archiveProject: archiveProjectWithUndo,
  };
}
