import { useCallback } from "react";
import type { TimeEntry } from "../types";
import { useData } from "../contexts/DataContext";
import { useDataRange } from "../contexts/DataRangeContext";

/**
 * Entries on a local YYYY-MM-DD date — or null when that date sits outside the
 * window currently loaded.
 *
 * The null matters wherever a day is *drawn*. An unloaded day and a day with
 * nothing logged on it both hold zero entries, and a day bar that can't tell
 * them apart answers "what does 3 March look like?" with a confident, entirely
 * invented eight hours of untracked time. The sheet's date field (#151) is
 * what made that reachable: before it, every day a sheet drew was one the page
 * had already fetched.
 */
export function useEntriesOnDate(): (date: string) => TimeEntry[] | null {
  const { entries } = useData();
  const { from, to } = useDataRange();
  // Both bounds are YYYY-MM-DD, whose lexicographic order is chronological.
  return useCallback(
    (date: string) => (date >= from && date <= to ? entries.filter((e) => e.date === date) : null),
    [entries, from, to]
  );
}
