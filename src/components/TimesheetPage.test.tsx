/**
 * The Timesheet is the page people actually reconcile their week on, and it
 * was entirely untested (#114). What matters here is the filtering — range,
 * search and project — because a filter that quietly drops an entry produces
 * a total that is wrong in the direction nobody checks.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { TimesheetPage } from "./TimesheetPage";
import { DataRangeProvider } from "../contexts/DataRangeContext";
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

const projects: Project[] = [
  { id: "p1", name: "Alpha", color: "#719500", isActive: true, createdAt: "" },
  { id: "p2", name: "Beta", color: "#3b82f6", isActive: false, createdAt: "" },
];

/** Days back from today, so entries always land inside the default 30d range
 *  regardless of when the suite runs. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

function renderPage(entries: TimeEntry[], props: Partial<React.ComponentProps<typeof TimesheetPage>> = {}) {
  return render(
    <DataRangeProvider>
      <TimesheetPage
        entries={entries}
        projects={projects}
        tasks={[]}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        {...props}
      />
    </DataRangeProvider>
  );
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("TimesheetPage totals", () => {
  it("totals only the entries inside the selected range", () => {
    // The 45-day-old entry is outside the default "Last 30 days" window and
    // must not reach the total — this is the number people bill from.
    renderPage([
      entry({ id: "a", date: daysAgo(1), durationMinutes: 90 }),
      entry({ id: "b", date: daysAgo(2), durationMinutes: 30 }),
      entry({ id: "c", date: daysAgo(45), durationMinutes: 600 }),
    ]);

    expect(screen.getByText("2h total")).toBeTruthy();
  });

  it("groups entries by day, newest first, with a per-day total", () => {
    renderPage([
      entry({ id: "a", date: daysAgo(3), durationMinutes: 60, description: "Older" }),
      entry({ id: "b", date: daysAgo(1), durationMinutes: 30, description: "Newer" }),
      entry({ id: "c", date: daysAgo(1), durationMinutes: 45, description: "Newer too" }),
    ]);

    const dayTotals = screen.getAllByText(/^\d+h?\s?\d*m?$/)
      .filter((el) => el.classList.contains("timesheet__day-total"))
      .map((el) => el.textContent);
    expect(dayTotals).toEqual(["1h 15m", "1h"]);
  });
});

describe("TimesheetPage filtering", () => {
  it("searches description, project name and ticket together", () => {
    renderPage([
      entry({ id: "a", date: daysAgo(1), description: "Standup" }),
      entry({ id: "b", date: daysAgo(1), description: "Invoicing", jiraTicket: "FIN-12" }),
    ]);

    const box = screen.getByLabelText(/Search entries/);
    fireEvent.change(box, { target: { value: "fin-12" } });
    expect(screen.queryByText("Standup")).toBeNull();
    expect(screen.getByText("Invoicing")).toBeTruthy();

    // Project name matches too, so both come back.
    fireEvent.change(box, { target: { value: "alpha" } });
    expect(screen.getByText("Standup")).toBeTruthy();
    expect(screen.getByText("Invoicing")).toBeTruthy();
  });

  it("says 'nothing matches' rather than 'no entries' when a filter is what emptied the page", () => {
    renderPage([entry({ id: "a", date: daysAgo(1), description: "Standup" })]);

    fireEvent.change(screen.getByLabelText(/Search entries/), { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches these filters.")).toBeTruthy();
  });

  it("keeps archived projects in the filter, flagged, because the page scopes history", () => {
    renderPage([entry({ id: "a", date: daysAgo(1), projectId: "p2", description: "Legacy" })]);

    const filter = screen.getByLabelText("Filter by project") as HTMLSelectElement;
    expect(within(filter).getByText("Beta (archived)")).toBeTruthy();

    fireEvent.change(filter, { target: { value: "p1" } });
    expect(screen.queryByText("Legacy")).toBeNull();
    fireEvent.change(filter, { target: { value: "p2" } });
    expect(screen.getByText("Legacy")).toBeTruthy();
  });
});

describe("TimesheetPage empty states", () => {
  it("steers a first-run user with no projects to Projects, not to a dead-end modal", () => {
    const onGoToProjects = vi.fn();
    render(
      <DataRangeProvider>
        <TimesheetPage
          entries={[]} projects={[]} tasks={[]}
          onDelete={vi.fn()} onEdit={vi.fn()} onCreate={vi.fn()}
          onGoToProjects={onGoToProjects}
        />
      </DataRangeProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Create a project/ }));
    expect(onGoToProjects).toHaveBeenCalled();
  });

  it("offers a manual entry once projects exist", () => {
    renderPage([]);
    expect(screen.getByRole("button", { name: /Add your first entry/ })).toBeTruthy();
    expect(screen.getByText(/Start the timer or add one manually/)).toBeTruthy();
  });
});

describe("TimesheetPage paging", () => {
  it("shows the first 30 days and reveals the rest on demand", () => {
    const entries = Array.from({ length: 35 }, (_, i) =>
      entry({ id: `e${i}`, date: daysAgo(i), description: `Day ${i}` })
    );
    renderPage(entries);
    // Widen past the default 30 days, or the range filter — not the pager —
    // is what's hiding the tail.
    fireEvent.click(screen.getByRole("button", { name: "Last 90 days" }));

    expect(screen.queryByText("Day 32")).toBeNull();
    const more = screen.getByRole("button", { name: /Load more \(5 more days\)/ });
    fireEvent.click(more);
    expect(screen.getByText("Day 32")).toBeTruthy();
  });

  it("resets paging when the filter changes, so 'Load more' state can't carry over", () => {
    const entries = Array.from({ length: 35 }, (_, i) =>
      entry({ id: `e${i}`, date: daysAgo(i), description: `Day ${i}` })
    );
    renderPage(entries);
    fireEvent.click(screen.getByRole("button", { name: "Last 90 days" }));

    fireEvent.click(screen.getByRole("button", { name: /Load more/ }));
    expect(screen.getByText("Day 32")).toBeTruthy();

    // Search for something every entry matches: the list is the same length,
    // but the page count has to start over.
    fireEvent.change(screen.getByLabelText(/Search entries/), { target: { value: "Day" } });
    expect(screen.queryByText("Day 32")).toBeNull();
  });
});
