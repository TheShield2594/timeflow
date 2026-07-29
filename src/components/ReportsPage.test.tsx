import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { Project, Task, TimeEntry } from "../types";
import { ReportsPage } from "./ReportsPage";
import { DataRangeProvider } from "../contexts/DataRangeContext";
import { localDateStr, addDaysStr } from "../utils/dates";

vi.mock("../services/userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
}));
// The hooks barrel transitively imports the generated Dataverse SDK; Reports
// only needs formatMinutes from it, so stub the rest (same approach as
// CalendarPage.test.tsx) to avoid loading the SDK's broken transitive deps.
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const projects: Project[] = [
  { id: "p1", name: "Alpha", color: "#111111", isActive: true, createdAt: "" },
  { id: "p2", name: "Beta", color: "#222222", isActive: true, createdAt: "" },
];
const tasks: Task[] = [{ id: "t1", projectId: "p1", name: "Build", isActive: true }];

const today = localDateStr();
const yesterday = addDaysStr(today, -1);

let seq = 0;
function entry(date: string, minutes: number, projectId = "p1", taskId?: string): TimeEntry {
  seq += 1;
  return {
    id: `e${seq}`, projectId, taskId,
    startTime: `${date}T09:00:00`, endTime: `${date}T10:00:00`,
    durationMinutes: minutes, date, userId: "u1", userDisplayName: "U",
  };
}

function renderReports(entries: TimeEntry[]) {
  return render(
    <DataRangeProvider>
      <ReportsPage entries={entries} projects={projects} tasks={tasks} />
    </DataRangeProvider>
  );
}

/** Read a KPI card's value by its label — the strip is the headline number
 *  users read, so assert on it the way they see it. */
function kpi(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.parentElement!.querySelector(".kpi-card__value")!.textContent!;
}

beforeEach(() => {
  localStorage.clear();
  // jsdom has no ResizeObserver — SvgBarChart needs one to exist, even if it
  // never actually fires.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportsPage KPI strip", () => {
  it("reports total, average per active day, session count and project count", () => {
    renderReports([
      entry(today, 60, "p1"),
      entry(today, 30, "p2"),
      entry(yesterday, 90, "p1"),
    ]);

    expect(kpi("Total tracked")).toBe("3h");
    // 180 minutes over the two days that actually have time on them, not over
    // the seven days in the range.
    expect(kpi("Avg per active day")).toBe("1h 30m");
    expect(kpi("Sessions logged")).toBe("3");
    expect(kpi("Projects active")).toBe("2");
  });

  it("replaces the whole grid with one empty state rather than a strip of 0m cards", () => {
    renderReports([]);
    // The four KPI cards, the chart and the per-card "no data" strings all
    // restated the same fact; one statement replaces the lot.
    expect(screen.queryByText("Total tracked")).toBeNull();
    expect(screen.queryByText("Avg per active day")).toBeNull();
    expect(screen.queryByText("No data for this period.")).toBeNull();
    expect(screen.queryByText("No tasks logged.")).toBeNull();
    expect(screen.getByText("Nothing tracked in last 7 days.")).not.toBeNull();
  });

  it("never multiplies hours by the billing ratio (#71)", () => {
    renderReports([
      { ...entry(today, 60, "p1"), ratio: 2 },
      { ...entry(today, 60, "p2"), ratio: 3 },
    ]);

    // Ratio is an account identifier; a "Weighted total" of Σ duration × ratio
    // reported 5h of billable time for 2h of work.
    expect(screen.queryByText("Weighted total")).toBeNull();
    expect(kpi("Total tracked")).toBe("2h");
  });

  it("counts only entries inside the selected range", () => {
    renderReports([entry(today, 60), entry(addDaysStr(today, -20), 600)]);

    expect(kpi("Total tracked")).toBe("1h"); // default preset is "Last 7 days"
    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
    expect(kpi("Total tracked")).toBe("11h");
  });
});

describe("ReportsPage project × period matrix", () => {
  it("renders a row per project with cell and column totals in hours", () => {
    renderReports([
      entry(today, 60, "p1"),
      entry(today, 30, "p2"),
      entry(yesterday, 90, "p1"),
    ]);

    const table = screen.getByRole("table");
    const alpha = within(table).getByRole("row", { name: /Alpha/ });
    // Sorted by total: Alpha (2.5h) above Beta (0.5h), and the row's own total
    // is the last cell.
    const alphaCells = within(alpha).getAllByRole("cell").map((c) => c.textContent);
    expect(alphaCells[alphaCells.length - 1]).toBe("2.5");

    const footer = table.querySelector("tfoot tr")!;
    const footerCells = [...footer.querySelectorAll("td")].map((c) => c.textContent);
    // Grand total agrees with the KPI: 3h.
    expect(footerCells[footerCells.length - 1]).toBe("3.0");
  });

  it("is omitted entirely when nothing was tracked", () => {
    renderReports([]);
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("ReportsPage breakdowns", () => {
  it("shares out project percentages and lists the top tasks", () => {
    renderReports([
      entry(today, 90, "p1", "t1"),
      entry(today, 30, "p2"),
    ]);

    expect(screen.getByText("75%")).not.toBeNull();
    expect(screen.getByText("25%")).not.toBeNull();
    expect(screen.getByText("Build")).not.toBeNull();
  });

  it("says so plainly when there are no tasks to rank", () => {
    renderReports([entry(today, 60, "p1")]);
    expect(screen.getByText("No tasks logged.")).not.toBeNull();
  });
});

describe("ReportsPage empty range recovery", () => {
  it("names a range that does have data, and switches to it when clicked", () => {
    // Nothing in the last 7 days, but 10h sitting 20 days back. Which preset
    // gets offered depends on today's date (on the 21st, "this month" is
    // narrower than "last 30 days"), so assert on the amount and the recovery
    // rather than the preset's name — findNarrowestRangeWithData covers the
    // choice itself on fixed dates.
    renderReports([entry(addDaysStr(today, -20), 600)]);

    const recover = screen.getByRole("button", { name: /You logged 10h in / });
    fireEvent.click(recover);

    // The click is the way out: the grid comes back on the wider preset.
    expect(kpi("Total tracked")).toBe("10h");
    expect(screen.queryByText(/Nothing tracked in/)).toBeNull();
  });

  it("does not dangle a recovery offer when no range has data", () => {
    renderReports([]);
    expect(screen.queryByRole("button", { name: /You logged/ })).toBeNull();
    expect(screen.getByText("Start the timer and your report will fill in here.")).not.toBeNull();
  });
});

describe("ReportsPage export controls", () => {
  it("hides the export row entirely when there is nothing to export", () => {
    renderReports([]);
    expect(screen.queryByRole("button", { name: /Export CSV/ })).toBeNull();
    cleanup();

    renderReports([entry(today, 60)]);
    expect(screen.getByRole("button", { name: /Export CSV/ }).hasAttribute("disabled")).toBe(false);
  });

  it("remembers the chosen rounding rule as a device preference", () => {
    renderReports([entry(today, 60)]);
    fireEvent.change(screen.getByLabelText("Duration rounding applied to the CSV export"), {
      target: { value: "up15" },
    });
    expect(localStorage.getItem("tt_export_rounding")).toBe("up15");
  });
});
