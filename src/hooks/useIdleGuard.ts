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
  /** The entry the 12h safety net stopped and saved, awaiting acknowledgement.
   *  It used to be a toast — the wrong shape for something the user didn't
   *  ask for and has to answer. */
  autoStopped: TimeEntry | null;
  dismissAutoStop: () => void;
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
  const [autoStopped, setAutoStopped] = useState<TimeEntry | null>(null);
  const lastActivity = useActivityTracker();

  // A session counts as activity from the moment it begins. Starting one here
  // is a click, so this changes nothing in the tab that started it; it is for
  // the tab the session *arrives* in through the storage event, which may not
  // have been touched for hours. Its stale `lastActivity` raised the idle
  // prompt at once, offering to trim the session back to before it began
  // (#192). Declared before the monitor so it lands ahead of the monitor's
  // first check in the same commit.
  useEffect(() => {
    if (timer.startTime) lastActivity.current = Date.now();
  }, [timer.startTime, lastActivity]);

  const handleIdleDetected = useCallback((lastActiveAt: number) => {
    if (timer.startTime) {
      // Idle time before the session began is not the session's to lose.
      const startMs = new Date(timer.startTime).getTime();
      setIdleAlert({ lastActiveAt: Math.max(lastActiveAt, startMs), startTime: timer.startTime });
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
      const entry = await stopAt(cappedEnd);
      // The sheet explains what happened and offers the correction; nothing
      // here toasts, because a message that needs an answer is not a toast.
      if (entry) setAutoStopped(entry);
    } catch {
      // stopAt already toasted the save error
    } finally {
      // The caller clears the flag when the save lands; if it never lands,
      // clear it here so the suppression can't leak onto the retry.
      saveToastSuppressed.current = false;
    }
  }, [timer.startTime, stopAt, saveToastSuppressed]);

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
    // Never before the session began: a trim point earlier than the start
    // would save a row that ends before it starts, in place of the real
    // session (#192). The alert is clamped when raised; this holds the line
    // if a different session has started under it since.
    const startMs = new Date(idleAlert.startTime).getTime();
    const trimAt = Math.max(idleAlert.lastActiveAt, startMs);
    // stopAt returns nothing both when the timer was already stopped and when
    // the trimmed span rounds to 0m, which it discards and says so itself
    // (#188). Only the first still needs saying here.
    const roundsToNothing = Math.round((trimAt - startMs) / 60000) === 0;
    try {
      const entry = await stopAt(new Date(trimAt).toISOString());
      // stopAt no-ops (returns undefined) when the timer was already stopped —
      // tell the user rather than leaving the click with no visible effect.
      if (!entry && !roundsToNothing) toast("Timer was already stopped — nothing to trim.", "info");
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

  const dismissAutoStop = useCallback(() => setAutoStopped(null), []);

  return { idleAlert, autoStopped, dismissAutoStop, onTrim, onKeep, onDiscard };
}
