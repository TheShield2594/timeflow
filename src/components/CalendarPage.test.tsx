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
