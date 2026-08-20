import { useState, useEffect, useCallback, useRef } from "react";
import type { NewTimeEntry, TimeEntry, TimerState } from "../types";
import * as svc from "../services/dataverseService";
import { getCurrentUser } from "../services/userService";
import { useToast } from "../contexts/ToastContext";
import { localDateStr } from "../utils/dates";

const TIMER_KEY_PREFIX = "tt_active_timer:";

const RESET_TIMER: TimerState = {
  isRunning: false, startTime: null, projectId: null, taskId: null, description: "",
  ratio: undefined, jiraTicket: undefined,
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
  // No elapsed-seconds counter lives here, deliberately. This hook is called
  // in AppContent, so a 1 Hz tick in it re-rendered the whole page tree — on
  // the Calendar, ~720 element diffs every second for the entire length of a
  // tracked session, to update one span of text (#95). `startTime` is the
  // whole state a countdown needs; whoever displays one derives it and ticks
  // at its own level, where the re-render is confined to the digits.

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
  // applyTimer is stable (a useCallback over setState only); listing it would
  // not change when this listener is bound.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        jiraTicket: open.jiraTicket,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Open a session: apply it locally, then write its draft row.
   *
   * Shared by `start` (start time = now) and `restore` (start time = whatever
   * the discarded session had), because everything after the start time is
   * identical — including the raced-stop cleanup below, which is what keeps a
   * draft from being stranded open and coming back as a phantom running timer.
   *
   * Resolves once the draft create has settled, so a caller that needs the row
   * to exist before it refreshes the timesheet can wait for it.
   */
  const beginSession = useCallback(async (session: TimerState): Promise<void> => {
    applyTimer(session);
    persistTimer(session);

    let draftEntryId: string | null = null;
    try {
      draftEntryId = await svc.createDraftTimerEntry({
        projectId: session.projectId!,
        taskId: session.taskId,
        description: session.description,
        startTime: session.startTime!,
        date: localDateStr(new Date(session.startTime!)),
        ratio: session.ratio,
        jiraTicket: session.jiraTicket,
      });
    } catch {
      return; // non-critical
    }
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
    if (!current.isRunning || current.startTime !== session.startTime) {
      await svc.deleteTimeEntry(draftEntryId).catch(() => { /* best effort */ });
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
  }, [applyTimer, persistTimer]);

  const start = useCallback((
    projectId: string,
    taskId: string | null,
    description: string,
    ratio?: number,
    jiraTicket?: string,
  ) => {
    if (!projectId) {
      toast("Pick a project before starting the timer.", "error");
      return;
    }
    // The ref, not the render snapshot — the same rule stopAt/cancel/update
    // follow, and for the same reason. Two start() calls inside one React
    // batch (a double-click on Start, or a click racing the Ctrl+. handler)
    // both read `isRunning: false` from the closed-over state, both pass this
    // guard, and both create a draft row; the second applyTimer overwrites the
    // first, stranding an open draft that comes back on the next reload as a
    // phantom running timer (#94). A cancel() in the same tick had the mirror
    // problem: the snapshot still said "running" and rejected the restart.
    const current = timerRef.current;
    if (current.isRunning || current.pendingStopAt) {
      toast("Timer is already running. Stop it first.", "error");
      return;
    }
    void beginSession({
      isRunning: true,
      startTime: new Date().toISOString(),
      projectId,
      taskId,
      description,
      ratio,
      jiraTicket,
    });
  }, [beginSession, toast]);

  /**
   * Re-open a discarded session on its original start time — the undo behind
   * the idle prompt's "Discard session" (#105).
   *
   * The draft row was deleted by `cancel`, so this writes a fresh one; nothing
   * else about the session changes, which is why the clock picks up where it
   * left off instead of restarting from zero. Resolves false if it couldn't
   * run, so the caller doesn't claim a restore that didn't happen.
   */
  const restore = useCallback(async (session: TimerState): Promise<boolean> => {
    if (!session.startTime || !session.projectId) return false;
    // Same ref-not-snapshot rule as start(). The realistic race here is a
    // user who discards, starts something new, and only then reaches for
    // Restore — the new session is the one they're in, so it wins.
    const current = timerRef.current;
    if (current.isRunning || current.pendingStopAt) {
      toast("Timer is already running. Stop it first.", "error");
      return false;
    }
    await beginSession({ ...session, isRunning: true, pendingStopAt: undefined, draftEntryId: undefined });
    return true;
  }, [beginSession, toast]);

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

    // No userId/userDisplayName: the service stamps ownership from the
    // resolved current user and overwrites anything passed here (#115).
    const completed: NewTimeEntry = {
      projectId: activeTimer.projectId,
      taskId: activeTimer.taskId || undefined,
      description: activeTimer.description,
      startTime: activeTimer.startTime,
      endTime: endIso,
      durationMinutes,
      ratio: activeTimer.ratio,
      jiraTicket: activeTimer.jiraTicket,
      date: localDateStr(new Date(activeTimer.startTime)),
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
            jiraTicket: activeTimer.jiraTicket,
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
  }, [onStop, persistTimer, applyTimer, toast]);

  const stop = useCallback(() => stopAt(new Date().toISOString()), [stopAt]);

  // Returns the session it discarded, or null if there was nothing to discard
  // (e.g. the idle modal firing after the timer was already stopped by the 12h
  // safety net or another tab). Callers need the distinction to avoid claiming
  // a discard that didn't happen — and they need the session itself, because
  // discarding is the one destructive action here whose undo has to rebuild
  // what it deleted rather than reactivate it (#105).
  const cancel = useCallback(async (): Promise<TimerState | null> => {
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
    return hadSession ? active : null;
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

  return { timer, start, stop, stopAt, cancel, restore, update };
}
