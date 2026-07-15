import { useState, useEffect, useCallback, useRef } from "react";
import type { TimeEntry } from "../types";
import * as svc from "../services/dataverseService";
import { getCurrentUser } from "../services/userService";
import { useToast } from "../contexts/ToastContext";
import { tempId, errMsg } from "./_shared";

// sessionStorage (not a ref) so the "warn once per session" guard survives
// this hook's component unmounting/remounting, not just re-renders of one
// mounted instance. Scoped per environment + user id so switching accounts
// within the same browser session, or between Power Apps environments that
// share an origin (Dev/QA/Prod), doesn't suppress a warning that applies to
// a different environment or user.
function isolationWarningKey(environmentId: string, userId: string): string {
  return `tt_isolation_warned:${environmentId}:${userId}`;
}

export function useTimeEntries(from?: string, to?: string) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // Distinct from `loading` (first paint only): true for every fetch,
  // including re-fetches triggered by ensureRangeLoaded widening from/to,
  // so pages can show an inline indicator without unmounting their content.
  const [isFetching, setIsFetching] = useState(false);
  const toast = useToast();

  const entriesRef = useRef<TimeEntry[]>([]);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    setIsFetching(true);
    try {
      const data = await svc.getTimeEntries({ from, to });
      if (seq !== seqRef.current) return;
      setEntries(data);
      try {
        const currentUser = getCurrentUser();
        sessionStorage.removeItem(`tt_isolation_warned:${currentUser.id}`);
        const warningKey = isolationWarningKey(currentUser.environmentId, currentUser.id);
        if (!sessionStorage.getItem(warningKey) && svc.hasForeignUserEntries(data, currentUser.id)) {
          sessionStorage.setItem(warningKey, "1");
          console.error(
            "[security] getTimeEntries() returned time entries belonging to other users. " +
            "Dataverse row-level security for ever_timeentries is misconfigured — see README \"Dataverse Security Configuration\"."
          );
          toast("Data isolation warning: you may be seeing other users' time entries. Contact your administrator.", "error");
        }
      } catch {
        // Never let a failure in the isolation-warning check (e.g. sessionStorage
        // unavailable) mask the data load that already succeeded above.
      }
    } catch (err) {
      if (seq !== seqRef.current) return;
      toast(`Could not load entries: ${errMsg(err)}`, "error");
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
        setIsFetching(false);
      }
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

  return { entries, loading, isFetching, refresh, deleteEntry, createEntry, editEntry };
}
