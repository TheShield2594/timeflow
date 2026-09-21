/**
 * The Timesheet is the page people actually reconcile their week on, and it
 * was entirely untested (#114). What matters here is the arithmetic — which
 * entries land in the range, and which holes the page claims are in a day —
 * because a filter that quietly drops an entry produces a total that is wrong
 * in the direction nobody checks.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import { TimesheetPage } from "./TimesheetPage";
import { renderWithData, TEST_WORKING_HOURS } from "../test/dataHarness";
import { addDaysStr, friendlyDate, localDateStr } from "../utils/dates";
import { rangeLabel } from "../utils/ranges";
import { exportToCSV } from "../services/csvExport";
import type { Project, TimeEntry } from "../types";

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
vi.mock("../services/csvExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/csvExport")>()),
  exportToCSV: vi.fn(),
}));

const projects: Project[] = [
  { id: "p1", name: "Alpha", color: "#719500", isActive: true, createdAt: "" },
  { id: "p2", name: "Beta", color: "#00739F", isActive: false, createdAt: "" },
];

const today = localDateStr();

/** Days back from today. */
const daysAgo = (n: number) => addDaysStr(today, -n);

function entry(over: Partial<TimeEntry> & { id: string; date: string }): TimeEntry {
  return {
    projectId: "p1",
    startTime: `${over.date}T09:00:00`,
    endTime: `${over.date}T10:00:00`,
    durationMinutes: 60,
    userId: "user-1",
    userDisplayName: "User One",
    ...over,
  };
}

/**
 * Renders on an explicit custom range rather than the default "This week".
 *
 * Dates relative to `today` land in different weeks depending on which day the
 * suite happens to run, so a test that asserts on grouping has to say what
 * window it means rather than inherit one.
 */
function renderPage(entries: TimeEntry[], opts: { from?: string; to?: string } = {}) {
  const result = renderWithData(
    <TimesheetPage workingHours={TEST_WORKING_HOURS} />,
    { entries, projects },
  );
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: opts.from ?? daysAgo(40) } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: opts.to ?? today } });
  return result;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("TimesheetPage totals", () => {
  it("totals only the entries inside the selected range", () => {
    // The 45-day-old entry is outside the 40-day window and must not reach the
    // total — this is the number people bill from.
    renderPage([
      entry({ id: "a", date: daysAgo(1), durationMinutes: 90 }),
      entry({ id: "b", date: daysAgo(2), durationMinutes: 30 }),
      entry({ id: "c", date: daysAgo(45), durationMinutes: 600 }),
    ]);

    expect(screen.getByText(new RegExp(`^2h ${rangeLabel(daysAgo(40), today)}$`))).toBeTruthy();
  });

  it("groups entries by day, newest first, with a per-day total", () => {
    renderPage([
      entry({ id: "a", date: daysAgo(3), durationMinutes: 60, description: "Older" }),
      entry({ id: "b", date: daysAgo(1), durationMinutes: 30, description: "Newer" }),
      entry({ id: "c", date: daysAgo(1), durationMinutes: 45, description: "Newer too" }),
    ]);

    // Weekdays with nothing logged get a group of their own (see "missed
    // days" below); this is about the groups that hold entries.
    const totals = Array.from(document.querySelectorAll(".timesheet__group"))
      .filter((group) => group.querySelector(".list-row"))
      .map((group) => group.querySelector(".timesheet__group-total")!.textContent);
    expect(totals).toEqual(["1h 15m", "1h"]);
  });
});

/** The day group for one date, found by the heading it's drawn under. */
function groupFor(date: string): HTMLElement {
  return screen.getByText(friendlyDate(date)).closest<HTMLElement>(".timesheet__group")!;
}

/** The most recent weekday strictly before today that isn't in `exclude`. */
function pastWeekday(exclude: string[] = []): string {
  for (let n = 1; ; n++) {
    const date = daysAgo(n);
    const weekday = new Date(`${date}T00:00:00`).getDay();
    if (weekday !== 0 && weekday !== 6 && !exclude.includes(date)) return date;
  }
}

describe("TimesheetPage missed days", () => {
  it("lists a weekday with nothing logged as one full working-day gap", () => {
    // The Friday reconcile: the day you forgot is the biggest hole in the week,
    // and it used to be the one day the page didn't show at all.
    const logged = pastWeekday();
    const missed = pastWeekday([logged]);
    renderPage([entry({ id: "a", date: logged })], { from: missed, to: logged });

    const group = groupFor(missed);
    const gap = group.querySelector(".list-gap-row")!;
    expect(gap.textContent).toMatch(/8:00 AM – 6:00 PM/);
    expect(within(group).getByRole("button", { name: "Fill it" })).toBeTruthy();
  });

  it("leaves weekends out, and stays out of a search", () => {
    const entries = Array.from({ length: 3 }, (_, i) => entry({ id: `e${i}`, date: daysAgo(i + 1) }));
    renderPage(entries, { from: daysAgo(14) });

    for (const group of document.querySelectorAll(".timesheet__group")) {
      if (group.querySelector(".list-row")) continue;
      const heading = group.querySelector(".timesheet__group-day")!.textContent!;
      expect(heading).not.toMatch(/Saturday|Sunday/);
    }

    fireEvent.change(screen.getByLabelText(/Search descriptions/), { target: { value: "anything" } });
    expect(document.querySelectorAll(".list-gap-row").length).toBe(0);
  });
});

describe("TimesheetPage filtering", () => {
  it("searches description, project name and ticket together", () => {
    renderPage([
      entry({ id: "a", date: daysAgo(1), description: "Standup" }),
      entry({ id: "b", date: daysAgo(1), description: "Invoicing", jiraTicket: "FIN-12" }),
    ]);

    const box = screen.getByLabelText(/Search descriptions/);
    fireEvent.change(box, { target: { value: "fin-12" } });
    expect(screen.queryByText("Standup")).toBeNull();
    expect(screen.getByText("Invoicing")).toBeTruthy();

    // Project name matches too, so both come back.
    fireEvent.change(box, { target: { value: "alpha" } });
    expect(screen.getByText("Standup")).toBeTruthy();
    expect(screen.getByText("Invoicing")).toBeTruthy();
  });
});

describe("TimesheetPage untracked gaps", () => {
  it("puts a gap between the two entries it separates, in time order", () => {
    // Three tracked spans across an 08:00–18:00 day, with an hour missing
    // between the first two. Collected into a block at the foot of the day, a
    // gap reads as a footnote about the day; sitting where it happened, it
    // reads as the part of the afternoon nobody accounted for.
    const date = daysAgo(1);
    renderPage([
      entry({ id: "a", date, description: "Standup", startTime: `${date}T09:00:00`, endTime: `${date}T10:00:00` }),
      entry({ id: "b", date, description: "Invoicing", startTime: `${date}T11:00:00`, endTime: `${date}T18:00:00` }),
    ]);

    const card = groupFor(date).querySelector(".list-card")!;
    const lines = [...card.children].map((el) =>
      el.classList.contains("list-gap-row")
        ? `gap ${el.textContent!.match(/\d{1,2}:\d{2} [AP]M – \d{1,2}:\d{2} [AP]M/)![0]}`
        : el.querySelector(".list-row__title")!.textContent
    );
    expect(lines).toEqual([
      "Invoicing",
      "gap 10:00 AM – 11:00 AM",
      "Standup",
      "gap 8:00 AM – 9:00 AM",
    ]);

    const gapRow = card.querySelector<HTMLElement>(".list-gap-row")!;
    expect(within(gapRow).getByRole("button", { name: "Fill it" })).toBeTruthy();
  });

  it("computes gaps from the whole day, not from what the search left showing", () => {
    // Two back-to-back entries fill 09:00–11:00. Searching for one of them
    // hides the other, but the hour it covers is still tracked — a gap
    // computed from the filtered rows would invent a hole at 10:00.
    const date = daysAgo(1);
    renderPage([
      entry({ id: "a", date, description: "Standup", startTime: `${date}T09:00:00`, endTime: `${date}T10:00:00` }),
      entry({ id: "b", date, description: "Invoicing", startTime: `${date}T10:00:00`, endTime: `${date}T11:00:00` }),
    ]);

    fireEvent.change(screen.getByLabelText(/Search descriptions/), { target: { value: "Standup" } });
    // A search is a view over the day, not a claim about it, so the page stops
    // reporting holes entirely rather than reporting the wrong ones.
    expect(document.querySelectorAll(".list-gap-row").length).toBe(0);
  });
});

describe("TimesheetPage empty states", () => {
  it("steers a first-run user with no projects to Projects, not to a dead-end sheet", () => {
    const onGoToProjects = vi.fn();
    renderWithData(
      <TimesheetPage workingHours={TEST_WORKING_HOURS} onGoToProjects={onGoToProjects} />,
      { entries: [], projects: [] },
    );

    fireEvent.click(screen.getByRole("button", { name: /Create a project/ }));
    expect(onGoToProjects).toHaveBeenCalled();
  });

  it("names the last entry rather than saying 'no data'", () => {
    renderWithData(
      <TimesheetPage workingHours={TEST_WORKING_HOURS} />,
      { entries: [entry({ id: "old", date: daysAgo(200) })], projects },
    );
    expect(screen.getByText(/Your last entry was/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log past time" })).toBeTruthy();
  });
});

describe("TimesheetPage paging", () => {
  it("shows the first 30 days and reveals the rest on demand", () => {
    const entries = Array.from({ length: 35 }, (_, i) =>
      entry({ id: `e${i}`, date: daysAgo(i), description: `Day ${i}` })
    );
    renderPage(entries, { from: daysAgo(40) });

    expect(screen.queryByText("Day 32")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show \d+ more days/ }));
    expect(screen.getByText("Day 32")).toBeTruthy();
  });

  it("resets paging when the search changes, so 'Show more' state can't carry over", () => {
    const entries = Array.from({ length: 35 }, (_, i) =>
      entry({ id: `e${i}`, date: daysAgo(i), description: `Day ${i}` })
    );
    renderPage(entries, { from: daysAgo(40) });

    fireEvent.click(screen.getByRole("button", { name: /Show \d+ more/ }));
    expect(screen.getByText("Day 32")).toBeTruthy();

    // Search for something every entry matches: the list is the same length,
    // but the page count has to start over.
    fireEvent.change(screen.getByLabelText(/Search descriptions/), { target: { value: "Day" } });
    expect(screen.queryByText("Day 32")).toBeNull();
  });
});

describe("TimesheetPage export", () => {
  it("bills under the same rounding rule as Reports", () => {
    // The two personal exports used to disagree: Reports rounded, the
    // Timesheet didn't, so one range came out as two different invoices.
    localStorage.setItem("tt_export_rounding", "up15");
    renderPage([entry({ id: "a", date: daysAgo(1), durationMinutes: 7 })]);

    expect((screen.getByLabelText("Rounding applied to exported durations") as HTMLSelectElement).value).toBe("up15");
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(vi.mocked(exportToCSV).mock.calls[0][4]).toBe("up15");
  });
});
