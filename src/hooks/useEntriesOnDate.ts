import { useCallback } from "react";
import type { TimeEntry } from "../types";
import { useData } from "../contexts/DataContext";
import { holdsRange } from "./useRangeStatus";

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
 *
 * "Loaded" means held, not requested. The requested window widens the moment
 * a page asks, a fetch later; if that fetch fails or is cut short it never
 * arrives at all. Reading the request here drew those days as empty (#187).
 */
export function useEntriesOnDate(): (date: string) => TimeEntry[] | null {
  const { entries, loadedRange } = useData();
  return useCallback(
    (date: string) => (holdsRange(loadedRange, date, date) ? entries.filter((e) => e.date === date) : null),
    [entries, loadedRange]
  );
}
