/**
 * Rounding for numbers that are displayed *together* and read as a set.
 *
 * Rounding each value on its own is right when a number stands alone and wrong
 * the moment it sits in a column someone can add up by hand. Three 50-minute
 * cells each print as 0.8 while their true total prints as 2.5, and the
 * timesheet looks like it lost six minutes (#93); three equal projects each
 * round to 33% and the breakdown visibly sums to 99% (#113). Both are the same
 * bug, so both go through here.
 */

/**
 * Largest-remainder (Hare–Niemeyer) allocation: whole numbers, one per entry
 * of `exact`, summing to exactly `target`.
 *
 * Each result is `floor(exact[i])` plus at most one unit, handed out to the
 * largest fractional parts first — so no single value is moved by a full unit
 * and the total is exact rather than merely close. Ties go to the earlier
 * entry, because a report that reshuffled its rounding between renders would
 * be worse than one that is consistently off.
 *
 * `target` is expected to be a rounding of `Σ exact` (that is what makes the
 * allocation representable); the surplus branch below only exists so a caller
 * that breaks that assumption still gets a total it asked for rather than a
 * silently wrong one.
 */
export function allocateLargestRemainder(exact: number[], target: number): number[] {
  const result = exact.map((v) => Math.floor(v));
  let deficit = target - result.reduce((s, v) => s + v, 0);
  if (deficit === 0) return result;

  const byRemainder = exact
    .map((v, i) => ({ i, remainder: v - Math.floor(v) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);

  // Only entries with something left over can take a unit. A cell holding
  // exactly zero minutes must stay zero — printing 0.1h of time nobody logged
  // is a worse lie than a column that is one increment short.
  for (const { i, remainder } of byRemainder) {
    if (deficit <= 0 || remainder <= 0) break;
    result[i] += 1;
    deficit -= 1;
  }
  for (let k = byRemainder.length - 1; k >= 0 && deficit < 0; k--) {
    const i = byRemainder[k].i;
    if (result[i] <= 0) continue;
    result[i] -= 1;
    deficit += 1;
  }
  return result;
}

/**
 * Whole percentages of `total`, one per entry of `values`, summing to the
 * rounded share the values actually account for.
 *
 * Deliberately not always 100: rows can be dropped before display (an entry
 * whose project has since vanished), and inflating what is left to fill the
 * gap would quietly reassign that time to projects it was never logged
 * against.
 */
export function allocatePercentages(values: number[], total: number): number[] {
  if (total <= 0) return values.map(() => 0);
  const shares = values.map((v) => (v / total) * 100);
  const target = Math.round(shares.reduce((s, v) => s + v, 0));
  return allocateLargestRemainder(shares, target);
}
