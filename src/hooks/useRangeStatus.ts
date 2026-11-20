import { useData } from "../contexts/DataContext";

export type RangeStatus = "ready" | "loading" | "failed";

/** Whether `loaded` holds every day of `from`..`to`. YYYY-MM-DD compares
 *  chronologically as a string. */
export function holdsRange(
  loaded: { from: string; to: string } | null,
  from: string,
  to: string,
): boolean {
  return loaded !== null && loaded.from <= from && loaded.to >= to;
}

/**
 * Whether a page can believe what it sums over `from`..`to`.
 *
 * Requesting a range (`useRangeRequest`) is not the same as having it. Until
 * the read lands — or for good, if it fails or comes back short — `entries`
 * holds only part of the window, and a figure summed from it is a wrong
 * number that looks exactly like a right one (#187).
 *
 * "Not held, not fetching, last read failed" is the only state reported as
 * failed. Everything else that isn't held is loading, including the one
 * render between a page widening its request and the fetch starting, so that
 * frame shows a pending figure rather than an error.
 */
export function useRangeStatus(from: string, to: string): RangeStatus {
  const { loadedRange, rangeLoading, rangeLoadFailed } = useData();
  if (holdsRange(loadedRange, from, to)) return "ready";
  return rangeLoadFailed && !rangeLoading ? "failed" : "loading";
}
