import { useState, useEffect, useCallback, useRef } from "react";
import type { Project } from "../types";
import * as svc from "../services/dataverseService";
import { useToast } from "../contexts/ToastContext";
import { tempId, errMsg } from "./_shared";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const projectsRef = useRef<Project[]>([]);
  useEffect(() => { projectsRef.current = projects; }, [projects]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await svc.getProjects());
    } catch (err) {
      toast(`Could not load projects: ${errMsg(err)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  const addProject = useCallback(async (data: Omit<Project, "id" | "createdAt">) => {
    const optimistic: Project = { ...data, id: tempId(), createdAt: new Date().toISOString() };
    setProjects((prev) => [...prev, optimistic]);
    try {
      const real = await svc.createProject(data);
      setProjects((prev) => prev.map((p) => (p.id === optimistic.id ? real : p)));
      return real;
    } catch (err) {
      setProjects((prev) => prev.filter((p) => p.id !== optimistic.id));
      toast(`Could not create project: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [toast]);

  const editProject = useCallback(async (id: string, data: Partial<Project>) => {
    const snapshot = projectsRef.current.find((p) => p.id === id);
    if (!snapshot) throw new Error("Project not found");
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...data } : p)));
    try {
      const updated = await svc.updateProject(id, data);
      setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
      return updated;
    } catch (err) {
      setProjects((prev) => prev.map((p) => (p.id === id ? snapshot : p)));
      toast(`Could not save project: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [toast]);

  return { projects, loading, refresh, addProject, editProject };
}
