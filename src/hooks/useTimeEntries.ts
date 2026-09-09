import { useState, useEffect, useCallback, useRef } from "react";
import type { NewTimeEntry, TimeEntry } from "../types";
import * as svc from "../services/dataverseService";
import { getCurrentUser } from "../services/userService";
import { reportTelemetry } from "../services/telemetry";
import { useToast } from "../contexts/ToastContext";
import { tempId, isTempId, errMsg } from "./_shared";
import { addDaysStr } from "../utils/dates";

// sessionStorage (not a ref) so the "warn once per session" guard survives
// this hook's component unmounting/remounting, not just re-renders of one
// mounted instance. Scoped per environment + user id so switching accounts
// within the same browser session, or between Power Apps environments that
// share an origin (Dev/QA/Prod), doesn't suppress a warning that applies to
// a different environment or user.
function isolationWarningKey(environmentId: string, userId: string): string {
  return `tt_isolation_warned:${environmentId}:${userId}`;
}

/**
 * The span of dates currently held in `entries`. Bounds are inclusive
 * YYYY-MM-DD, whose lexicographic order is chronological order.
 */
interface Covered { from: string; to: string }

/**
 * The parts of `want` that `covered` doesn't already hold — none, one side,
 * or (when the two don't overlap at all) the whole thing.
 *
 * The point is the widening case. `resolveDateRange` on Reports' "All time"
 * yields 1970→9999, and the old behavior was to re-read the entire range from
 * scratch — up to MAX_PAGES × FETCH_PAGE_SIZE = 100,000 rows — throwing away
 * the 90 days already in hand, and then to do it again on the way back (#115).
 */
export function uncoveredSpans(covered: Covered | null, want: Covered): Covered[] {
  if (!covered) return [want];
  // Disjoint: nothing to reuse, and stitching two spans with a hole between
  // them would leave `entries` claiming a range it doesn't hold.
  if (want.to < covered.from || want.from > covered.to) return [want];
  const spans: Covered[] = [];
  if (want.from < covered.from) spans.push({ from: want.from, to: prevDay(covered.from) });
  if (want.to > covered.to) spans.push({ from: nextDay(covered.to), to: want.to });
  return spans;
}

function prevDay(date: string): string { return addDaysStr(date, -1); }
function nextDay(date: string): string { return addDaysStr(date, 1); }

/** Union of two spans known to overlap or abut. */
function widen(covered: Covered | null, want: Covered): Covered {
  if (!covered) return want;
  return {
    from: want.from < covered.from ? want.from : covered.from,
    to: want.to > covered.to ? want.to : covered.to,
  };
}

/** Newest first, and last-write-wins per id, so a re-read of a span replaces
 *  the rows it previously contributed rather than doubling them. */
function mergeById(existing: TimeEntry[], incoming: TimeEntry[]): TimeEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.startTime.localeCompare(a.startTime));
}

export function useTimeEntries(from?: string, to?: string) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // Distinct from `loading` (first paint only): true for every fetch,
  // including re-fetches triggered by ensureRangeLoaded widening from/to,
  // so pages can show an inline indicator without unmounting their content.
  const [isFetching, setIsFetching] = useState(false);
  /**
   * Sticky once set, and never cleared for the life of the session.
   *
   * A row-security misconfiguration doesn't come and go: once one foreign row
   * has been read, everything on every screen is suspect until an
   * administrator has looked at the table. The banner it raises is the only
   * full-width alarm in the app, and the only one that cannot be dismissed.
   */
  const [isolationBreach, setIsolationBreach] = useState(false);
  const toast = useToast();

  const entriesRef = useRef<TimeEntry[]>([]);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  const seqRef = useRef(0);
  const coveredRef = useRef<Covered | null>(null);

  /**
   * Check a batch of rows for entries belonging to somebody else.
   *
   * Runs on every batch, delta reads included: the server-side eq-userid
   * filter is what makes this impossible, so a foreign row in *any* response
   * is the signal, not a foreign row in a full one.
   */
  const assertOwnRows = useCallback((rows: TimeEntry[]) => {
    try {
      const currentUser = getCurrentUser();
      sessionStorage.removeItem(`tt_isolation_warned:${currentUser.id}`);
      const warningKey = isolationWarningKey(currentUser.environmentId, currentUser.id);
      if (!svc.hasForeignUserEntries(rows, currentUser.id)) return;
      // The banner is raised on every detection; the sessionStorage key only
      // de-duplicates the *telemetry*, which is a report about a
      // configuration and not a per-read event.
      setIsolationBreach(true);
      if (!sessionStorage.getItem(warningKey)) {
        sessionStorage.setItem(warningKey, "1");
        // Reported, not just logged. This is the one signal in the app that
        // means the whole company's time data may be cross-visible, and until
        // #111 it reached exactly one person: whoever happened to be looking
        // at their own console when it fired.
        reportTelemetry({
          name: "data_isolation_personal",
          severity: "error",
          message:
            "getTimeEntries() returned time entries belonging to other users — Dataverse row-level " +
            "security for ever_timeentries is misconfigured (see README \"Dataverse Security Configuration\")",
          props: {
            rowsReturned: rows.length,
            foreignRows: rows.filter((e) => e.userId && e.userId !== currentUser.id).length,
          },
        });
      }
    } catch {
      // Never let a failure in the isolation-warning check (e.g. sessionStorage
      // unavailable) mask the data load that already succeeded above.
    }
  }, []);

  /**
   * Load `from`..`to`, reading only what isn't already held.
   *
   * `force` re-reads the whole window and replaces what's in memory — the
   * refresh path, where the point is to pick up somebody else's changes.
   *
   * There is deliberately no AbortController here: the generated SDK's
   * `ListRecordsWithOrganization` takes no signal, so a superseded request
   * cannot be cancelled, only ignored (the `seq` guard below). What the delta
   * read fixes is the part that *is* in our control — not issuing the
   * redundant work in the first place. Rapid preset-switching on Reports used
   * to fire overlapping full-history reads; now the second one asks for
   * nothing (#115).
   */
  const load = useCallback(async (force: boolean) => {
    // Unbounded call: the service picks its own default window, so there is
    // no span arithmetic to do and nothing to record as covered.
    const want: Covered | null = from && to ? { from, to } : null;
    const spans = !want || force
      ? [want]
      : uncoveredSpans(coveredRef.current, want);
    if (spans.length === 0) {
      // Everything asked for is already in memory — the narrowing case, and
      // the return trip from a wide preset. No request, no spinner.
      setLoading(false);
      return;
    }

    const seq = ++seqRef.current;
    setIsFetching(true);
    try {
      const results = await Promise.all(
        spans.map((span) => svc.getTimeEntries(span ? { from: span.from, to: span.to } : {}))
      );
      if (seq !== seqRef.current) return;
      const fetched = results.flatMap((r) => r.items);
      const replace = force || !want;
      // A forced refresh replaces; a delta read merges onto what's held. Both
      // are keyed by id, so a row that moved out of its old span still
      // resolves to one entry rather than two.
      setEntries((prev) => (replace ? fetched : mergeById(prev, fetched)));
      coveredRef.current = !want ? null : force ? want : widen(coveredRef.current, want);
      // Handed back by the read rather than pushed through a module-global
      // handler the app wired up on mount — that global was last-writer-wins
      // and wasn't guaranteed to be set during bootstrap, which is exactly
      // when the first (widest) read happens (#115).
      const truncated = results.find((r) => r.truncated)?.truncated;
      if (truncated) {
        toast(truncated.message, "error");
        // A short read means the covered span has holes in it, so it can't be
        // used to skip later reads. Claiming coverage we don't have is how a
        // missing entry would become permanently missing for the session.
        coveredRef.current = null;
      }
      assertOwnRows(fetched);
    } catch (err) {
      if (seq !== seqRef.current) return;
      // Same reasoning: a failed span leaves a hole, so nothing is covered.
      if (!force) coveredRef.current = null;
      toast(`Could not load entries: ${errMsg(err)}`, "error");
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
        setIsFetching(false);
      }
    }
  }, [from, to, toast, assertOwnRows]);

  /** Re-read the current window from the server, discarding what's held. */
  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => { load(false); }, [load]);

  const deleteEntry = useCallback(async (id: string) => {
    const idx = entriesRef.current.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const snapshot = entriesRef.current[idx];
    // A temp id is either an in-flight create or one whose response body was
    // dropped — in both cases a row may exist server-side that this delete
    // can't name, and deleteTimeEntry treats the resulting 404 as success, so
    // the entry would vanish locally and come back on the next load.
    if (isTempId(id)) {
      toast("Entry is still saving — please wait a moment and try again", "error");
      throw new Error("Entry not yet saved");
    }
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

  const createEntry = useCallback(async (data: NewTimeEntry) => {
    // Ownership is the service's to stamp, but the optimistic row has to
    // render before the service replies — so it borrows the resolved user
    // here rather than making every caller pass a copy (#115).
    const user = getCurrentUser();
    const optimistic: TimeEntry = {
      ...data, id: tempId(), userId: user.id, userDisplayName: user.displayName,
    };
    setEntries((prev) => [optimistic, ...prev]);
    try {
      const real = await svc.createTimeEntry(data);
      if (!real.id) {
        // Dropped response body: the row exists server-side but we don't know
        // its id. `id: ""` would make Edit/Delete on the new row PATCH or
        // DELETE the collection itself, so keep the temp id (editEntry's guard
        // then explains the wait) and re-read the range to reconcile.
        const pending = { ...real, id: optimistic.id };
        setEntries((prev) => prev.map((e) => (e.id === optimistic.id ? pending : e)));
        refresh();
        return pending;
      }
      setEntries((prev) => prev.map((e) => (e.id === optimistic.id ? real : e)));
      return real;
    } catch (err) {
      setEntries((prev) => prev.filter((e) => e.id !== optimistic.id));
      toast(`Could not save entry: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [refresh, toast]);

  const editEntry = useCallback(async (id: string, data: Partial<TimeEntry>) => {
    const snapshot = entriesRef.current.find((e) => e.id === id);
    if (!snapshot) throw new Error("Entry not found");
    if (isTempId(id)) {
      toast("Entry is still saving — please wait a moment and try again", "error");
      throw new Error("Entry not yet saved");
    }
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...data } : e)));
    try {
      const updated = await svc.updateTimeEntry(id, data);
      // Merged over the existing entry rather than replacing it: with a dropped
      // response body `updated` holds only the patched fields, and a wholesale
      // swap would blank the rest of the row. The merged entry is returned too,
      // so callers get the whole TimeEntry this signature promises.
      const merged = { ...snapshot, ...updated };
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...updated } : e)));
      return merged;
    } catch (err) {
      setEntries((prev) => prev.map((e) => (e.id === id ? snapshot : e)));
      toast(`Could not save changes: ${errMsg(err)}`, "error");
      throw err;
    }
  }, [toast]);

  return { entries, loading, isFetching, isolationBreach, refresh, deleteEntry, createEntry, editEntry };
}
