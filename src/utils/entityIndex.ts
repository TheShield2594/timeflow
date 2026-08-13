/** Index records by id so lookups inside render loops are O(1).
 *
 *  Grids, calendars and the timesheet search filter all need the project or
 *  task behind an entry. Doing that with `projects.find(...)` per row turns
 *  every render into O(rows × records) — on a wide range with thousands of
 *  entries the search filter alone was running roughly a million comparisons
 *  per keystroke (#96). Build the index once (memoized on the array) and read
 *  from it instead.
 */
export function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  // First one wins, so a duplicate id resolves to the same record `.find()`
  // used to return rather than silently flipping to the last.
  for (const item of items) if (!map.has(item.id)) map.set(item.id, item);
  return map;
}

/** Map lookup that tolerates the null/undefined ids entries carry — an entry
 *  with no task is the normal case, not a miss worth spelling out at every
 *  call site. */
export function byId<T>(index: Map<string, T>, id: string | null | undefined): T | undefined {
  return id == null ? undefined : index.get(id);
}
