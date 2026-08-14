import { describe, it, expect } from "vitest";
import type { Project, Task, TimeEntry } from "../types";
import {
  bucketKeyFor,
  bucketKeysFor,
  buildChartData,
  buildMatrix,
  buildMatrixDisplay,
  buildProjectBreakdown,
  buildTaskBreakdown,
  countActiveDays,
  filterEntriesForRange,
  findNarrowestRangeWithData,
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

describe("findNarrowestRangeWithData", () => {
  // Fixed candidate ranges so the assertions don't move with the calendar.
  const week = { preset: "7d", label: "Last 7 days", from: "2024-05-15", to: "2024-05-21" };
  const month = { preset: "30d", label: "Last 30 days", from: "2024-04-22", to: "2024-05-21" };
  const all = { preset: "all", label: "All time", from: "1970-01-01", to: "9999-12-31" };

  it("returns the narrowest range holding time, with its total", () => {
    // Present in both 30d and all time; 30d is the smaller jump from an empty
    // 7-day view, so that's what gets offered.
    const found = findNarrowestRangeWithData([entry("2024-05-02", 90)], [month, all]);
    expect(found?.preset).toBe("30d");
    expect(found?.minutes).toBe(90);
  });

  it("sums every entry inside a candidate, and only those", () => {
    const found = findNarrowestRangeWithData(
      [entry("2024-05-02", 90), entry("2024-05-03", 30), entry("2020-01-01", 600)],
      [month],
    );
    expect(found?.minutes).toBe(120);
  });

  it("skips candidates that are empty even when they are narrower", () => {
    const found = findNarrowestRangeWithData([entry("2024-05-02", 90)], [week, month]);
    expect(found?.preset).toBe("30d");
  });

  it("returns null when nothing anywhere has time, so no dead offer is made", () => {
    expect(findNarrowestRangeWithData([], [week, month, all])).toBeNull();
    // Zero-duration entries are not data to go and look at.
    expect(findNarrowestRangeWithData([entry("2024-05-02", 0)], [month, all])).toBeNull();
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

  // These are rendered as one stack and get added up by eye (#113).
  it("allocates the percentages so they sum to 100 rather than 99", () => {
    const thirds = [
      { id: "p1", name: "Alpha", color: "#111", isActive: true, createdAt: "" },
      { id: "p2", name: "Beta", color: "#222", isActive: true, createdAt: "" },
      { id: "p3", name: "Gamma", color: "#333", isActive: true, createdAt: "" },
    ];
    const entries = [
      entry("2026-03-01", 60, "p1"),
      entry("2026-03-01", 60, "p2"),
      entry("2026-03-01", 60, "p3"),
    ];
    const rows = buildProjectBreakdown(entries, thirds, sumMinutes(entries));
    expect(rows.map((r) => r.percent)).toEqual([34, 33, 33]);
    expect(rows.reduce((s, r) => s + r.percent, 0)).toBe(100);
  });

  it("does not hand a vanished project's share to the projects that remain", () => {
    const entries = [
      entry("2026-03-01", 30, "p1"),
      entry("2026-03-01", 30, "p2"),
      entry("2026-03-01", 40, "gone"),
    ];
    const rows = buildProjectBreakdown(entries, projects, sumMinutes(entries));
    expect(rows.map((r) => r.percent)).toEqual([30, 30]);
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

describe("buildMatrixDisplay", () => {
  const threeProjects: Project[] = [
    { id: "p1", name: "Alpha", color: "#111", isActive: true, createdAt: "" },
    { id: "p2", name: "Beta", color: "#222", isActive: true, createdAt: "" },
    { id: "p3", name: "Gamma", color: "#333", isActive: true, createdAt: "" },
  ];

  /** What the grid actually prints, at one decimal. */
  const hours = (displayMinutes: number) => Number((displayMinutes / 60).toFixed(1));
  const sum = (ns: number[]) => Number(ns.reduce((s, n) => s + n, 0).toFixed(10));

  it("prints a column that adds up to the total under it (#93)", () => {
    // The reported case: three projects at 50 minutes in one bucket. Rounded
    // independently the cells read 0.8+0.8+0.8 = 2.4 under a total of 2.5.
    const keys = bucketKeysFor(getDaysInRange("2026-03-01", "2026-03-01"), "day");
    const { rows } = buildMatrix(
      [entry("2026-03-01", 50, "p1"), entry("2026-03-01", 50, "p2"), entry("2026-03-01", 50, "p3")],
      threeProjects, keys, "day",
    );
    const d = buildMatrixDisplay(rows, keys);

    expect(d.cells.map((r) => hours(r[0]))).toEqual([0.9, 0.8, 0.8]);
    expect(hours(d.colTotals[0])).toBe(2.5);
    expect(sum(d.cells.map((r) => hours(r[0])))).toBe(hours(d.colTotals[0]));
  });

  it("adds up in every direction a reader can add it up in", () => {
    const keys = bucketKeysFor(getDaysInRange("2026-03-01", "2026-03-04"), "day");
    // Deliberately awkward minute counts — none of them land on a tenth.
    const { rows } = buildMatrix(
      [
        entry("2026-03-01", 50, "p1"), entry("2026-03-02", 25, "p1"), entry("2026-03-04", 7, "p1"),
        entry("2026-03-01", 50, "p2"), entry("2026-03-03", 95, "p2"),
        entry("2026-03-01", 50, "p3"), entry("2026-03-02", 13, "p3"), entry("2026-03-03", 41, "p3"),
      ],
      threeProjects, keys, "day",
    );
    const d = buildMatrixDisplay(rows, keys);

    // Each project row against its own total.
    d.cells.forEach((row, i) => {
      expect(sum(row.map(hours))).toBe(hours(d.rowTotals[i]));
    });
    // Each period column against the total under it.
    keys.forEach((_, j) => {
      expect(sum(d.cells.map((row) => hours(row[j])))).toBe(hours(d.colTotals[j]));
    });
    // And both margins against the grand total in the corner.
    expect(sum(d.rowTotals.map(hours))).toBe(hours(d.grandTotal));
    expect(sum(d.colTotals.map(hours))).toBe(hours(d.grandTotal));
  });

  it("keeps every printed figure within one 0.1h increment of the truth", () => {
    const keys = bucketKeysFor(getDaysInRange("2026-03-01", "2026-03-04"), "day");
    const { rows, colTotals } = buildMatrix(
      [
        entry("2026-03-01", 50, "p1"), entry("2026-03-02", 25, "p1"), entry("2026-03-04", 7, "p1"),
        entry("2026-03-01", 50, "p2"), entry("2026-03-03", 95, "p2"),
        entry("2026-03-01", 50, "p3"), entry("2026-03-02", 13, "p3"), entry("2026-03-03", 41, "p3"),
      ],
      threeProjects, keys, "day",
    );
    const d = buildMatrixDisplay(rows, keys);

    rows.forEach((row, i) => {
      keys.forEach((k, j) => {
        expect(Math.abs(d.cells[i][j] - (row.cells.get(k) || 0))).toBeLessThan(6);
      });
      expect(Math.abs(d.rowTotals[i] - row.total)).toBeLessThan(6);
    });
    colTotals.forEach((exact, j) => {
      expect(Math.abs(d.colTotals[j] - exact)).toBeLessThanOrEqual(6);
    });
    // 331 real minutes, snapped to the nearest 0.1h: 55 increments, 5.5 h.
    expect(d.grandTotal).toBe(330);
  });

  it("never rounds an empty cell up into time nobody logged", () => {
    const keys = bucketKeysFor(getDaysInRange("2026-03-01", "2026-03-03"), "day");
    const { rows } = buildMatrix(
      [entry("2026-03-01", 55, "p1"), entry("2026-03-03", 55, "p1")],
      projects, keys, "day",
    );
    const d = buildMatrixDisplay(rows, keys);
    expect(d.cells[0][1]).toBe(0);
  });

  it("totals only the projects the grid actually shows", () => {
    const keys = bucketKeysFor(getDaysInRange("2026-03-01", "2026-03-01"), "day");
    // 500 minutes against a project that no longer exists: buildMatrix drops
    // the row, so the footer must not claim those hours either.
    const { rows } = buildMatrix(
      [entry("2026-03-01", 60, "p1"), entry("2026-03-01", 500, "gone")],
      projects, keys, "day",
    );
    expect(buildMatrixDisplay(rows, keys).grandTotal).toBe(60);
  });

  it("is empty for a grid with no rows", () => {
    const keys = bucketKeysFor(getDaysInRange("2026-03-01", "2026-03-02"), "day");
    expect(buildMatrixDisplay([], keys)).toEqual({
      cells: [], rowTotals: [], colTotals: [0, 0], grandTotal: 0,
    });
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
