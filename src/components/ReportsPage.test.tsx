import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { Project, Task, TimeEntry } from "../types";
import { ReportsPage } from "./ReportsPage";
import { DataRangeProvider } from "../contexts/DataRangeContext";
import { localDateStr, addDaysStr } from "../utils/dates";

// The SDK's app entrypoint has an extensionless internal import that Node's
// ESM resolver can't follow, which is why userService used to be replaced
// wholesale here. Stubbing just that one module lets the real userService
// load, so the mock below can spread it.
vi.mock("@microsoft/power-apps/app", () => ({ getContext: vi.fn() }));
vi.mock("../services/userService", async (importOriginal) => ({
  // Spread the real module: replacing it wholesale left isPowerAppsHost
  // undefined, and the resulting TypeError was swallowed into a hook
  // error state that the assertions never looked at (#114).
  ...(await importOriginal<typeof import("../services/userService")>()),
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

function renderReports(entries: TimeEntry[], withProjects: Project[] = projects) {
  return render(
    <DataRangeProvider>
      <ReportsPage entries={entries} projects={withProjects} tasks={tasks} />
    </DataRangeProvider>
  );
}

const gamma: Project = { id: "p3", name: "Gamma", color: "#333333", isActive: true, createdAt: "" };

/** A matrix row as the numbers a reader would actually add up, with an
 *  untracked dash read as the zero it stands for. The project name isn't in
 *  here: it's a <th>, so querySelectorAll("td") already leaves it out (#106). */
function printedRow(row: Element): number[] {
  return [...row.querySelectorAll("td")]
    .map((c) => (c.textContent === "–" ? 0 : Number(c.textContent)));
}

/** Sum, with the binary-float dust swept up — 0.9 + 0.8 + 0.8 is not 2.5 to
 *  a computer, but it is to the person reading the column. */
const addUp = (values: number[]) => Number(values.reduce((s, v) => s + v, 0).toFixed(10));

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

  // Asserted on the rendered strings, not on the minutes behind them. The
  // aggregation test that claimed to cover this checked that the *minutes*
  // agreed — which they always did — while the figures on screen didn't (#93).
  it("prints cells that add up to the totals printed beside and beneath them", () => {
    // The reported case: three projects at 50 minutes in one bucket. Rounded
    // one cell at a time that column reads 0.8 + 0.8 + 0.8 under a total of 2.5.
    renderReports(
      [entry(today, 50, "p1"), entry(today, 50, "p2"), entry(today, 50, "p3")],
      [...projects, gamma],
    );

    const table = screen.getByRole("table");
    const rows = [...table.querySelectorAll("tbody tr")].map(printedRow);
    const footer = printedRow(table.querySelector("tfoot tr")!);

    // Every column, the Total column included, is the sum of the cells above it.
    footer.forEach((columnTotal, col) => {
      expect(addUp(rows.map((r) => r[col]))).toBe(columnTotal);
    });
    // Every row is the sum of its own cells.
    rows.forEach((cells) => {
      expect(addUp(cells.slice(0, -1))).toBe(cells[cells.length - 1]);
    });
    expect(footer[footer.length - 1]).toBe(2.5);
  });

  it("keeps the hover title in exact minutes even where the printed hours are snapped", () => {
    renderReports([entry(today, 50, "p1"), entry(today, 50, "p2"), entry(today, 50, "p3")],
      [...projects, gamma]);

    const table = screen.getByRole("table");
    const alpha = within(table).getByRole("row", { name: /Alpha/ });
    const cell = [...alpha.querySelectorAll("td")].find((c) => c.getAttribute("title"))!;
    expect(cell.getAttribute("title")).toBe("50m");
  });

  it("associates every number with its project and its period (#106)", () => {
    renderReports([entry(today, 60, "p1"), entry(today, 30, "p2")]);

    const table = screen.getByRole("table");
    // The table names itself, so it isn't announced as an unlabelled grid.
    expect(table.querySelector("caption")!.textContent).toContain("Hours per project");

    // Column headers are headers, and scoped — without this a screen reader in
    // table mode reads bare numbers with no idea which week they fall in.
    const columnHeaders = within(table).getAllByRole("columnheader");
    expect(columnHeaders.length).toBeGreaterThan(2);
    expect(columnHeaders.every((h) => h.getAttribute("scope") === "col")).toBe(true);
    expect(columnHeaders[0].textContent).toBe("Project");

    // And the project name is the row's header, not just its first cell.
    const rowHeaders = within(table).getAllByRole("rowheader");
    expect(rowHeaders.map((h) => h.textContent)).toEqual(["Alpha", "Beta", "Total"]);
    expect(rowHeaders.every((h) => h.getAttribute("scope") === "row")).toBe(true);
  });

  it("reads out the exact time rather than the rounded figure on screen", () => {
    // 50 minutes prints as 0.8 hours. A reader who only hears "0.8" can't
    // recover the minutes, and the exact value used to be in `title` alone —
    // unreachable by keyboard and invisible to assistive tech.
    renderReports([entry(today, 50, "p1")]);

    const table = screen.getByRole("table");
    const alpha = within(table).getByRole("row", { name: /Alpha/ });
    const logged = [...alpha.querySelectorAll("td")].find((c) => c.textContent === "0.8")!;
    expect(logged.getAttribute("aria-label")).toBe("50m");

    // An untracked cell says so, instead of announcing a bare dash.
    const empty = [...alpha.querySelectorAll("td")].find((c) => c.textContent === "–");
    expect(empty?.getAttribute("aria-label")).toBe("No time logged");
  });

  it("no longer tells the reader to hover for the exact time", () => {
    renderReports([entry(today, 50, "p1")]);
    expect(screen.queryByText(/Hover a cell/)).toBeNull();
  });

  it("does not print an empty bucket as time that was logged", () => {
    renderReports([entry(yesterday, 55, "p1"), entry(today, 55, "p1")]);
    const table = screen.getByRole("table");
    const alpha = within(table).getByRole("row", { name: /Alpha/ });
    const cells = [...alpha.querySelectorAll("td")].slice(0, -1).map((c) => c.textContent);
    expect(cells.filter((c) => c !== "–")).toEqual(["0.9", "0.9"]);
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

  it("shares out equal projects to 100%, not 99% (#113)", () => {
    renderReports(
      [entry(today, 60, "p1"), entry(today, 60, "p2"), entry(today, 60, "p3")],
      [...projects, gamma],
    );
    const shown = [...document.querySelectorAll(".project-breakdown__pct")]
      .map((el) => Number(el.textContent!.replace("%", "")));
    expect(shown).toEqual([34, 33, 33]);
    expect(addUp(shown)).toBe(100);
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
