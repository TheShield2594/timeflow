import { describe, it, expect } from "vitest";
import { allocateLargestRemainder, allocatePercentages } from "./rounding";

describe("allocateLargestRemainder", () => {
  it("hits the target exactly where independent rounding would not", () => {
    // Three 50-minute cells in tenths of an hour: 8.33 each, 25 in total.
    const out = allocateLargestRemainder([50 / 6, 50 / 6, 50 / 6], 25);
    expect(out.reduce((s, v) => s + v, 0)).toBe(25);
    expect(out).toEqual([9, 8, 8]);
  });

  it("gives the spare units to the largest remainders", () => {
    const out = allocateLargestRemainder([1.9, 1.1, 1.5], 5);
    expect(out).toEqual([2, 1, 2]);
  });

  it("breaks ties toward the earlier entry, so a re-render can't reshuffle it", () => {
    const first = allocateLargestRemainder([0.5, 0.5, 0.5], 2);
    expect(first).toEqual([1, 1, 0]);
    expect(allocateLargestRemainder([0.5, 0.5, 0.5], 2)).toEqual(first);
  });

  it("never invents a unit for an entry that is exactly zero", () => {
    const out = allocateLargestRemainder([0, 0, 2.4, 1.6], 4);
    expect(out).toEqual([0, 0, 2, 2]);
  });

  it("leaves an already-exact allocation alone", () => {
    expect(allocateLargestRemainder([3, 2, 1], 6)).toEqual([3, 2, 1]);
  });

  it("handles the empty set", () => {
    expect(allocateLargestRemainder([], 0)).toEqual([]);
  });

  // Defensive path: a target below the floors can only come from a caller
  // passing something that isn't a rounding of the sum. It still has to add up.
  it("takes units back, from the smallest remainders, if the target is short", () => {
    const out = allocateLargestRemainder([2.9, 2.1], 3);
    expect(out.reduce((s, v) => s + v, 0)).toBe(3);
    expect(out).toEqual([2, 1]);
  });

  it("does not push an entry negative to reach an impossible target", () => {
    const out = allocateLargestRemainder([0, 0], -5);
    expect(out).toEqual([0, 0]);
  });
});

describe("allocatePercentages", () => {
  it("sums to 100 for equal shares instead of 99 (#113)", () => {
    const out = allocatePercentages([60, 60, 60], 180);
    expect(out).toEqual([34, 33, 33]);
    expect(out.reduce((s, v) => s + v, 0)).toBe(100);
  });

  it("sums to 100 across an awkward split", () => {
    const out = allocatePercentages([1, 1, 1, 1, 1, 1, 1], 7);
    expect(out.reduce((s, v) => s + v, 0)).toBe(100);
  });

  it("stops short of 100 when the values don't account for the whole total", () => {
    // 40 of the 100 minutes belong to a row that isn't being displayed.
    const out = allocatePercentages([30, 30], 100);
    expect(out).toEqual([30, 30]);
  });

  it("is all zeroes rather than NaN when there is no total to divide by", () => {
    expect(allocatePercentages([0, 0], 0)).toEqual([0, 0]);
  });
});
