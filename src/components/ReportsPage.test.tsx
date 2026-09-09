/**
 * Reports is where the app's numbers are read rather than entered, so what
 * matters here is that the figures on screen agree with each other: the
 * headline with the range, the percentages with 100, and the delta with the
 * period it names.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { Project, Task, TimeEntry } from "../types";
import { ReportsPage } from "./ReportsPage";
import { renderWithData } from "../test/dataHarness";
import { addDaysStr, localDateStr, weekStartStr } from "../utils/dates";

// The SDK's app entrypoint has an extensionless internal import that Node's
// ESM resolver can't follow, which is why userService used to be replaced
// wholesale here. Stubbing just that one module lets the real userService
// load, so the mock below can spread it.
vi.mock("@microsoft/power-apps/app", () => ({ getContext: vi.fn() }));
vi.mock("../services/userService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/userService")>()),
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
}));
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const projects: Project[] = [
  { id: "p1", name: "Alpha", color: "#719500", isActive: true, createdAt: "" },
  { id: "p2", name: "Beta", color: "#00739F", isActive: true, createdAt: "" },
];
const gamma: Project = { id: "p3", name: "Gamma", color: "#CC4F00", isActive: true, createdAt: "" };
const tasks: Task[] = [{ id: "t1", projectId: "p1", name: "Build", isActive: true }];

/**
 * Pinned to Wednesday 9 September 2026.
 *
 * The recovery test places its fixture three weeks before last week and
 * expects the month or quarter preset to reach it. Both are calendar-anchored,
 * so on a real clock in the first weeks of a quarter — 5 January, say — every
 * preset starts *after* the fixture and the assertion throws. A test that
 * fails for a fortnight each quarter is a broken test, not a flaky one.
 */
const FROZEN_NOW = new Date("2026-09-09T12:00:00");

const today = localDateStr(FROZEN_NOW);
// Reports opens on *last* week, so the fixtures live there.
const lastWeekStart = addDaysStr(weekStartStr(today), -7);
const lastWeekDay = (i: number) => addDaysStr(lastWeekStart, i);

let seq = 0;
function entry(date: string, minutes: number, projectId = "p1", taskId?: string): TimeEntry {
  seq += 1;
  return {
    id: `e${seq}`, projectId, taskId,
    startTime: `${date}T09:00:00`, endTime: `${date}T10:00:00`,
    durationMinutes: minutes, date, userId: "u1", userDisplayName: "U",
  };
}

/** Three tracked days is the floor below which the page refuses to draw a
 *  shape, so most fixtures need at least that many. */
function threeDays(minutes: number, projectId = "p1"): TimeEntry[] {
  return [0, 1, 2].map((i) => entry(lastWeekDay(i), minutes, projectId));
}

const renderReports = (entries: TimeEntry[], withProjects: Project[] = projects) =>
  renderWithData(<ReportsPage />, { entries, projects: withProjects, tasks });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ now: FROZEN_NOW, shouldAdvanceTime: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("ReportsPage headline", () => {
  it("opens on last week, not on the half-finished current one", () => {
    renderReports([
      ...threeDays(60),
      entry(today, 600), // this week — must not reach the headline
    ]);

    expect(screen.getByRole("tab", { name: "Last week" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("3h")).toBeTruthy();
  });

  it("never multiplies hours by the billing ratio (#71)", () => {
    // Ratio is an account identifier; a "Weighted total" of Σ duration × ratio
    // once reported 5h of billable time for 2h of work.
    renderReports(threeDays(60).map((e, i) => ({ ...e, ratio: i + 2 })));
    expect(screen.queryByText(/Weighted/)).toBeNull();
    expect(screen.getByText("3h")).toBeTruthy();
  });

  it("states the delta against the period before, not a bare percentage", () => {
    renderReports([
      ...threeDays(60),
      // Two weeks back: one hour, so last week is two hours up on it.
      entry(addDaysStr(lastWeekStart, -7), 60),
    ]);
    expect(screen.getByText("+2h on the period before")).toBeTruthy();
  });
});

describe("ReportsPage shape", () => {
  it("refuses to draw a week that hasn't enough days in it to mean anything", () => {
    renderReports([entry(lastWeekDay(0), 60)]);
    expect(screen.getByText(/Two more days and this becomes useful/)).toBeTruthy();
    expect(document.querySelector(".reports__bars")).toBeNull();
  });

  it("scales the average line against the same box the bars are scaled in", () => {
    // Three days at 1h, one at 2h: max is 2h, average is 1h 15m, so the line
    // sits at 62.5% of the bar box's height.
    renderReports([...threeDays(60), entry(lastWeekDay(3), 120)]);

    const line = document.querySelector<HTMLElement>(".reports__avg-line")!;
    expect(line.style.bottom).toBe("62.5%");
    expect(screen.getByText("avg 1h 15m")).toBeTruthy();
    // The line and the bars share one positioned box; a wrapper that also held
    // the label row would resolve `bottom` against a taller box than the bar
    // percentages use.
    expect(line.parentElement!.classList.contains("reports__bars-box")).toBe(true);
    expect(line.parentElement!.querySelector(".reports__bars")).toBeTruthy();
  });
});

describe("ReportsPage breakdowns", () => {
  it("shares out project percentages and lists the top tasks", () => {
    renderReports([
      ...threeDays(60),
      entry(lastWeekDay(0), 60, "p2"),
      entry(lastWeekDay(1), 60, "p1", "t1"),
    ]);

    expect(screen.getByText(/4h · 80%/)).toBeTruthy();
    expect(screen.getByText(/1h · 20%/)).toBeTruthy();
    expect(screen.getByText("Build")).toBeTruthy();
  });

  it("shares out equal projects to 100%, not 99% (#113)", () => {
    renderReports(
      [
        ...threeDays(60, "p1"),
        ...threeDays(60, "p2"),
        ...threeDays(60, "p3"),
      ],
      [...projects, gamma],
    );
    const shown = [...document.querySelectorAll(".prop-row__value")]
      .map((el) => Number(el.textContent!.split("·")[1].replace("%", "").trim()));
    expect(shown).toEqual([34, 33, 33]);
    expect(shown.reduce((sum, n) => sum + n, 0)).toBe(100);
  });
});

describe("ReportsPage empty range recovery", () => {
  it("names a period that does have data, and switches to it when clicked", () => {
    // Nothing last week, but time sitting further back — which the month or
    // quarter preset covers.
    renderReports([entry(addDaysStr(lastWeekStart, -21), 600)]);

    const recover = screen.getByRole("button", { name: /You logged 10h in / });
    fireEvent.click(recover);

    expect(screen.getByText("10h")).toBeTruthy();
    expect(screen.queryByText(/Nothing tracked in this period/)).toBeNull();
  });

  it("does not dangle a recovery offer when no period has data", () => {
    renderReports([]);
    expect(screen.queryByRole("button", { name: /You logged/ })).toBeNull();
    expect(screen.getByText("Nothing tracked in this period")).toBeTruthy();
  });
});

describe("ReportsPage export controls", () => {
  it("disables the export when there is nothing to export", () => {
    renderReports([]);
    expect(screen.getByRole("button", { name: "Export CSV" }).hasAttribute("disabled")).toBe(true);
    cleanup();

    renderReports(threeDays(60));
    expect(screen.getByRole("button", { name: "Export CSV" }).hasAttribute("disabled")).toBe(false);
  });

  it("remembers the chosen rounding rule as a device preference", () => {
    renderReports(threeDays(60));
    fireEvent.change(screen.getByLabelText("Rounding applied to exported durations"), {
      target: { value: "up15" },
    });
    expect(localStorage.getItem("tt_export_rounding")).toBe("up15");
  });
});
