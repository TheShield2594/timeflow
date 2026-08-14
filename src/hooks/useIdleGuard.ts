import { useCallback, useEffect, useState } from "react";
import type { TimeEntry, TimerState } from "../types";
import { useActivityTracker, useTimerSafetyMonitor, MAX_DURATION_MS } from "./useTimerSafety";
import type { ToastKind, ToastAction } from "../contexts/ToastContext";

export interface IdleAlert {
  lastActiveAt: number;
  startTime: string;
}

interface Options {
  timer: TimerState;
  stopAt: (endIso: string) => Promise<TimeEntry | undefined>;
  cancel: () => Promise<TimerState | null>;
  restore: (session: TimerState) => Promise<boolean>;
  /** Re-read the entry list, so a discarded (or restored) draft row appears
   *  and disappears from the timesheet with the session. */
  refresh: () => void;
  toast: (message: string, kind?: ToastKind, action?: ToastAction) => void;
  /** Owned by the caller, because the same flag gates the caller's own
   *  "Saved …" confirmation: the 12h auto-stop below explains itself in full,
   *  and a second generic toast on top of it just buries the reason. */
  saveToastSuppressed: React.MutableRefObject<boolean>;
}

interface IdleGuard {
  idleAlert: IdleAlert | null;
  onTrim: () => Promise<void>;
  onKeep: () => void;
  onDiscard: () => Promise<void>;
}

/**
 * The idle / max-duration state machine behind IdleModal.
 *
 * It lives in its own hook because it is the code that decides whether a
 * user's tracked hours are trimmed, kept or thrown away, and inside AppContent
 * none of that could be tested without standing up the whole app (#105).
 */
export function useIdleGuard({
  timer,
  stopAt,
  cancel,
  restore,
  refresh,
  toast,
  saveToastSuppressed,
}: Options): IdleGuard {
  const [idleAlert, setIdleAlert] = useState<IdleAlert | null>(null);
  const lastActivity = useActivityTracker();

  const handleIdleDetected = useCallback((lastActiveAt: number) => {
    if (timer.startTime) {
      setIdleAlert({ lastActiveAt, startTime: timer.startTime });
    }
  }, [timer.startTime]);

  const handleMaxDuration = useCallback(async () => {
    if (!timer.startTime) return;
    // The idle prompt may already be open from the +30min check. Clear it so it
    // can't linger over an entry the safety net has already stopped and saved —
    // its Trim/Discard buttons would otherwise no-op against a reset timer.
    setIdleAlert(null);
    const cappedEnd = new Date(new Date(timer.startTime).getTime() + MAX_DURATION_MS).toISOString();
    // This path's own message says everything the generic "Saved …" toast
    // would, plus why the timer stopped on its own.
    saveToastSuppressed.current = true;
    try {
      await stopAt(cappedEnd);
      toast("Timer auto-stopped after 12 hours — edit the entry if needed.", "info");
    } catch {
      // stopAt already toasted the save error
    } finally {
      // The caller clears the flag when the save lands; if it never lands,
      // clear it here so the suppression can't leak onto the retry.
      saveToastSuppressed.current = false;
    }
  }, [timer.startTime, stopAt, toast, saveToastSuppressed]);

  useTimerSafetyMonitor({
    isRunning: timer.isRunning,
    startTime: timer.startTime,
    lastActivity,
    onIdleDetected: handleIdleDetected,
    onMaxDurationReached: handleMaxDuration,
  });

  // Dismiss the idle prompt whenever the timer is no longer running for any
  // reason we didn't drive from the modal itself — most importantly a cross-tab
  // stop arriving via the storage-event sync. Without this the modal would sit
  // over a stopped timer and its buttons would silently no-op. A save in flight
  // (pendingStopAt set) is left alone so the modal doesn't flicker mid-stop.
  useEffect(() => {
    if (!timer.isRunning && !timer.pendingStopAt && idleAlert) {
      setIdleAlert(null);
    }
  }, [timer.isRunning, timer.pendingStopAt, idleAlert]);

  const onTrim = useCallback(async () => {
    if (!idleAlert) return;
    setIdleAlert(null);
    try {
      const entry = await stopAt(new Date(idleAlert.lastActiveAt).toISOString());
      // stopAt no-ops (returns undefined) when the timer was already stopped —
      // tell the user rather than leaving the click with no visible effect.
      if (!entry) toast("Timer was already stopped — nothing to trim.", "info");
    } catch {
      // toasted by stopAt
    }
  }, [idleAlert, stopAt, toast]);

  const onKeep = useCallback(() => {
    lastActivity.current = Date.now();
    setIdleAlert(null);
  }, [lastActivity]);

  const onDiscard = useCallback(async () => {
    setIdleAlert(null);
    // cancel() resolves once the draft row is deleted; refresh after so the
    // discarded session's "Running…" row disappears from the timesheet too.
    // It reports the session it discarded — if the 12h safety net or another
    // tab already stopped and saved the entry, say that instead of falsely
    // claiming the session was discarded.
    const discarded = await cancel();
    if (!discarded) {
      toast("Timer was already stopped — the saved entry was kept.", "info");
      return;
    }
    refresh();
    // The modal arrives unprompted, over whatever the user was doing, and
    // Discard sits one button away from Trim and Keep. Every other destructive
    // action in this app offers an undo; the one that can throw away a whole
    // day of tracked time was the exception (#105). Restoring re-opens the
    // session on its original start time, so the clock picks up where it was
    // rather than restarting from zero.
    toast("Session discarded.", "info", {
      label: "Restore",
      onAction: () => {
        restore(discarded).then((restored) => { if (restored) refresh(); });
      },
    });
  }, [cancel, restore, refresh, toast]);

  return { idleAlert, onTrim, onKeep, onDiscard };
}
