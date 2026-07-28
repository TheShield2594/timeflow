import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { OverviewPage } from "./OverviewPage";
import { DataRangeProvider } from "../contexts/DataRangeContext";
import { addDaysStr, localDateStr } from "../utils/dates";
import type { TimeEntry, Project } from "../types";

vi.mock("../services/userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
}));
// The hooks barrel transitively imports the generated Dataverse SDK; this
// page only needs formatMinutes from it, so stub the rest (same approach as
// CalendarPage.test.tsx) to avoid loading the SDK's broken transitive deps.
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

beforeEach(() => {
  // jsdom has no ResizeObserver — SvgBarChart (used by the "Last 7 Days"
  // panel) needs one to exist, even if it never actually fires.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

const PROJECT: Project = {
  id: "proj-1", name: "Website Redesign", color: "#3b82f6", isActive: true, createdAt: "2024-01-01T00:00:00Z",
};

function makeEntry(daysAgo: number, minutes: number, overrides: Partial<TimeEntry> = {}): TimeEntry {
  const date = addDaysStr(localDateStr(), -daysAgo);
  return {
    id: `entry-${daysAgo}-${minutes}`,
    projectId: PROJECT.id,
    description: `Work ${daysAgo}`,
    startTime: `${date}T09:00:00`,
    endTime: `${date}T${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`,
    durationMinutes: minutes,
    date,
    userId: "user-1",
    userDisplayName: "User One",
    ...overrides,
  };
}

function renderOverview(entries: TimeEntry[], projects: Project[] = [PROJECT]) {
  return render(
    <DataRangeProvider>
      <OverviewPage entries={entries} projects={projects} tasks={[]} onContinue={vi.fn()} onGoToProjects={vi.fn()} />
    </DataRangeProvider>
  );
}

/** A KPI card's value, found via its label — scoped this way because the
 *  same duration string can also appear in the Recent entries list below. */
function kpiValue(label: string): string | null {
  return screen.getByText(label).closest(".kpi-card")?.querySelector(".kpi-card__value")?.textContent ?? null;
}

describe("OverviewPage", () => {
  it("shows the first-run empty state when there are no entries and no projects", () => {
    renderOverview([], []);
    expect(screen.getByText(/create your first project/i)).not.toBeNull();
  });

  it("shows a narrower empty state when projects exist but nothing's tracked yet", () => {
    renderOverview([], [PROJECT]);
    expect(screen.getByText(/no time logged yet/i)).not.toBeNull();
  });

  it("sums today's entries into the Today KPI", () => {
    renderOverview([makeEntry(0, 90)]);
    expect(kpiValue("Today")).toBe("1h 30m");
  });

  it("sums the current calendar week into the This Week KPI", () => {
    // Today always falls inside its own calendar week, so with only one
    // entry (today's), Today and This Week show the same total.
    renderOverview([makeEntry(0, 90)]);
    expect(kpiValue("This week")).toBe("1h 30m");
  });

  it("excludes entries from a future week out of the This Week KPI", () => {
    // 14 days ahead always lands in a different week than today, regardless
    // of what weekday "today" happens to be.
    const entries = [makeEntry(0, 90), makeEntry(-14, 500)];
    renderOverview(entries);
    expect(kpiValue("This week")).toBe("1h 30m");
  });

  it("counts the current day streak, stopping at the first gap", () => {
    // today, yesterday, two days ago logged; three days ago is a gap.
    const entries = [makeEntry(0, 90), makeEntry(1, 60), makeEntry(2, 45)];
    renderOverview(entries);
    expect(kpiValue("Day streak")).toBe("3");
  });

  it("does not count today toward the streak until something is logged today", () => {
    const entries = [makeEntry(1, 60), makeEntry(2, 45)];
    renderOverview(entries);
    expect(kpiValue("Day streak")).toBe("2");
  });

  it("lists recent entries most-recent-first", () => {
    const entries = [makeEntry(2, 45), makeEntry(0, 90), makeEntry(1, 60)];
    renderOverview(entries);
    const descs = screen.getAllByText(/^Work \d$/).map((el) => el.textContent);
    expect(descs).toEqual(["Work 0", "Work 1", "Work 2"]);
  });

  it("renders the Last 7 Days chart and Activity heatmap panels", () => {
    renderOverview([makeEntry(0, 90)]);
    expect(screen.getByText("Last 7 Days")).not.toBeNull();
    expect(screen.getByText("Activity")).not.toBeNull();
    expect(screen.getByText("Less")).not.toBeNull();
    expect(screen.getByText("More")).not.toBeNull();
  });
});

describe("ActivityHeatmap accessible equivalent (#73)", () => {
  // makeEntry() dates its entry off the clock, the component buckets it off
  // the clock, and the expected label is built off the clock again. Freeze one
  // local instant so a run crossing midnight can't have them disagree.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes each logged day's total as text, not just a title tooltip", () => {
    // The grid cells are aria-hidden decoration and their `title` tooltips are
    // mouse-only, so the per-day values have to be reachable some other way.
    const date = addDaysStr(localDateStr(), -3);
    renderOverview([makeEntry(3, 90)]);

    const label = new Date(date + "T00:00:00").toLocaleDateString("en", {
      weekday: "short", month: "short", day: "numeric",
    });
    expect(screen.getByText(`${label}: 1h 30m`)).not.toBeNull();
    expect(screen.getByText(/busiest day totaled 1h 30m/)).not.toBeNull();
  });

  it("lists only days that have time logged", () => {
    const { container } = renderOverview([makeEntry(3, 90), makeEntry(5, 30)]);

    // Two logged days out of ~84 in the window — the empty ones must not be
    // enumerated, or the ones that matter get buried.
    const heatmap = container.querySelector(".activity-heatmap-wrap") as HTMLElement;
    expect(within(heatmap).getAllByRole("listitem")).toHaveLength(2);
  });

  it("says so plainly when the window holds no activity", () => {
    // Not entries: [] — that hits the page's empty state and the heatmap is
    // never rendered. An entry outside the 12-week window is the real case.
    renderOverview([makeEntry(200, 60)]);

    expect(screen.getByText(/No activity logged in the last 12 weeks/)).not.toBeNull();
  });
});
