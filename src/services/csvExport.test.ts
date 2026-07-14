import { describe, it, expect } from "vitest";
import { applyRounding, type RoundingRule } from "./csvExport";

describe("applyRounding", () => {
  it("passes exact minutes through unchanged", () => {
    expect(applyRounding(0, "exact")).toBe(0);
    expect(applyRounding(1, "exact")).toBe(1);
    expect(applyRounding(47, "exact")).toBe(47);
  });

  it("rounds up to the increment — any started increment bills whole", () => {
    expect(applyRounding(1, "up6")).toBe(6);
    expect(applyRounding(6, "up6")).toBe(6);
    expect(applyRounding(7, "up6")).toBe(12);
    expect(applyRounding(1, "up15")).toBe(15);
    expect(applyRounding(15, "up15")).toBe(15);
    expect(applyRounding(16, "up15")).toBe(30);
    expect(applyRounding(31, "up30")).toBe(60);
  });

  it("rounds to the nearest 15", () => {
    expect(applyRounding(7, "nearest15")).toBe(0);
    expect(applyRounding(8, "nearest15")).toBe(15);
    expect(applyRounding(22, "nearest15")).toBe(15);
    expect(applyRounding(23, "nearest15")).toBe(30);
  });

  it("never produces negative output and leaves zero at zero for every rule", () => {
    const rules: RoundingRule[] = ["exact", "up6", "up15", "up30", "nearest15"];
    for (const rule of rules) {
      expect(applyRounding(0, rule)).toBe(0);
      expect(applyRounding(-5, rule)).toBe(0);
    }
  });
});
