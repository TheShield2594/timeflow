import { useState, useEffect, useCallback, useRef } from "react";
import type { TimeEntry, TimerState } from "../types";
import * as svc from "../services/dataverseService";
import { getCurrentUser } from "../services/userService";
import { useToast } from "../contexts/ToastContext";
import { localDateStr } from "../utils/dates";

const TIMER_KEY_PREFIX = "tt_active_timer:";

const RESET_TIMER: TimerState = {
  isRunning: false, startTime: null, projectId: null, taskId: null, description: "", ratio: undefined,
};

export function useTimer(onStop: (entry: TimeEntry) => void) {
  const user = getCurrentUser();
  const timerKey = `${TIMER_KEY_PREFIX}${user.environmentId}:${user.id}`;
  const toast = useToast();

  // One-time cleanup of the pre-environment-scoping key, which could hold a
  // different environment's timer (e.g. QA restoring Dev's draftEntryId).
  useEffect(() => {
    localStorage.removeItem(`${TIMER_KEY_PREFIX}${user.id}`);
  }, [user.id]);

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
    const localState = (() => {
      try { return JSON.parse(localStorage.getItem(timerKey) || "null"); } catch { return null; }
    })();
    if (localState) return;
    svc.getOpenTimerEntry().then((open) => {
      if (!open || !open.projectId || !open.startTime) return;
      // Ownership is already enforced server-side by getOpenTimerEntry's
      // eq-userid FetchXML filter, which Dataverse resolves authoritatively
      // for "the calling user" — unlike a client-side compare against the
      // stored ever_userid column, it isn't vulnerable to that column's
      // known objectId drift across SDK sessions (see README "Row security
      // matters"), so re-checking open.userId here would risk rejecting the
      // user's own timer instead of adding real protection.
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
  // Empty deps: timerKey is stable (derived from the immutable user.id), and
  // this check must run only once on mount — adding timerKey would be safe but
  // redundant, and adding svc would cause unnecessary re-runs.
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

    svc.createDraftTimerEntry({
      projectId,
      taskId,
      description,
      startTime: newTimer.startTime!,
      date: localDateStr(new Date(newTimer.startTime!)),
      ratio,
    }).then((draftEntryId) => {
      setTimer((prev) => {
        if (!prev.isRunning) return prev;
        const next = { ...prev, draftEntryId };
        localStorage.setItem(timerKey, JSON.stringify(next));
        return next;
      });
    }).catch(() => { /* non-critical */ });
  }, [timerKey, toast, timer.isRunning, timer.pendingStopAt]);

  const stopAt = useCallback(async (endIso: string) => {
    const activeTimer = timer;
    if (!activeTimer.startTime || !activeTimer.projectId) return;
    if (!activeTimer.isRunning && !activeTimer.pendingStopAt) return;

    const startMs = new Date(activeTimer.startTime).getTime();
    const endMs = new Date(endIso).getTime();
    const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));

    const stoppedTimer: TimerState = { ...activeTimer, isRunning: false, pendingStopAt: endIso };
    setTimer(stoppedTimer);
    localStorage.setItem(timerKey, JSON.stringify(stoppedTimer));

    try {
      let entry: TimeEntry;
      if (activeTimer.draftEntryId) {
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
      toast("Failed to save entry. Press Stop to retry.", "error");
      throw err;
    }
  }, [timer, onStop, timerKey, user.id, user.displayName, toast]);

  const stop = useCallback(() => stopAt(new Date().toISOString()), [stopAt]);

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
