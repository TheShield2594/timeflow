import { describe, it, expect } from "vitest";
import type { Project, Task, TimeEntry } from "../types";
import {
  bucketKeyFor,
  bucketKeysFor,
  buildChartData,
  buildMatrix,
  buildProjectBreakdown,
  buildTaskBreakdown,
  countActiveDays,
  filterEntriesForRange,
  getDaysInRange,
  pickBucket,
  resolveEffectiveRange,
  sumMinutes,
} from "./reportAggregations";

const projects: Project[] = [
  { id: "p1", name: "Alpha", color: "#111", isActive: true, createdAt: "" },
  { id: "p2", name: "Beta", color: "#222", isActive: true, createdAt: "" },
];

const tasks: Task[] = [
  { id: "t1", projectId: "p1", name: "Build", isActive: true },
  { id: "t2", projectId: "p2", name: "Review", isActive: true },
];

let seq = 0;
function entry(date: string, minutes: number, projectId = "p1", taskId?: string): TimeEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    projectId,
    taskId,
    startTime: `${date}T09:00:00`,
    endTime: `${date}T10:00:00`,
    durationMinutes: minutes,
    date,
    userId: "u1",
    userDisplayName: "U",
  };
}

describe("getDaysInRange", () => {
  it("enumerates the range inclusively", () => {
    expect(getDaysInRange("2026-03-01", "2026-03-04")).toEqual([
      "2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04",
    ]);
  });

  it("returns a single day when from === to, and nothing when inverted", () => {
    expect(getDaysInRange("2026-03-01", "2026-03-01")).toEqual(["2026-03-01"]);
    expect(getDaysInRange("2026-03-04", "2026-03-01")).toEqual([]);
  });

  it("walks the local calendar across a month and a leap day", () => {
    expect(getDaysInRange("2028-02-27", "2028-03-01")).toEqual([
      "2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01",
    ]);
  });
});

describe("filterEntriesForRange", () => {
  const entries = [entry("2026-02-28", 30), entry("2026-03-01", 60), entry("2026-03-31", 45)];

  it("keeps entries on the boundary days", () => {
    const kept = filterEntriesForRange(entries, "2026-03-01", "2026-03-31");
    expect(kept.map((e) => e.date)).toEqual(["2026-03-01", "2026-03-31"]);
  });

  it("drops entries with no logged time — a running draft carries no duration", () => {
    const running = { ...entry("2026-03-02", 0), durationMinutes: undefined };
    const kept = filterEntriesForRange([...entries, running], "2026-03-01", "2026-03-31");
    expect(kept).toHaveLength(2);
  });
});

describe("sumMinutes / countActiveDays", () => {
  it("totals durations and counts distinct days with time on them", () => {
    const entries = [entry("2026-03-01", 60), entry("2026-03-01", 30), entry("2026-03-03", 90)];
    expect(sumMinutes(entries)).toBe(180);
    expect(countActiveDays(entries)).toBe(2);
  });

  it("is zero for an empty range rather than NaN", () => {
    expect(sumMinutes([])).toBe(0);
    expect(countActiveDays([])).toBe(0);
  });
});

describe("bucketing", () => {
  it("switches from daily to weekly to monthly as the range grows", () => {
    expect(pickBucket(7)).toBe("day");
    expect(pickBucket(35)).toBe("day");
    expect(pickBucket(36)).toBe("week");
    expect(pickBucket(180)).toBe("week");
    expect(pickBucket(181)).toBe("month");
  });

  it("keys a date by itself, its Monday, or its month", () => {
    // 2026-03-04 is a Wednesday; its week starts Monday 2026-03-02.
    expect(bucketKeyFor("2026-03-04", "day")).toBe("2026-03-04");
    expect(bucketKeyFor("2026-03-04", "week")).toBe("2026-03-02");
    expect(bucketKeyFor("2026-03-04", "month")).toBe("2026-03");
    // Sunday belongs to the week that started the previous Monday.
    expect(bucketKeyFor("2026-03-08", "week")).toBe("2026-03-02");
  });

  it("lists each bucket once, in order, including buckets with no data", () => {
    const days = getDaysInRange("2026-03-01", "2026-03-16");
    expect(bucketKeysFor(days, "week")).toEqual(["2026-02-23", "2026-03-02", "2026-03-09", "2026-03-16"]);
    expect(bucketKeysFor(getDaysInRange("2026-01-15", "2026-03-02"), "month"))
      .toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(bucketKeysFor([], "day")).toEqual([]);
  });
});

describe("resolveEffectiveRange", () => {
  it("passes a normal preset range through untouched", () => {
    expect(resolveEffectiveRange("7d", [], "2026-03-01", "2026-03-07", "2026-03-07"))
      .toEqual({ effFrom: "2026-03-01", effTo: "2026-03-07" });
  });

  it("collapses an inverted custom range instead of enumerating backwards", () => {
    expect(resolveEffectiveRange("custom", [], "2026-03-07", "2026-03-01", "2026-03-07"))
      .toEqual({ effFrom: "2026-03-07", effTo: "2026-03-07" });
  });

  it("clamps the all-time sentinel range to the data, extended to today", () => {
    const entries = [entry("2025-11-02", 60), entry("2026-01-15", 60)];
    expect(resolveEffectiveRange("all", entries, "1970-01-01", "9999-12-31", "2026-03-07"))
      .toEqual({ effFrom: "2025-11-02", effTo: "2026-03-07" });
  });

  it("keeps future-dated entries inside the all-time range", () => {
    const entries = [entry("2026-01-15", 60), entry("2026-12-24", 60)];
    expect(resolveEffectiveRange("all", entries, "1970-01-01", "9999-12-31", "2026-03-07"))
      .toEqual({ effFrom: "2026-01-15", effTo: "2026-12-24" });
  });

  it("falls back to today when there is no data at all", () => {
    expect(resolveEffectiveRange("all", [], "1970-01-01", "9999-12-31", "2026-03-07"))
      .toEqual({ effFrom: "2026-03-07", effTo: "2026-03-07" });
  });
});

describe("buildProjectBreakdown", () => {
  it("sums per project, biggest first, with percentages of the total", () => {
    const entries = [
      entry("2026-03-01", 60, "p1"),
      entry("2026-03-02", 30, "p1"),
      entry("2026-03-02", 120, "p2"),
    ];
    const rows = buildProjectBreakdown(entries, projects, sumMinutes(entries));
    expect(rows.map((r) => [r.project.name, r.minutes, r.percent])).toEqual([
      ["Beta", 120, 57],
      ["Alpha", 90, 43],
    ]);
  });

  it("drops time logged against a project that no longer exists", () => {
    const entries = [entry("2026-03-01", 60, "p1"), entry("2026-03-01", 60, "gone")];
    const rows = buildProjectBreakdown(entries, projects, sumMinutes(entries));
    expect(rows).toHaveLength(1);
    expect(rows[0].project.id).toBe("p1");
  });

  it("reports 0% rather than dividing by zero when nothing was tracked", () => {
    const rows = buildProjectBreakdown([{ ...entry("2026-03-01", 0) }], projects, 0);
    expect(rows[0].percent).toBe(0);
  });
});

describe("buildChartData", () => {
  it("zero-fills buckets with no entries and keeps the key order", () => {
    const days = getDaysInRange("2026-03-01", "2026-03-03");
    const keys = bucketKeysFor(days, "day");
    const data = buildChartData([entry("2026-03-03", 45)], keys, "day");
    expect(data).toEqual([
      { key: "2026-03-01", minutes: 0, bucket: "day" },
      { key: "2026-03-02", minutes: 0, bucket: "day" },
      { key: "2026-03-03", minutes: 45, bucket: "day" },
    ]);
  });

  it("rolls daily entries up into their week bucket", () => {
    const keys = bucketKeysFor(getDaysInRange("2026-03-02", "2026-03-15"), "week");
    const data = buildChartData(
      [entry("2026-03-03", 60), entry("2026-03-08", 30), entry("2026-03-09", 120)],
      keys,
      "week",
    );
    expect(data).toEqual([
      { key: "2026-03-02", minutes: 90, bucket: "week" },
      { key: "2026-03-09", minutes: 120, bucket: "week" },
    ]);
  });

  it("ignores entries outside the listed buckets rather than misfiling them", () => {
    const keys = bucketKeysFor(getDaysInRange("2026-03-01", "2026-03-02"), "day");
    const data = buildChartData([entry("2026-04-01", 60)], keys, "day");
    expect(data.every((d) => d.minutes === 0)).toBe(true);
  });
});

describe("buildMatrix", () => {
  const entries = [
    entry("2026-03-01", 60, "p1"),
    entry("2026-03-01", 30, "p2"),
    entry("2026-03-02", 90, "p1"),
  ];
  const keys = bucketKeysFor(getDaysInRange("2026-03-01", "2026-03-03"), "day");

  it("lays out project rows sorted by total, with per-bucket cells", () => {
    const { rows } = buildMatrix(entries, projects, keys, "day");
    expect(rows.map((r) => r.project.name)).toEqual(["Alpha", "Beta"]);
    expect(rows[0].total).toBe(150);
    expect(rows[0].cells.get("2026-03-01")).toBe(60);
    expect(rows[0].cells.get("2026-03-02")).toBe(90);
    expect(rows[0].cells.get("2026-03-03")).toBeUndefined();
  });

  it("computes column totals that agree with the grand total", () => {
    const { rows, colTotals } = buildMatrix(entries, projects, keys, "day");
    expect(colTotals).toEqual([90, 90, 0]);
    const rowSum = rows.reduce((s, r) => s + r.total, 0);
    expect(colTotals.reduce((s, m) => s + m, 0)).toBe(rowSum);
    expect(rowSum).toBe(sumMinutes(entries));
  });

  it("excludes rows for projects that no longer exist, and their time with them", () => {
    const withOrphan = [...entries, entry("2026-03-01", 500, "gone")];
    const { rows, colTotals } = buildMatrix(withOrphan, projects, keys, "day");
    expect(rows).toHaveLength(2);
    expect(colTotals[0]).toBe(90);
  });

  it("is empty for a range with no entries", () => {
    const { rows, colTotals } = buildMatrix([], projects, keys, "day");
    expect(rows).toEqual([]);
    expect(colTotals).toEqual([0, 0, 0]);
  });
});

describe("buildTaskBreakdown", () => {
  it("ranks tasks by time and resolves each task's project", () => {
    const rows = buildTaskBreakdown(
      [entry("2026-03-01", 30, "p1", "t1"), entry("2026-03-02", 90, "p2", "t2"), entry("2026-03-02", 15, "p1", "t1")],
      tasks,
      projects,
    );
    expect(rows.map((r) => [r.task.name, r.minutes, r.project?.name])).toEqual([
      ["Review", 90, "Beta"],
      ["Build", 45, "Alpha"],
    ]);
  });

  it("ignores entries with no task, and tasks that have been deleted", () => {
    const rows = buildTaskBreakdown(
      [entry("2026-03-01", 60, "p1"), entry("2026-03-01", 60, "p1", "gone"), entry("2026-03-01", 10, "p1", "t1")],
      tasks,
      projects,
    );
    expect(rows.map((r) => r.task.id)).toEqual(["t1"]);
  });

  it("caps the list at the requested limit", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, projectId: "p1", name: `T${i}`, isActive: true }));
    const rows = buildTaskBreakdown(
      many.map((t, i) => entry("2026-03-01", (i + 1) * 10, "p1", t.id)),
      many,
      projects,
      3,
    );
    expect(rows.map((r) => r.minutes)).toEqual([50, 40, 30]);
  });
});
