import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { addDaysStr } from "../utils/dates";
import { useToday } from "../hooks/useToday";

const INITIAL_DAYS_LOADED = 90;

interface DataRangeApi {
  from: string;
  to: string;
  /**
   * Declare the range a page needs, under a key that is stable for that page.
   * Re-declaring with the same key *replaces* the previous request rather than
   * union-ing with it, which is what lets the effective range shrink again.
   */
  requestRange: (key: string, from: string, to: string) => void;
  /** Drop a page's request — its range no longer holds the window open. */
  releaseRange: (key: string) => void;
}

const DataRangeCtx = createContext<DataRangeApi | null>(null);

interface Request { from: string; to: string }

export const DataRangeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const today = useToday();
  const [requests, setRequests] = useState<Record<string, Request>>({});

  const requestRange = useCallback((key: string, from: string, to: string) => {
    setRequests((prev) => {
      const cur = prev[key];
      if (cur && cur.from === from && cur.to === to) return prev;
      return { ...prev, [key]: { from, to } };
    });
  }, []);

  const releaseRange = useCallback((key: string) => {
    setRequests((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _dropped, ...rest } = prev;
      return rest;
    });
  }, []);

  // Effective range = the baseline window ∪ every *currently active* request.
  //
  // The baseline is the last INITIAL_DAYS_LOADED days and is never given up,
  // so ordinary page-to-page navigation (all of which asks for windows inside
  // it) never triggers a refetch. Anything wider — Reports' "All time", the
  // calendar paged back a year — holds only while that page is asking for it.
  // Before #74 the range was a running maximum that could only grow: one visit
  // to "All time" pinned every later fetch to the user's entire history for
  // the rest of the session, even back on the 7-day preset.
  //
  // Both bounds are YYYY-MM-DD, whose lexicographic order matches chronological
  // order, so plain string comparison computes the min/max correctly.
  const { from, to } = useMemo(() => {
    let lo = addDaysStr(today, -(INITIAL_DAYS_LOADED - 1));
    let hi = today;
    for (const req of Object.values(requests)) {
      if (req.from < lo) lo = req.from;
      if (req.to > hi) hi = req.to;
    }
    return { from: lo, to: hi };
  }, [requests, today]);

  const value = useMemo(
    () => ({ from, to, requestRange, releaseRange }),
    [from, to, requestRange, releaseRange]
  );

  return <DataRangeCtx.Provider value={value}>{children}</DataRangeCtx.Provider>;
};

export function useDataRange(): DataRangeApi {
  const ctx = useContext(DataRangeCtx);
  if (!ctx) throw new Error("useDataRange must be used inside DataRangeProvider");
  return ctx;
}

/**
 * Hold the given range open for as long as the calling component is mounted
 * and still asking for it. Releasing on unmount is the whole point: it's what
 * lets a page's wide request stop costing anything once the user leaves it.
 */
export function useRangeRequest(key: string, from: string, to: string): void {
  const { requestRange, releaseRange } = useDataRange();
  useEffect(() => {
    // An empty bound would compare below/above every real date and widen the
    // window to everything — treat "not resolved yet" as "nothing to ask for".
    if (!from || !to) return;
    requestRange(key, from, to);
    return () => releaseRange(key);
  }, [key, from, to, requestRange, releaseRange]);
}
