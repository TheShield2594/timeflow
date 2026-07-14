import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { Task } from "../types";
import * as svc from "../services/dataverseService";
import { useToast } from "../contexts/ToastContext";
import { tempId, isTempId, errMsg } from "./_shared";

export function useTasks() {
  const [tasksByProject, setTasksByProject] = useState<Map<string, Task[]>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const toast = useToast();

  // Load every task once at bootstrap so task names resolve everywhere —
  // timesheet badges, calendar blocks, Reports "Top Tasks", search and the
  // CSV export — without the user first visiting a page that happens to
  // lazily fetch that project's tasks.
  useEffect(() => {
    svc.getAllTasks().then((all) => {
      const grouped = new Map<string, Task[]>();
      for (const t of all) {
        if (!grouped.has(t.projectId)) grouped.set(t.projectId, []);
        grouped.get(t.projectId)!.push(t);
      }
      setTasksByProject((prev) => {
        // A project already in the map holds fresher data (a lazy load or an
        // optimistic add that raced this fetch) — keep it.
        const next = new Map(grouped);
        prev.forEach((list, pid) => next.set(pid, list));
        return next;
      });
    }).catch((err) => {
      // Non-fatal: the per-project lazy loads below still cover the pickers.
      console.error("Bulk task load failed:", err);
    });
  }, []);

  const loadTasksForProject = useCallback(async (projectId: string) => {
    if (!projectId || tasksByProject.has(projectId) || loadingRef.current.has(projectId)) return;
    loadingRef.current.add(projectId);
    try {
      const loaded = await svc.getTasksForProject(projectId);
      setTasksByProject((prev) => new Map([...prev, [projectId, loaded]]));
    } catch (err) {
      toast(`Could not load tasks: ${errMsg(err)}`, "error");
    } finally {
      loadingRef.current.delete(projectId);
    }
  }, [tasksByProject, toast]);

  const tasks = useMemo(() => [...tasksByProject.values()].flat(), [tasksByProject]);

  const addTask = useCallback(async (data: Omit<Task, "id">) => {
    if (isTempId(data.projectId)) {
      toast("Project is still saving — please wait a moment and try again", "error");
      throw new Error("Project not yet saved");
    }
    const optimistic: Task = { ...data, id: tempId() };
    setTasksByProject((prev) => {
      const existing = prev.get(data.projectId) ?? [];
      return new Map([...prev, [data.projectId, [...existing, optimistic]]]);
    });
    try {
      const real = await svc.createTask(data);
      setTasksByProject((prev) => {
        const existing = (prev.get(data.projectId) ?? []).map((t) => (t.id === optimistic.id ? real : t));
        return new Map([...prev, [data.projectId, existing]]);
      });
      return real;
    } catch (err) {
      setTasksByProject((prev) => {
        const existing = (prev.get(data.projectId) ?? []).filter((t) => t.id !== optimistic.id);
        return new Map([...prev, [data.projectId, existing]]);
      });
      toast(`Could not create task: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [toast]);

  const setTaskActive = useCallback((projectId: string, taskId: string, isActive: boolean) => {
    setTasksByProject((prev) => {
      const existing = (prev.get(projectId) ?? []).map((t) => (t.id === taskId ? { ...t, isActive } : t));
      return new Map([...prev, [projectId, existing]]);
    });
  }, []);

  // "Deleting" a task deactivates it (see dataverseService) so historical
  // entries keep their task names. The task stays in the map flagged inactive
  // — pickers filter it out — and undo restores the very same record.
  const deleteTask = useCallback(async (task: Task) => {
    if (isTempId(task.id)) {
      // Never saved server-side: just drop it locally.
      setTasksByProject((prev) => {
        const existing = (prev.get(task.projectId) ?? []).filter((t) => t.id !== task.id);
        return new Map([...prev, [task.projectId, existing]]);
      });
      return;
    }
    setTaskActive(task.projectId, task.id, false);
    try {
      await svc.deactivateTask(task.id);
    } catch (err) {
      setTaskActive(task.projectId, task.id, true);
      toast(`Could not delete task: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [setTaskActive, toast]);

  const restoreTask = useCallback(async (task: Task) => {
    setTaskActive(task.projectId, task.id, true);
    try {
      await svc.reactivateTask(task.id);
    } catch (err) {
      setTaskActive(task.projectId, task.id, false);
      toast(`Could not restore task: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [setTaskActive, toast]);

  return { tasks, addTask, deleteTask, restoreTask, loadTasksForProject };
}
