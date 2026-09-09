import { describe, it, expect } from "vitest";
import type { Project, Task, TimeEntry } from "../types";
import {
  bucketKeyFor,
  bucketKeysFor,
  buildChartData,
  buildProjectBreakdown,
  buildTaskBreakdown,
  countActiveDays,
  filterEntriesForRange,
  findNarrowestRangeWithData,
  getDaysInRange,
  pickBucket,
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
