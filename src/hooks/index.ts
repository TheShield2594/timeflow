import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Project, Task, TimeEntry, TimerState } from "../types";
import * as svc from "../services/dataverseService";
import { getCurrentUser } from "../services/userService";
import { useToast } from "../contexts/ToastContext";
import { localDateStr } from "../utils/dates";

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

  const editProject = useCallback(async (id: string, data: Partial<Project>) => {
    const snapshot = projects.find((p) => p.id === id);
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
  }, [projects, toast]);

  return { projects, loading, refresh, addProject, editProject };
}

// ---------------------------------------------------------------------------
// useTasks — lazy-loads per project on demand, caches by project ID
// ---------------------------------------------------------------------------
export function useTasks() {
  const [tasksByProject, setTasksByProject] = useState<Map<string, Task[]>>(new Map());
  // Track in-flight requests in a ref so the callback doesn't need it as a dep.
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

  return { tasks, addTask, loadTasksForProject };
}

// ---------------------------------------------------------------------------
// useTimeEntries
// ---------------------------------------------------------------------------
export function useTimeEntries(from?: string, to?: string) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  // `loading` is true only until the FIRST load completes. Later refreshes
  // (range widening, post-save refetch) keep showing the data we already
  // have instead of blanking the page.
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  // Track latest entries in a ref so optimistic rollbacks always see fresh state
  // even if the calling component closure is stale.
  const entriesRef = useRef<TimeEntry[]>([]);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  // Monotonic sequence so an older in-flight refresh can't overwrite the
  // result of a newer one (range changes can fire requests back-to-back).
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const data = await svc.getTimeEntries({ from, to });
      if (seq !== seqRef.current) return;
      setEntries(data);
    } catch (err) {
      if (seq !== seqRef.current) return;
      toast(`Could not load entries: ${errMsg(err)}`, "error");
    } finally {
      if (seq === seqRef.current) setLoading(false);
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

  // On bootstrap: if no local timer state, check Dataverse for an open entry
  // left by a previous session that lost its localStorage (#15).
  useEffect(() => {
    const localState = (() => {
      try { return JSON.parse(localStorage.getItem(timerKey) || "null"); } catch { return null; }
    })();
    if (localState) return; // localStorage already has state, no need to query
    svc.getOpenTimerEntry().then((open) => {
      if (!open || !open.projectId || !open.startTime) return;
      const restored: TimerState = {
        isRunning: true,
        startTime: open.startTime,
        projectId: open.projectId,
        taskId: open.taskId ?? null,
        description: open.description ?? "",
        ratio: open.ratio,
        draftEntryId: open.id,
      };
      setTimer(restored);
      localStorage.setItem(timerKey, JSON.stringify(restored));
    }).catch(() => { /* non-critical */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (timer.isRunning || timer.pendingStopAt) {
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

    // Write a draft entry to Dataverse immediately so the session survives a
    // page reload that clears localStorage (#15). Fire-and-forget: the draft
    // ID is stored back into timer state once the round-trip completes.
    svc.createDraftTimerEntry({
      projectId,
      taskId,
      description,
      startTime: newTimer.startTime!,
      date: localDateStr(new Date(newTimer.startTime!)),
      ratio,
    }).then((draftEntryId) => {
      setTimer((prev) => {
        if (!prev.isRunning) return prev; // timer was stopped before we got back
        const next = { ...prev, draftEntryId };
        localStorage.setItem(timerKey, JSON.stringify(next));
        return next;
      });
    }).catch(() => { /* non-critical — localStorage still covers the common case */ });
  }, [timerKey, toast, timer.isRunning, timer.pendingStopAt]);

  const stopAt = useCallback(async (endIso: string) => {
    const activeTimer = timer;
    if (!activeTimer.startTime || !activeTimer.projectId) return;
    if (!activeTimer.isRunning && !activeTimer.pendingStopAt) return;

    const startMs = new Date(activeTimer.startTime).getTime();
    const endMs = new Date(endIso).getTime();
    const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));

    // Stop the clock immediately (issue #32 — don't leave it running while the
    // network call is in flight). We'll roll back if the save fails.
    const stoppedTimer: TimerState = { ...activeTimer, isRunning: false, pendingStopAt: endIso };
    setTimer(stoppedTimer);
    localStorage.setItem(timerKey, JSON.stringify(stoppedTimer));

    try {
      let entry: TimeEntry;
      if (activeTimer.draftEntryId) {
        // Update the draft record written at start time (#15).
        entry = await svc.updateTimeEntry(activeTimer.draftEntryId, {
          endTime: endIso,
          durationMinutes,
          description: activeTimer.description,
          ratio: activeTimer.ratio,
          taskId: activeTimer.taskId || undefined,
        });
      } else {
        entry = await svc.createTimeEntry({
          projectId: activeTimer.projectId,
          taskId: activeTimer.taskId || undefined,
          description: activeTimer.description,
          startTime: activeTimer.startTime,
          endTime: endIso,
          durationMinutes,
          ratio: activeTimer.ratio,
          // Stamp the LOCAL calendar day the session started — startTime is a
          // UTC ISO string, so splitting it would shift evening sessions to
          // the next day for users west of UTC.
          date: localDateStr(new Date(activeTimer.startTime)),
          userId: user.id,
          userDisplayName: user.displayName,
        });
      }
      setTimer(RESET_TIMER);
      localStorage.removeItem(timerKey);
      onStop(entry);
      return entry;
    } catch (err) {
      // Save failed: keep the stopped-but-pending state so the user can retry
      // (#32). pendingStopAt is already written to localStorage above.
      toast("Failed to save entry. Tap Stop to retry.", "error");
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
