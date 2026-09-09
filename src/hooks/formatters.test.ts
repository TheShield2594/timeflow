import { describe, it, expect } from "vitest";
import { formatElapsed, formatMinutes, formatDecimalHours, parseRatioInput } from "./formatters";

describe("formatElapsed", () => {
  it("zero-pads each field", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
    expect(formatElapsed(5)).toBe("00:00:05");
    expect(formatElapsed(65)).toBe("00:01:05");
    expect(formatElapsed(3725)).toBe("01:02:05");
  });

  it("counts past 24 hours instead of wrapping", () => {
    // A timer left running overnight is a real state (#105 restores one), and
    // showing it as 01:00:00 would read as an hour of work.
    expect(formatElapsed(25 * 3600)).toBe("25:00:00");
  });

  it("clamps a backwards clock to zero rather than rendering -1:-1:-5 (#114)", () => {
    // padStart never widens a "-1", so the negative leaks through unpadded.
    // This is what a restored server draft whose startTime is a few seconds
    // ahead of the client (skew, or a user correcting their clock) produces.
    expect(formatElapsed(-5)).toBe("00:00:00");
    expect(formatElapsed(-3725)).toBe("00:00:00");
  });

  it("treats a non-finite input as zero", () => {
    expect(formatElapsed(NaN)).toBe("00:00:00");
    expect(formatElapsed(Infinity)).toBe("00:00:00");
  });
});

describe("formatMinutes", () => {
  it("drops the empty half of the pair", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(150)).toBe("2h 30m");
  });

  it("zero-pads the minutes beside an hour, so a column of them lines up", () => {
    // "2h 5m" under "2h 41m" puts two different digits in the same tabular
    // figure and the column stops aligning. Alone, "05m" would be a leading
    // zero nobody asked for.
    expect(formatMinutes(125)).toBe("2h 05m");
    expect(formatMinutes(5)).toBe("5m");
  });

  it("clamps negatives instead of emitting '-2h -30m' (#114)", () => {
    expect(formatMinutes(-90)).toBe("0m");
  });

  it("floors a fractional minute count", () => {
    expect(formatMinutes(90.7)).toBe("1h 30m");
  });
});

describe("formatDecimalHours", () => {
  it("defaults to one decimal — the billing increment", () => {
    expect(formatDecimalHours(90)).toBe("1.5");
    expect(formatDecimalHours(6)).toBe("0.1");
  });

  it("honours an explicit digit count, as the CSV export passes", () => {
    expect(formatDecimalHours(95, 2)).toBe("1.58");
  });

  it("clamps negatives (#114)", () => {
    expect(formatDecimalHours(-90)).toBe("0.0");
  });
});

describe("parseRatioInput", () => {
  it("reads blank as 'unset' rather than zero", () => {
    expect(parseRatioInput("")).toBeUndefined();
    expect(parseRatioInput("   ")).toBeUndefined();
  });

  it("rounds to a non-negative whole account number (#71)", () => {
    expect(parseRatioInput("7")).toBe(7);
    expect(parseRatioInput("7.4")).toBe(7);
    expect(parseRatioInput("7.6")).toBe(8);
    expect(parseRatioInput("-3")).toBe(0);
  });

  it("returns undefined for input that isn't a number", () => {
    expect(parseRatioInput("abc")).toBeUndefined();
  });
});
