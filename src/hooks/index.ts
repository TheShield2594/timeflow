import { useState, useEffect, useCallback, useRef } from "react";
import type { Project, Task, TimeEntry, TimerState } from "../types";
import * as svc from "../services/dataverseService";
import { getCurrentUser } from "../services/userService";
import { useToast } from "../contexts/ToastContext";

// Stable identifier prefix for optimistic records — replaced once the server
// confirms the write. Useful in case anything looks for "real" IDs.
const TEMP_PREFIX = "temp-";

function tempId(): string {
  return TEMP_PREFIX + crypto.randomUUID();
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// useProjects
// ---------------------------------------------------------------------------
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

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

  return { projects, loading, refresh, addProject };
}

// ---------------------------------------------------------------------------
// useTasks
// ---------------------------------------------------------------------------
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const toast = useToast();

  useEffect(() => {
    svc.getAllTasks().then(setTasks).catch((err) => {
      toast(`Could not load tasks: ${errMsg(err)}`, "error");
    });
  }, [toast]);

  const addTask = useCallback(async (data: Omit<Task, "id">) => {
    const optimistic: Task = { ...data, id: tempId() };
    setTasks((prev) => [...prev, optimistic]);
    try {
      const real = await svc.createTask(data);
      setTasks((prev) => prev.map((t) => (t.id === optimistic.id ? real : t)));
      return real;
    } catch (err) {
      setTasks((prev) => prev.filter((t) => t.id !== optimistic.id));
      toast(`Could not create task: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [toast]);

  return { tasks, addTask };
}

// ---------------------------------------------------------------------------
// useTimeEntries
// ---------------------------------------------------------------------------
export function useTimeEntries(from?: string, to?: string) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  // Track latest entries in a ref so optimistic rollbacks always see fresh state
  // even if the calling component closure is stale.
  const entriesRef = useRef<TimeEntry[]>([]);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await svc.getTimeEntries({ from, to }));
    } catch (err) {
      toast(`Could not load entries: ${errMsg(err)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [from, to, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  const deleteEntry = useCallback(async (id: string) => {
    const idx = entriesRef.current.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const snapshot = entriesRef.current[idx];
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await svc.deleteTimeEntry(id);
    } catch (err) {
      setEntries((prev) => {
        const copy = [...prev];
        copy.splice(idx, 0, snapshot);
        return copy;
      });
      toast(`Could not delete entry: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [toast]);

  const createEntry = useCallback(async (data: Omit<TimeEntry, "id">) => {
    const optimistic: TimeEntry = { ...data, id: tempId() };
    setEntries((prev) => [optimistic, ...prev]);
    try {
      const real = await svc.createTimeEntry(data);
      setEntries((prev) => prev.map((e) => (e.id === optimistic.id ? real : e)));
      return real;
    } catch (err) {
      setEntries((prev) => prev.filter((e) => e.id !== optimistic.id));
      toast(`Could not save entry: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [toast]);

  const editEntry = useCallback(async (id: string, data: Partial<TimeEntry>) => {
    const snapshot = entriesRef.current.find((e) => e.id === id);
    if (!snapshot) throw new Error("Entry not found");
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...data } : e)));
    try {
      const updated = await svc.updateTimeEntry(id, data);
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
      return updated;
    } catch (err) {
      setEntries((prev) => prev.map((e) => (e.id === id ? snapshot : e)));
      toast(`Could not save changes: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [toast]);

  return { entries, loading, refresh, deleteEntry, createEntry, editEntry };
}

// ---------------------------------------------------------------------------
// useTimer — per-user state so a shared device does not cross-contaminate
// ---------------------------------------------------------------------------
const TIMER_KEY_PREFIX = "tt_active_timer:";

const RESET_TIMER: TimerState = {
  isRunning: false, startTime: null, projectId: null, taskId: null, description: "", ratio: undefined,
};

export function useTimer(onStop: (entry: TimeEntry) => void) {
  const user = getCurrentUser();
  const timerKey = `${TIMER_KEY_PREFIX}${user.id}`;
  const toast = useToast();

  const [timer, setTimer] = useState<TimerState>(() => {
    try {
      return JSON.parse(localStorage.getItem(timerKey) || "null") || RESET_TIMER;
    } catch {
      return RESET_TIMER;
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
    if (!projectId) {
      toast("Pick a project before starting the timer.", "error");
      return;
    }
    if (timer.isRunning) {
      // Defensive — UI prevents this, but a programmatic caller shouldn't be able to
      // strand the previous session by overwriting it.
      toast("Timer is already running. Stop it first.", "error");
      return;
    }
    const newTimer: TimerState = {
      isRunning: true,
      startTime: new Date().toISOString(),
      projectId,
      taskId,
      description,
      ratio,
    };
    setTimer(newTimer);
    localStorage.setItem(timerKey, JSON.stringify(newTimer));
  }, [timerKey, toast, timer.isRunning]);

  const stopAt = useCallback(async (endIso: string) => {
    if (!timer.isRunning || !timer.startTime || !timer.projectId) return;
    const startMs = new Date(timer.startTime).getTime();
    const endMs = new Date(endIso).getTime();
    const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));
    try {
      const entry = await svc.createTimeEntry({
        projectId: timer.projectId,
        taskId: timer.taskId || undefined,
        description: timer.description,
        startTime: timer.startTime,
        endTime: endIso,
        durationMinutes,
        ratio: timer.ratio,
        date: timer.startTime.split("T")[0],
        userId: user.id,
        userDisplayName: user.displayName,
      });
      setTimer(RESET_TIMER);
      localStorage.removeItem(timerKey);
      onStop(entry);
      return entry;
    } catch (err) {
      // Keep timer state intact so the user can retry by tapping Stop again.
      toast(`Could not save session: ${errMsg(err)}. Tap Stop to retry.`, "error");
      throw err;
    }
  }, [timer, onStop, timerKey, user.id, user.displayName, toast]);

  const stop = useCallback(() => stopAt(new Date().toISOString()), [stopAt]);

  /** Reset the timer without saving. Used for "discard session" flows. */
  const cancel = useCallback(() => {
    setTimer(RESET_TIMER);
    localStorage.removeItem(timerKey);
  }, [timerKey]);

  const update = useCallback((patch: Partial<TimerState>) => {
    setTimer((prev) => {
      const next = { ...prev, ...patch };
      if (next.isRunning) localStorage.setItem(timerKey, JSON.stringify(next));
      return next;
    });
  }, [timerKey]);

  return { timer, elapsed, start, stop, stopAt, cancel, update };
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

export function parseRatioInput(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Math.max(0, Math.round(Number(v)));
  return Number.isFinite(n) ? n : undefined;
}
