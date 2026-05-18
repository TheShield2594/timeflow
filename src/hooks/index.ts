import { useState, useEffect, useCallback, useRef } from "react";
import type { Project, Task, TimeEntry, TimerState } from "../types";
import * as svc from "../services/dataverseService";

// ---------------------------------------------------------------------------
// useProjects
// ---------------------------------------------------------------------------
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await svc.getProjects();
    setProjects(data);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addProject = useCallback(async (data: Omit<Project, "id" | "createdAt">) => {
    const p = await svc.createProject(data);
    setProjects((prev) => [...prev, p]);
    return p;
  }, []);

  return { projects, loading, refresh, addProject };
}

// ---------------------------------------------------------------------------
// useTasks
// ---------------------------------------------------------------------------
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    svc.getAllTasks().then(setTasks);
  }, []);

  const addTask = useCallback(async (data: Omit<Task, "id">) => {
    const t = await svc.createTask(data);
    setTasks((prev) => [...prev, t]);
    return t;
  }, []);

  return { tasks, addTask };
}

// ---------------------------------------------------------------------------
// useTimeEntries
// ---------------------------------------------------------------------------
export function useTimeEntries(from?: string, to?: string) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await svc.getTimeEntries({ from, to });
    setEntries(data);
    setLoading(false);
  }, [from, to]);

  useEffect(() => { refresh(); }, [refresh]);

  const deleteEntry = useCallback(async (id: string) => {
    await svc.deleteTimeEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const stopEntry = useCallback(async (id: string, endTime: string, durationMinutes: number) => {
    const updated = await svc.updateTimeEntry(id, { endTime, durationMinutes });
    setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    return updated;
  }, []);

  const createEntry = useCallback(async (data: Omit<TimeEntry, "id">) => {
    const entry = await svc.createTimeEntry(data);
    setEntries((prev) => [entry, ...prev]);
    return entry;
  }, []);

  const editEntry = useCallback(async (id: string, data: Partial<TimeEntry>) => {
    const updated = await svc.updateTimeEntry(id, data);
    setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    return updated;
  }, []);

  return { entries, loading, refresh, deleteEntry, stopEntry, createEntry, editEntry };
}

// ---------------------------------------------------------------------------
// useTimer
// ---------------------------------------------------------------------------
const TIMER_KEY = "tt_active_timer";

export function useTimer(onStop: (entry: TimeEntry) => void) {
  const [timer, setTimer] = useState<TimerState>(() => {
    try {
      return JSON.parse(localStorage.getItem(TIMER_KEY) || "null") || {
        isRunning: false, startTime: null, projectId: null, taskId: null, description: "", ratio: undefined,
      };
    } catch {
      return { isRunning: false, startTime: null, projectId: null, taskId: null, description: "", ratio: undefined };
    }
  });
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timer.isRunning && timer.startTime) {
      const tick = () => {
        const diff = Math.floor((Date.now() - new Date(timer.startTime!).getTime()) / 1000);
        setElapsed(diff);
      };
      tick();
      intervalRef.current = setInterval(tick, 1000);
    } else {
      setElapsed(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timer.isRunning, timer.startTime]);

  const start = useCallback((projectId: string, taskId: string | null, description: string, ratio?: number) => {
    const newTimer: TimerState = {
      isRunning: true,
      startTime: new Date().toISOString(),
      projectId,
      taskId,
      description,
      ratio,
    };
    setTimer(newTimer);
    localStorage.setItem(TIMER_KEY, JSON.stringify(newTimer));
  }, []);

  const stop = useCallback(async () => {
    if (!timer.isRunning || !timer.startTime || !timer.projectId) return;
    const endTime = new Date().toISOString();
    const durationMinutes = Math.round(
      (new Date(endTime).getTime() - new Date(timer.startTime).getTime()) / 60000
    );
    const entry = await svc.createTimeEntry({
      projectId: timer.projectId,
      taskId: timer.taskId || undefined,
      description: timer.description,
      startTime: timer.startTime,
      endTime,
      durationMinutes,
      ratio: timer.ratio,
      date: timer.startTime.split("T")[0],
      userId: "current-user",
      userDisplayName: "You",
    });
    const reset: TimerState = { isRunning: false, startTime: null, projectId: null, taskId: null, description: "", ratio: undefined };
    setTimer(reset);
    localStorage.removeItem(TIMER_KEY);
    onStop(entry);
    return entry;
  }, [timer, onStop]);

  const update = useCallback((patch: Partial<TimerState>) => {
    setTimer((prev) => {
      const next = { ...prev, ...patch };
      if (next.isRunning) localStorage.setItem(TIMER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { timer, elapsed, start, stop, update };
}

// ---------------------------------------------------------------------------
// useElapsedDisplay
// ---------------------------------------------------------------------------
export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

