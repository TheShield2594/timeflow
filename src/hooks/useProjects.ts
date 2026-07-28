import { useState, useEffect, useCallback, useRef } from "react";
import type { Project } from "../types";
import * as svc from "../services/dataverseService";
import { useToast } from "../contexts/ToastContext";
import { tempId, isTempId, errMsg } from "./_shared";

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
      if (!real.id) {
        // The connector dropped the response body, so we have no server id for
        // the row it created. Adopting `id: ""` leaves a project that can't be
        // edited, archived or picked for a task; keep the temp id (the temp-id
        // guards then say "still saving") and re-read the list to reconcile.
        const pending = { ...real, id: optimistic.id };
        setProjects((prev) => prev.map((p) => (p.id === optimistic.id ? pending : p)));
        refresh();
        return pending;
      }
      setProjects((prev) => prev.map((p) => (p.id === optimistic.id ? real : p)));
      return real;
    } catch (err) {
      setProjects((prev) => prev.filter((p) => p.id !== optimistic.id));
      toast(`Could not create project: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [refresh, toast]);

  const editProject = useCallback(async (id: string, data: Partial<Project>) => {
    const snapshot = projectsRef.current.find((p) => p.id === id);
    if (!snapshot) throw new Error("Project not found");
    if (isTempId(id)) {
      toast("Project is still saving — please wait a moment and try again", "error");
      throw new Error("Project not yet saved");
    }
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...data } : p)));
    try {
      const updated = await svc.updateProject(id, data);
      // Merged over the existing record, not swapped in for it: a dropped
      // response body makes `updated` carry only the patched fields, and
      // replacing wholesale would drop createdAt/isActive — an absent
      // isActive reads as falsy and hides the project from every picker.
      // The merged record is what's returned too, so callers get the whole
      // Project this signature promises rather than that partial.
      const merged = { ...snapshot, ...updated };
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updated } : p)));
      return merged;
    } catch (err) {
      setProjects((prev) => prev.map((p) => (p.id === id ? snapshot : p)));
      toast(`Could not save project: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [toast]);

  const setProjectActive = useCallback((id: string, isActive: boolean) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, isActive } : p)));
  }, []);

  // Archiving deactivates the record (statecode) — it stays in the list,
  // flagged inactive, so historical entries keep resolving its name/color;
  // pickers filter it out. Restore reactivates the same record.
  const archiveProject = useCallback(async (project: Project) => {
    // A temp id has no row to deactivate, and deactivate deliberately treats a
    // 404 as success — so without this guard the archive would look like it
    // worked while the real project stayed active.
    if (isTempId(project.id)) {
      toast("Project is still saving — please wait a moment and try again", "error");
      throw new Error("Project not yet saved");
    }
    setProjectActive(project.id, false);
    try {
      await svc.deactivateProject(project.id);
    } catch (err) {
      setProjectActive(project.id, true);
      toast(`Could not archive project: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [setProjectActive, toast]);

  const restoreProject = useCallback(async (project: Project) => {
    setProjectActive(project.id, true);
    try {
      await svc.reactivateProject(project.id);
    } catch (err) {
      setProjectActive(project.id, false);
      toast(`Could not restore project: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [setProjectActive, toast]);

  return { projects, loading, refresh, addProject, editProject, archiveProject, restoreProject };
}
