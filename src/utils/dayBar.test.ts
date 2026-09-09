import { describe, it, expect } from "vitest";
import { axisLabels, buildDaySpans, dayWindow } from "./dayBar";
import type { Project, TimeEntry } from "../types";

/**
 * The bar is a flex track, so every segment's width is a share of the whole.
 * That only reads honestly if the segments add up to the window exactly:
 * a missing minute makes every other segment slightly too wide, and an extra
 * one makes the day look longer than it was.
 */
const DATE = "2026-09-08";
const projects: Project[] = [
  { id: "p1", name: "Alpha", color: "#719500", isActive: true, createdAt: "" },
  { id: "p2", name: "Beta", color: "#00739F", isActive: true, createdAt: "" },
];

function entry(id: string, from: string, to: string | null, projectId = "p1"): TimeEntry {
  return {
    id, projectId, date: DATE,
    startTime: `${DATE}T${from}:00`,
    endTime: to ? `${DATE}T${to}:00` : undefined,
    durationMinutes: to ? 60 : undefined,
    userId: "u1", userDisplayName: "U",
  };
}

const build = (entries: TimeEntry[], window = { startMin: 480, endMin: 1080 }, gaps = []) =>
  buildDaySpans({
    entries, projects, date: DATE, nowMinutes: 1080, window, gaps,
    describeEntry: (e) => e.id,
  });

describe("dayWindow", () => {
  it("is the working day when everything was logged inside it", () => {
    expect(dayWindow([entry("a", "09:00", "10:00")], DATE, 1080, 480, 1080))
      .toEqual({ startMin: 480, endMin: 1080 });
  });

  it("stretches out to the hour to cover work outside working hours", () => {
    // 06:30 → 20:15 has to fit, or the bar draws a day shorter than the one
    // that was actually worked.
    const window = dayWindow(
      [entry("a", "06:30", "07:00"), entry("b", "19:00", "20:15")],
      DATE, 1080, 480, 1080
    );
    expect(window).toEqual({ startMin: 6 * 60, endMin: 21 * 60 });
  });

  it("still has width when the working day is configured to nothing", () => {
    expect(dayWindow([], DATE, 1080, 600, 600).endMin).toBeGreaterThan(600);
  });
});

describe("buildDaySpans", () => {
  const totalOf = (spans: { startMin: number; endMin: number }[]) =>
    spans.reduce((sum, s) => sum + (s.endMin - s.startMin), 0);

  it("adds up to the window, with no holes and no overlaps", () => {
    const spans = build([entry("a", "09:00", "10:00"), entry("b", "13:00", "15:00", "p2")]);
    expect(totalOf(spans)).toBe(600);
    spans.slice(1).forEach((span, i) => expect(span.startMin).toBe(spans[i].endMin));
  });

  it("clips an overlapping entry instead of letting the track exceed the day", () => {
    // Two timers ran over each other, which is legal. Drawn side by side at
    // full width they would claim three hours of a two-hour span.
    const spans = build([entry("a", "09:00", "11:00"), entry("b", "10:00", "12:00", "p2")]);
    expect(totalOf(spans)).toBe(600);
    const entries = spans.filter((s) => s.kind === "entry");
    expect(entries.map((s) => [s.startMin, s.endMin])).toEqual([[540, 660], [660, 720]]);
  });

  it("marks a trailing gap that ends before the window does", () => {
    // The gap search is capped at the current minute so the rest of today
    // isn't offered before it happens; the bar is drawn to the end of the
    // working day. Keyed on exact boundaries those never matched, and the one
    // gap a person is standing in was the one segment that wasn't a button.
    const spans = buildDaySpans({
      entries: [entry("a", "09:00", "10:00")],
      projects, date: DATE, nowMinutes: 1000,
      window: { startMin: 480, endMin: 1080 },
      gaps: [{ startMin: 600, endMin: 1000 }],
      describeEntry: (e) => e.id,
    });

    const offered = spans.filter((s) => s.kind === "gap");
    expect(offered.map((s) => [s.startMin, s.endMin])).toEqual([[600, 1000]]);
    // The rest of the working day is still drawn, just not offered.
    expect(spans.filter((s) => s.kind === "slack").map((s) => [s.startMin, s.endMin]))
      .toEqual([[480, 540], [1000, 1080]]);
    expect(totalOf(spans)).toBe(600);
  });

  it("marks only the offered gaps, leaving other slack quiet", () => {
    const gaps = [{ startMin: 600, endMin: 780 }];
    const spans = buildDaySpans({
      entries: [entry("a", "09:00", "10:00"), entry("b", "13:00", "15:00")],
      projects, date: DATE, nowMinutes: 1080,
      window: { startMin: 480, endMin: 1080 }, gaps,
      describeEntry: (e) => e.id,
    });
    expect(spans.filter((s) => s.kind === "gap").map((s) => [s.startMin, s.endMin])).toEqual([[600, 780]]);
    // 08:00–09:00 and 15:00–18:00 are slack: real, drawn, but not offered.
    expect(spans.filter((s) => s.kind === "slack")).toHaveLength(2);
  });

  it("clips a running entry at now rather than running it to midnight", () => {
    const spans = build([entry("run", "16:00", null)]);
    const running = spans.find((s) => s.kind === "entry")!;
    expect(running.endMin).toBe(1080);
  });
});

describe("axisLabels", () => {
  it("labels the centre of each fifth, so no label sits on a segment join", () => {
    // The compact form: an axis tick names a position, and its minutes are
    // always zero.
    expect(axisLabels({ startMin: 480, endMin: 1080 }))
      .toEqual(["9 AM", "11 AM", "1 PM", "3 PM", "5 PM"]);
  });
});
