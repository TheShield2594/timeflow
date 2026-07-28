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

  const readStoredTimer = useCallback((): TimerState | null => {
    try {
      return JSON.parse(localStorage.getItem(timerKey) || "null");
    } catch {
      return null;
    }
  }, [timerKey]);

  // localStorage is a *mirror* of the timer, not its source of truth: it exists
  // so a reload can pick the session back up. Writes therefore never throw —
  // quota-exceeded, disabled or private-mode storage must not abort the caller
  // (a throw here used to kill the stop path before it saved, see issue #75),
  // and the in-memory state plus the server draft row still carry the session.
  const persistTimer = useCallback((next: TimerState | null) => {
    try {
      if (next) localStorage.setItem(timerKey, JSON.stringify(next));
      else localStorage.removeItem(timerKey);
    } catch {
      console.warn("Timer state could not be persisted to localStorage.");
    }
  }, [timerKey]);

  const [timer, setTimer] = useState<TimerState>(() => {
    try {
      return JSON.parse(localStorage.getItem(timerKey) || "null") || RESET_TIMER;
    } catch {
      return RESET_TIMER;
    }
  });
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mirror of the latest timer state for async callbacks (e.g. the draft
  // create resolving after the user already stopped). The effect below keeps
  // it in sync as a backstop, but every direct state write goes through
  // applyTimer so the ref is correct *synchronously* — a draft create can
  // resolve before React commits, and reading a stale snapshot there would
  // misclassify a live draft as orphaned.
  const timerRef = useRef(timer);
  useEffect(() => { timerRef.current = timer; }, [timer]);
  const applyTimer = useCallback((next: TimerState) => {
    timerRef.current = next;
    setTimer(next);
  }, []);

  // Keep multiple tabs coherent: when another tab starts/stops this user's
  // timer, its localStorage write fires a storage event here (the event never
  // fires in the writing tab). Without this, a second tab still shows the old
  // state and can start a second, overlapping timer.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== timerKey) return;
      try {
        applyTimer(JSON.parse(e.newValue || "null") || RESET_TIMER);
      } catch { /* ignore malformed writes */ }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [timerKey]);

  useEffect(() => {
    if (readStoredTimer()) return;
    svc.getOpenTimerEntry().then((open) => {
      if (!open || !open.projectId || !open.startTime) return;
      // The pre-fetch check above is not enough: this read is async, and the
      // user can hit Start (or "Continue" on an entry) while it is in flight.
      // Applying the server row unconditionally there would replace their
      // intentional new session with a stale one — and the draft-create guard
      // below (startTime mismatch) would then delete the draft it just made.
      // A local session always wins; the server row is only reconciled.
      const local = timerRef.current;
      if (local.isRunning || local.pendingStopAt || readStoredTimer()) {
        // Same session round-tripping back from the server (a slow read that
        // caught the draft this tab just created): adopt the row id so stop
        // updates that draft instead of creating a second row. Everything else
        // stays local, since description/ratio may have been edited since.
        if (local.isRunning && local.startTime === open.startTime && !local.draftEntryId) {
          const adopted: TimerState = { ...local, draftEntryId: open.id };
          applyTimer(adopted);
          persistTimer(adopted);
        }
        // Otherwise the open row is from an older session (e.g. a crash on
        // another device). Leave it alone rather than deleting it: it may
        // still be someone's live timer, and it is restorable on a later
        // reload, whereas a delete is unrecoverable.
        return;
      }
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
      applyTimer(restored);
      persistTimer(restored);
    }).catch(() => {
      // Couldn't check for an open draft (throttling, network). Distinct from
      // "there is none": leave whatever local state exists authoritative and
      // don't reset the timer — assuming "no draft" here is what strands a
      // running timer server-side and resurfaces it later as a phantom.
      console.warn("Could not check for an open timer entry; keeping local timer state.");
    });
  // Empty deps: timerKey is stable (derived from the immutable user.id), so
  // the readStoredTimer/persistTimer callbacks are stable too, and this check
  // must run only once on mount — adding them would be safe but redundant,
  // and adding svc would cause unnecessary re-runs.
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
    applyTimer(newTimer);
    persistTimer(newTimer);

    svc.createDraftTimerEntry({
      projectId,
      taskId,
      description,
      startTime: newTimer.startTime!,
      date: localDateStr(new Date(newTimer.startTime!)),
      ratio,
    }).then((draftEntryId) => {
      // Null means the row may exist but we couldn't establish its id (dropped
      // response body, and the read-back didn't resolve it either). Storing it
      // would make stop() PATCH `undefined`; leaving draftEntryId unset instead
      // routes stop() through the create path, and bootstrap's reconcile adopts
      // or restores the orphaned draft on the next load (#70).
      if (!draftEntryId) return;
      // If the user already stopped or discarded this session while the draft
      // create was in flight, the completed entry (if any) was created via the
      // no-draft path — this row would linger open (endTime null) and be
      // restored as a phantom running timer on the next reload. Delete it.
      const current = timerRef.current;
      if (!current.isRunning || current.startTime !== newTimer.startTime) {
        svc.deleteTimeEntry(draftEntryId).catch(() => { /* best effort */ });
        return;
      }
      // applyTimer, not setTimer: the ref has to carry draftEntryId
      // *synchronously* (see the invariant above). With a plain setTimer, a
      // stop or cancel landing before React commits would read a ref with no
      // draftEntryId and create a duplicate entry / strand the draft as a
      // phantom running timer on the next reload.
      const next: TimerState = { ...current, draftEntryId };
      applyTimer(next);
      persistTimer(next);
    }).catch(() => { /* non-critical */ });
  }, [persistTimer, applyTimer, toast, timer.isRunning, timer.pendingStopAt]);

  const stopAt = useCallback(async (endIso: string) => {
    // The ref, not the render snapshot: a draft create (or a description edit)
    // resolving in this same tick updates the ref synchronously but not the
    // closed-over state, and stopping against a snapshot with no draftEntryId
    // creates a duplicate entry alongside the still-open draft.
    const activeTimer = timerRef.current;
    if (!activeTimer.startTime || !activeTimer.projectId) return;
    if (!activeTimer.isRunning && !activeTimer.pendingStopAt) return;

    const startMs = new Date(activeTimer.startTime).getTime();
    const endMs = new Date(endIso).getTime();
    const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));

    const stoppedTimer: TimerState = { ...activeTimer, isRunning: false, pendingStopAt: endIso };
    applyTimer(stoppedTimer);
    persistTimer(stoppedTimer);

    const completed: Omit<TimeEntry, "id"> = {
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
    };

    try {
      let entry: TimeEntry;
      if (activeTimer.draftEntryId) {
        try {
          entry = await svc.updateTimeEntry(activeTimer.draftEntryId, {
            endTime: endIso,
            durationMinutes,
            description: activeTimer.description,
            ratio: activeTimer.ratio,
            taskId: activeTimer.taskId || undefined,
          });
        } catch (err) {
          // The draft row can be gone (deleted from the timesheet, another
          // tab, or by an admin). Falling back to a create keeps stop from
          // retrying an update that will 404 forever.
          if (!svc.isNotFoundError(err)) throw err;
          entry = await svc.createTimeEntry(completed);
        }
      } else {
        entry = await svc.createTimeEntry(completed);
      }
      applyTimer(RESET_TIMER);
      persistTimer(null);
      onStop(entry);
      return entry;
    } catch (err) {
      toast("Failed to save entry. Press Stop to retry.", "error");
      throw err;
    }
  }, [onStop, persistTimer, applyTimer, user.id, user.displayName, toast]);

  const stop = useCallback(() => stopAt(new Date().toISOString()), [stopAt]);

  // Returns true if there was actually a session to discard, so callers can
  // distinguish a real discard from a no-op (e.g. the idle modal firing after
  // the timer was already stopped by the 12h safety net or another tab).
  const cancel = useCallback(async (): Promise<boolean> => {
    // Ref for the same reason as stopAt: a draft id that arrived this tick
    // must still be deleted, or it lingers open as a phantom running timer.
    const active = timerRef.current;
    const hadSession = active.isRunning || !!active.pendingStopAt || !!active.draftEntryId;
    const draftId = active.draftEntryId;
    applyTimer(RESET_TIMER);
    persistTimer(null);
    // Discarding the session must also remove the draft row, or it would be
    // restored as a phantom running timer on the next reload. deleteTimeEntry
    // already retries transient failures and tolerates 404s.
    if (draftId) {
      await svc.deleteTimeEntry(draftId).catch(() => { /* best effort */ });
    }
    return hadSession;
  }, [applyTimer, persistTimer]);

  // Also applyTimer (see the invariant above): edits made here must be visible
  // to the async draft/stop paths immediately, not only after React commits —
  // otherwise a draft resolving in between reverts the user's edit. Reading
  // from the ref keeps successive updates in one tick composing correctly.
  const update = useCallback((patch: Partial<TimerState>) => {
    const next = { ...timerRef.current, ...patch };
    applyTimer(next);
    if (next.isRunning) persistTimer(next);
  }, [applyTimer, persistTimer]);

  return { timer, elapsed, start, stop, stopAt, cancel, update };
}
