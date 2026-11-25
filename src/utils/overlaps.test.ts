import { describe, it, expect } from "vitest";
import { findOverlapping, overlappingMinutes } from "./overlaps";
import type { TimeEntry } from "../types";

const D = "2026-11-17";
function e(id: string, start: string, end: string | undefined, description = id): TimeEntry {
  return {
    id, projectId: "p1", description, date: D,
    startTime: `${D}T${start}:00`, endTime: end ? `${D}T${end}:00` : undefined,
    durationMinutes: 0, userId: "u", userDisplayName: "U",
  };
}
const at = (hhmm: string, date = D) => new Date(`${date}T${hhmm}:00`);

describe("findOverlapping", () => {
  const day = [e("a", "09:00", "10:00"), e("b", "13:00", "15:30"), e("c", "11:00", "12:00")];

  it("finds the entries sharing time with a span, earliest first", () => {
    expect(findOverlapping(at("09:30"), at("14:00"), day).map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("treats touching ends as back-to-back, not overlapping", () => {
    expect(findOverlapping(at("10:00"), at("11:00"), day)).toEqual([]);
  });

  it("leaves out the entry being edited, and open drafts", () => {
    const withDraft = [...day, e("run", "09:00", undefined)];
    expect(findOverlapping(at("09:00"), at("10:00"), withDraft, "a")).toEqual([]);
  });

  it("finds nothing for an empty or inverted span", () => {
    expect(findOverlapping(at("10:00"), at("09:00"), day)).toEqual([]);
  });
});

describe("overlappingMinutes", () => {
  it("is zero for a day of back-to-back entries", () => {
    expect(overlappingMinutes([e("a", "09:00", "10:00"), e("b", "10:00", "11:00")])).toBe(0);
  });

  it("is the time a summed total overstates the day by", () => {
    // The review's case: an 8-hour entry laid over a normal day.
    const day = [e("a", "09:00", "12:00"), e("b", "13:00", "17:00"), e("over", "09:00", "17:00")];
    expect(overlappingMinutes(day)).toBe(7 * 60);
  });

  it("counts a triple-stacked hour twice over", () => {
    expect(overlappingMinutes([e("a", "09:00", "10:00"), e("b", "09:00", "10:00"), e("c", "09:00", "10:00")])).toBe(120);
  });

  it("measures elapsed time across a DST change, not clock readings", () => {
    // 2026-11-01 falls back in New York: 01:00–02:00 happens twice. Two
    // entries spanning 00:30–02:30 on the wall clock each ran three hours.
    const fallBack = "2026-11-01";
    const a: TimeEntry = { ...e("a", "00:30", "02:30"), date: fallBack,
      startTime: `${fallBack}T00:30:00`, endTime: `${fallBack}T02:30:00` };
    const b: TimeEntry = { ...a, id: "b" };
    expect(overlappingMinutes([a, b])).toBe(180);
  });
});
