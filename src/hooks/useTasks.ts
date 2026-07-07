import { useState, useCallback, useMemo, useRef } from "react";
import type { Task } from "../types";
import * as svc from "../services/dataverseService";
import { useToast } from "../contexts/ToastContext";
import { tempId, isTempId, errMsg } from "./_shared";

export function useTasks() {
  const [tasksByProject, setTasksByProject] = useState<Map<string, Task[]>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const toast = useToast();

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

  const deleteTask = useCallback(async (task: Task) => {
    const projectId = task.projectId;
    setTasksByProject((prev) => {
      const existing = (prev.get(projectId) ?? []).filter((t) => t.id !== task.id);
      return new Map([...prev, [projectId, existing]]);
    });
    try {
      if (!isTempId(task.id)) await svc.deleteTask(task.id);
    } catch (err) {
      setTasksByProject((prev) => {
        const existing = prev.get(projectId) ?? [];
        return new Map([...prev, [projectId, [...existing, task]]]);
      });
      toast(`Could not delete task: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [toast]);

  return { tasks, addTask, deleteTask, loadTasksForProject };
}
