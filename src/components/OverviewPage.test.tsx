import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { OverviewPage } from "./OverviewPage";
import { DataRangeProvider } from "../contexts/DataRangeContext";
import { addDaysStr, localDateStr } from "../utils/dates";
import type { TimeEntry, Project } from "../types";

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
// The hooks barrel transitively imports the generated Dataverse SDK; this
// page only needs formatMinutes from it, so stub the rest (same approach as
// CalendarPage.test.tsx) to avoid loading the SDK's broken transitive deps.
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

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

function renderOverview(
  entries: TimeEntry[],
  projects: Project[] = [PROJECT],
  overrides: Partial<React.ComponentProps<typeof OverviewPage>> = {}
) {
  return render(
    <DataRangeProvider>
      <OverviewPage
        entries={entries}
        projects={projects}
        tasks={[]}
        onContinue={vi.fn()}
        onGoToProjects={vi.fn()}
        {...overrides}
      />
    </DataRangeProvider>
  );
}

/** A KPI card's value, found via its label. Scoped to .kpi-card because both
 *  the duration strings and the word "Today" also appear in the today strip
 *  and the Recent entries list. */
function kpiValue(label: string): string | null {
  const card = screen.getAllByText(label).map((el) => el.closest(".kpi-card")).find(Boolean);
  return card?.querySelector(".kpi-card__value")?.textContent ?? null;
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

  it("names the last day with time on it instead of reporting a bare 0m today", () => {
    // "0m today" beside a populated heatmap reads like a page that failed to
    // load; the date says the same thing unambiguously.
    const entries = [makeEntry(3, 60)];
    renderOverview(entries);
    expect(kpiValue("Today")).toBe("—");
    const expected = new Date(addDaysStr(localDateStr(), -3) + "T00:00:00").toLocaleDateString("en", {
      weekday: "short", month: "short", day: "numeric",
    });
    expect(screen.getByText(`Last logged ${expected}`)).not.toBeNull();
  });

  it("drops the last-logged note once something is tracked today", () => {
    renderOverview([makeEntry(0, 90), makeEntry(3, 60)]);
    expect(screen.queryByText(/Last logged/)).toBeNull();
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
    const { container } = renderOverview(entries);
    const recent = container.querySelector(".quick-starts__recent") as HTMLElement;
    const descs = within(recent).getAllByText(/^Work \d$/).map((el) => el.textContent);
    expect(descs).toEqual(["Work 0", "Work 1", "Work 2"]);
  });

  it("keeps the heatmap but drops the 7-day chart Reports already owns", () => {
    renderOverview([makeEntry(0, 90)]);
    expect(screen.queryByText("Last 7 Days")).toBeNull();
    expect(screen.getByText("Activity")).not.toBeNull();
    expect(screen.getByText("Less")).not.toBeNull();
    expect(screen.getByText("More")).not.toBeNull();
  });
});

describe("OverviewPage quick starts", () => {
  it("offers the most recent distinct piece of work, deduped", () => {
    // Two entries on the same project/description collapse to one button.
    const entries = [makeEntry(0, 90), makeEntry(1, 60, { description: "Work 0" }), makeEntry(2, 45)];
    const { container } = renderOverview(entries);

    const labels = Array.from(container.querySelectorAll(".quick-start__desc")).map((el) => el.textContent);
    expect(labels).toEqual(["Work 0", "Work 2"]);
  });

  it("starts the timer on the entry behind the button", () => {
    const onContinue = vi.fn();
    const entry = makeEntry(0, 90);
    const { container } = renderOverview([entry], [PROJECT], { onContinue });

    fireEvent.click(container.querySelector(".quick-start") as HTMLButtonElement);
    expect(onContinue).toHaveBeenCalledWith(entry);
  });

  it("leaves out work whose project has since been archived", () => {
    const { container } = renderOverview([makeEntry(0, 90)], [{ ...PROJECT, isActive: false }]);
    expect(container.querySelectorAll(".quick-start")).toHaveLength(0);
  });

  it("disables the buttons while a timer is already running", () => {
    const { container } = renderOverview([makeEntry(0, 90)], [PROJECT], { timerBusy: true });
    expect((container.querySelector(".quick-start") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("OverviewPage today strip", () => {
  // The strip caps its gap search at the current minute, so the wall clock
  // would otherwise decide how many gaps a fixture produces. Freeze it at
  // 17:00 — after the working day's entries, before its 18:00 close.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 17, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function timed(id: string, startHM: string, endHM: string, minutes: number): TimeEntry {
    const today = localDateStr();
    return {
      id,
      projectId: PROJECT.id,
      description: id,
      startTime: `${today}T${startHM}:00`,
      endTime: `${today}T${endHM}:00`,
      durationMinutes: minutes,
      date: today,
      userId: "user-1",
      userDisplayName: "User One",
    };
  }

  /** Every gap the strip is currently offering, as its aria-label. */
  function gapLabels(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll(".today-strip__gap"))
      .map((el) => el.getAttribute("aria-label") ?? "");
  }

  it("offers each untracked stretch of the working day as a log target", () => {
    // 09:00–10:00, a 90-minute hole, 11:30–12:30 — plus the untracked time
    // before the first block (08:00) and after the last one (up to now).
    const { container } = renderOverview([timed("a", "09:00", "10:00", 60), timed("b", "11:30", "12:30", 60)]);

    const labels = gapLabels(container);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toContain("8 AM to 9 AM");
    expect(labels[1]).toContain("10 AM to 11:30 AM");
    expect(labels[2]).toContain("12:30 PM to 5 PM");
  });

  it("ignores sub-15-minute slivers between back-to-back blocks", () => {
    const { container } = renderOverview([timed("a", "08:00", "10:00", 120), timed("b", "10:05", "17:00", 415)]);
    expect(gapLabels(container)).toEqual([]);
  });

  it("does not treat overlapping entries as a gap", () => {
    const { container } = renderOverview([timed("a", "08:00", "17:00", 540), timed("b", "10:00", "11:00", 60)]);
    expect(gapLabels(container)).toEqual([]);
  });

  it("does not offer the rest of the day before it has happened", () => {
    // 08:00–17:00 is fully covered, and 17:00–18:00 hasn't arrived yet.
    const { container } = renderOverview([timed("a", "08:00", "17:00", 540)]);
    expect(gapLabels(container)).toEqual([]);
  });

  it("opens a prefilled entry form when a gap is clicked", () => {
    const { container } = renderOverview(
      [timed("a", "09:00", "10:00", 60), timed("b", "11:30", "12:30", 60)],
      [PROJECT],
      { onCreate: vi.fn(), onLoadTasksForProject: vi.fn() }
    );

    // The middle gap — the 10:00–11:30 hole between the two blocks.
    fireEvent.click(container.querySelectorAll(".today-strip__gap")[1] as HTMLButtonElement);

    expect(screen.getByRole("dialog", { name: "Log untracked time" })).not.toBeNull();
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("10:00");
    expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("11:30");
  });

  it("does not let a zero-length entry black out the rest of the day", () => {
    // A timer started and stopped inside the same minute. The block and the
    // gap detector read it from the same helper now, so neither the drawing
    // nor the detector can call 09:00–midnight tracked (#92).
    const { container } = renderOverview([timed("a", "08:00", "09:00", 60), timed("b", "09:00", "09:00", 0)]);

    expect(gapLabels(container)).toHaveLength(1);
    expect(gapLabels(container)[0]).toContain("9 AM to 5 PM");
    const blocks = Array.from(container.querySelectorAll(".today-strip__block"));
    expect(blocks.map((b) => (b as HTMLElement).style.width)).toEqual(["10%", "0%"]);
  });

  it("only counts today toward the strip's tracked total", () => {
    const { container } = renderOverview([timed("a", "09:00", "10:00", 60), makeEntry(3, 120)]);
    expect(container.querySelector(".today-strip__tracked")?.textContent).toBe("1h");
  });
});

describe("OverviewPage weekly target ring", () => {
  it("offers to set a target when none exists", () => {
    renderOverview([makeEntry(0, 90)]);
    expect(screen.getByText("Set a weekly target")).not.toBeNull();
  });

  it("shows progress toward a target that is set", () => {
    localStorage.setItem("tt_weekly_target:env-1:user-1", "10");
    const { container } = renderOverview([makeEntry(0, 300)]);

    expect(container.querySelector(".target-ring__pct")?.textContent).toBe("50%");
    expect(container.querySelector(".target-ring__value")?.textContent).toBe("5h / 10h");
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
