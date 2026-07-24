import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CalendarPage } from "./CalendarPage";
import { DataRangeProvider } from "../contexts/DataRangeContext";

vi.mock("../services/userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
}));
// The hooks barrel re-exports hooks that transitively import the generated
// Dataverse SDK; CalendarPage only needs formatMinutes from it, so stub the
// rest to avoid loading the SDK's broken transitive dependency at import time.
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  // jsdom doesn't implement scrollTo; CalendarPage calls it to scroll to the workday on mount.
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCalendar() {
  return render(
    <DataRangeProvider>
      <CalendarPage
        entries={[]}
        projects={[]}
        tasks={[]}
        onCreateEntry={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    </DataRangeProvider>
  );
}

// A local YYYY-MM-DD for a day in the currently-displayed week (the calendar
// anchors to today), so seeded entries land inside the rendered grid.
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const project = { id: "p1", name: "Project One", color: "#719500", isActive: true, createdAt: "" };

function renderCalendarWith(entries: Parameters<typeof CalendarPage>[0]["entries"]) {
  return render(
    <DataRangeProvider>
      <CalendarPage
        entries={entries}
        projects={[project]}
        tasks={[]}
        onCreateEntry={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    </DataRangeProvider>
  );
}

describe("CalendarPage keyboard navigation", () => {
  it("renders the week grid with ARIA grid semantics", () => {
    renderCalendar();
    const grid = screen.getByRole("grid", { name: "Week calendar" });
    expect(grid).not.toBeNull();
    expect(screen.getAllByRole("gridcell").length).toBe(48 * 7);
  });

  it("starts with exactly one gridcell tabbable, and arrow keys move the roving tabindex", () => {
    renderCalendar();
    const cells = screen.getAllByRole("gridcell");
    const tabbable = cells.filter((c) => c.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);

    fireEvent.keyDown(tabbable[0], { key: "ArrowDown" });

    const tabbableAfter = screen.getAllByRole("gridcell").filter((c) => c.getAttribute("tabindex") === "0");
    expect(tabbableAfter).toHaveLength(1);
    expect(tabbableAfter[0]).not.toBe(tabbable[0]);
    expect(document.activeElement).toBe(tabbableAfter[0]);
  });

  it("does not move focus past the first or last day column", () => {
    renderCalendar();
    const initial = screen.getAllByRole("gridcell").find((c) => c.getAttribute("tabindex") === "0")!;

    fireEvent.keyDown(initial, { key: "ArrowLeft" });
    const afterLeft = screen.getAllByRole("gridcell").find((c) => c.getAttribute("tabindex") === "0")!;
    expect(afterLeft).toBe(initial); // already in the first (Monday) column

    for (let i = 0; i < 7; i++) {
      fireEvent.keyDown(screen.getAllByRole("gridcell").find((c) => c.getAttribute("tabindex") === "0")!, { key: "ArrowRight" });
    }
    const afterRight = screen.getAllByRole("gridcell").find((c) => c.getAttribute("tabindex") === "0")!;
    expect(afterRight.getAttribute("aria-colindex")).toBe("7"); // clamped to Sunday
  });

  it("opens the create modal at the focused slot's time on Enter", () => {
    renderCalendar();
    const cell = screen.getAllByRole("gridcell").find((c) => c.getAttribute("tabindex") === "0")!;
    expect(cell.getAttribute("aria-label")).toContain("7:00 AM");

    fireEvent.keyDown(cell, { key: "Enter" });

    expect(screen.getByText("Log Time")).not.toBeNull();
    expect(screen.getByDisplayValue("07:00")).not.toBeNull();
  });
});

describe("CalendarPage entry accessibility", () => {
  it("renders a completed entry as an editable button inside a gridcell", () => {
    const ds = todayStr();
    renderCalendarWith([
      {
        id: "e1", projectId: "p1", description: "Design review",
        startTime: `${ds}T09:00:00`, endTime: `${ds}T10:00:00`,
        durationMinutes: 60, date: ds, userId: "u1", userDisplayName: "U",
      },
    ]);

    // The block is reachable as a labeled button (issue #3: entries used to sit
    // outside any row/gridcell, so grid navigation never reached them)…
    const block = screen.getByRole("button", { name: /Edit entry: Design review/ });
    // …and it lives inside a gridcell, so the ARIA grid actually contains it.
    expect(block.closest('[role="gridcell"]')).not.toBeNull();
  });

  it("does not expose the running entry block as a focusable button", () => {
    const ds = todayStr();
    renderCalendarWith([
      {
        id: "run", projectId: "p1", description: "In progress",
        startTime: `${ds}T09:00:00`, date: ds, userId: "u1", userDisplayName: "U",
      },
    ]);

    // The running session is owned by the timer bar; activating its calendar
    // block does nothing, so it must not be a focusable button that no-ops.
    expect(screen.queryByRole("button", { name: /Running session/ })).toBeNull();
    expect(screen.getByText("In progress")).not.toBeNull();
  });
});
