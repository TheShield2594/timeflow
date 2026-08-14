import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, createEvent, fireEvent, within } from "@testing-library/react";
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

function renderCalendarWith(
  entries: Parameters<typeof CalendarPage>[0]["entries"],
  onEdit: Parameters<typeof CalendarPage>[0]["onEdit"] = vi.fn(),
) {
  return render(
    <DataRangeProvider>
      <CalendarPage
        entries={entries}
        projects={[project]}
        tasks={[]}
        onCreateEntry={vi.fn()}
        onEdit={onEdit}
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

  it("exposes real rows as the parents of their gridcells (grid → row → gridcell)", () => {
    renderCalendar();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(48);
    // Every gridcell's parent is a row, and each row owns exactly 7 cells —
    // the hierarchy assistive tech relies on (would collapse if the row
    // container used display:contents and got dropped from the a11y tree).
    rows.forEach((r) => expect(within(r).getAllByRole("gridcell")).toHaveLength(7));
    screen.getAllByRole("gridcell").forEach((c) => {
      expect(c.parentElement?.getAttribute("role")).toBe("row");
    });
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

// ── Pointer-driven calendar tests (drag-move, resize) share this geometry ──

// 1.2px per minute (36px per 30-min slot), so a clientY of 648 is 09:00.
const PX_PER_MIN = 36 / 30;
const COL_WIDTH = 100;
const GUTTER = 50;

/** Give the grid and its day columns real geometry — jsdom reports every
 *  getBoundingClientRect as zeroes, and the drag maths is measured, not
 *  guessed. Columns are keyed off the grid-column each day column sets. */
function stubGridGeometry() {
  const rect = (left: number, right: number): DOMRect => ({
    left, right, top: 0, bottom: 48 * 36, x: left, y: 0,
    width: right - left, height: 48 * 36, toJSON: () => ({}),
  }) as DOMRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const el = this as HTMLElement;
    if (el.classList.contains("calendar__grid")) return rect(0, GUTTER + 7 * COL_WIDTH);
    if (el.classList.contains("calendar__day-col")) {
      const idx = Number(el.style.gridColumn) - 2;
      return rect(GUTTER + idx * COL_WIDTH, GUTTER + (idx + 1) * COL_WIDTH);
    }
    return rect(0, 0);
  };
}

/** Register the stubs a pointer-driven calendar test needs, and undo them. */
function useStubbedGrid() {
  const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    stubGridGeometry();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = realGetBoundingClientRect;
  });
}

/** Local YYYY-MM-DD for a weekday of the week the calendar is showing. */
function weekDayStr(offsetFromMonday: number): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offsetFromMonday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const xOfDay = (dayIdx: number) => GUTTER + dayIdx * COL_WIDTH + COL_WIDTH / 2;
const yOfMinutes = (min: number) => min * PX_PER_MIN;
const iso = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`).toISOString();

function nineToTenOn(date: string, id = "e1") {
  return {
    id, projectId: "p1", description: "Standup",
    startTime: `${date}T09:00:00`, endTime: `${date}T10:00:00`,
    durationMinutes: 60, date, userId: "u1", userDisplayName: "U",
  };
}

const pointer = (clientX: number, clientY: number) => ({
  clientX, clientY, button: 0, pointerId: 1, pointerType: "mouse",
});

/** jsdom has no PointerEvent, so fireEvent.pointerX() constructs a plain
 *  Event and silently drops clientX/clientY/button/pointerType — the very
 *  fields the drag maths runs on. Define them back onto the event before
 *  dispatching, which is what a real browser hands React. */
function firePointer(
  kind: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel",
  el: Element,
  init: Record<string, unknown>,
) {
  const event = createEvent[kind](el, init);
  Object.entries(init).forEach(([key, value]) => {
    Object.defineProperty(event, key, { value, configurable: true });
  });
  fireEvent(el, event);
}

describe("CalendarPage drag-to-move (#79)", () => {
  useStubbedGrid();

  it("reschedules an entry to the day and time it was dropped on, keeping its duration", () => {
    const mon = weekDayStr(0);
    const wed = weekDayStr(2);
    const onEdit = vi.fn().mockResolvedValue({});
    renderCalendarWith([nineToTenOn(mon)], onEdit);

    const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
    firePointer("pointerDown", block, pointer(xOfDay(0), yOfMinutes(9 * 60)));
    firePointer("pointerMove", block, pointer(xOfDay(2), yOfMinutes(11 * 60)));
    firePointer("pointerUp", block, pointer(xOfDay(2), yOfMinutes(11 * 60)));

    expect(onEdit).toHaveBeenCalledWith("e1", {
      date: wed,
      startTime: iso(wed, "11:00"),
      endTime: iso(wed, "12:00"),
      durationMinutes: 60,
    });
  });

  it("ghosts the drop target in the destination column while keeping the dragged block mounted", () => {
    const mon = weekDayStr(0);
    renderCalendarWith([nineToTenOn(mon)], vi.fn().mockResolvedValue({}));

    const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
    firePointer("pointerDown", block, pointer(xOfDay(0), yOfMinutes(9 * 60)));
    firePointer("pointerMove", block, pointer(xOfDay(2), yOfMinutes(11 * 60)));

    const columns = document.querySelectorAll(".calendar__day-col");
    const ghost = columns[2].querySelector(".cal-move-preview");
    expect(ghost).not.toBeNull();
    expect(ghost!.textContent).toContain("11:00 AM");
    expect(ghost!.textContent).toContain("12:00 PM");
    expect(columns[0].querySelector(".cal-move-preview")).toBeNull();

    // The block keeps the pointer capture, so it must stay exactly where it
    // is until the drop commits — only its styling says it's in flight.
    expect(block.isConnected).toBe(true);
    expect(block.className).toContain("cal-entry--moving");
  });

  it("keeps the grab offset, so the block follows the cursor instead of snapping its top edge to it", () => {
    const mon = weekDayStr(0);
    const onEdit = vi.fn().mockResolvedValue({});
    renderCalendarWith([nineToTenOn(mon)], onEdit);

    const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
    // Grabbed 30 minutes down the block (09:30) and dropped at 14:30 — the
    // entry starts at 14:00, not 14:30.
    firePointer("pointerDown", block, pointer(xOfDay(0), yOfMinutes(9 * 60 + 30)));
    firePointer("pointerMove", block, pointer(xOfDay(0), yOfMinutes(14 * 60 + 30)));
    firePointer("pointerUp", block, pointer(xOfDay(0), yOfMinutes(14 * 60 + 30)));

    expect(onEdit).toHaveBeenCalledWith("e1", expect.objectContaining({
      date: mon,
      startTime: iso(mon, "14:00"),
      endTime: iso(mon, "15:00"),
    }));
  });

  it("clamps a drop past midnight so the entry still ends within its day", () => {
    const mon = weekDayStr(0);
    const onEdit = vi.fn().mockResolvedValue({});
    renderCalendarWith([nineToTenOn(mon)], onEdit);

    const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
    firePointer("pointerDown", block, pointer(xOfDay(0), yOfMinutes(9 * 60)));
    firePointer("pointerMove", block, pointer(xOfDay(0), yOfMinutes(30 * 60)));
    firePointer("pointerUp", block, pointer(xOfDay(0), yOfMinutes(30 * 60)));

    expect(onEdit).toHaveBeenCalledWith("e1", expect.objectContaining({
      startTime: iso(mon, "23:00"),
      durationMinutes: 60,
    }));
  });

  it("treats a press that barely moves as a click that opens the editor", () => {
    const mon = weekDayStr(0);
    const onEdit = vi.fn().mockResolvedValue({});
    renderCalendarWith([nineToTenOn(mon)], onEdit);

    const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
    firePointer("pointerDown", block, pointer(xOfDay(0), yOfMinutes(9 * 60)));
    firePointer("pointerMove", block, pointer(xOfDay(0) + 2, yOfMinutes(9 * 60) + 1));
    firePointer("pointerUp", block, pointer(xOfDay(0) + 2, yOfMinutes(9 * 60) + 1));
    fireEvent.click(block);

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText("Edit Entry")).not.toBeNull();
  });

  it("does not open the editor on the click that ends a real drag", () => {
    const mon = weekDayStr(0);
    const onEdit = vi.fn().mockResolvedValue({});
    renderCalendarWith([nineToTenOn(mon)], onEdit);

    const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
    firePointer("pointerDown", block, pointer(xOfDay(0), yOfMinutes(9 * 60)));
    firePointer("pointerMove", block, pointer(xOfDay(1), yOfMinutes(11 * 60)));
    firePointer("pointerUp", block, pointer(xOfDay(1), yOfMinutes(11 * 60)));
    fireEvent.click(block);

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Edit Entry")).toBeNull();
  });

  it("drops the move on Escape, and doesn't open the editor on the way out", () => {
    const mon = weekDayStr(0);
    const onEdit = vi.fn().mockResolvedValue({});
    renderCalendarWith([nineToTenOn(mon)], onEdit);

    const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
    firePointer("pointerDown", block, pointer(xOfDay(0), yOfMinutes(9 * 60)));
    firePointer("pointerMove", block, pointer(xOfDay(1), yOfMinutes(11 * 60)));
    fireEvent.keyDown(window, { key: "Escape" });
    firePointer("pointerUp", block, pointer(xOfDay(1), yOfMinutes(11 * 60)));
    fireEvent.click(block);

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByText("Edit Entry")).toBeNull();
  });

  it("ignores a drop that lands the entry exactly where it started", () => {
    const mon = weekDayStr(0);
    const onEdit = vi.fn().mockResolvedValue({});
    renderCalendarWith([nineToTenOn(mon)], onEdit);

    const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
    firePointer("pointerDown", block, pointer(xOfDay(0), yOfMinutes(9 * 60)));
    // Far enough to count as a drag, but within the same quarter-hour snap.
    firePointer("pointerMove", block, pointer(xOfDay(0), yOfMinutes(9 * 60) + 5));
    firePointer("pointerUp", block, pointer(xOfDay(0), yOfMinutes(9 * 60) + 5));

    expect(onEdit).not.toHaveBeenCalled();
  });

  it("leaves the running session where it is — the timer owns it", () => {
    const mon = weekDayStr(0);
    const onEdit = vi.fn().mockResolvedValue({});
    renderCalendarWith([
      {
        id: "run", projectId: "p1", description: "In progress",
        startTime: `${mon}T09:00:00`, date: mon, userId: "u1", userDisplayName: "U",
      },
    ], onEdit);

    const block = screen.getByText("In progress").closest(".cal-entry")!;
    firePointer("pointerDown", block, pointer(xOfDay(0), yOfMinutes(9 * 60)));
    firePointer("pointerMove", block, pointer(xOfDay(2), yOfMinutes(13 * 60)));
    firePointer("pointerUp", block, pointer(xOfDay(2), yOfMinutes(13 * 60)));

    expect(onEdit).not.toHaveBeenCalled();
  });

  it("does not start a move from a touch pointer, so the grid still scrolls", () => {
    const mon = weekDayStr(0);
    const onEdit = vi.fn().mockResolvedValue({});
    renderCalendarWith([nineToTenOn(mon)], onEdit);

    const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
    firePointer("pointerDown", block, { ...pointer(xOfDay(0), yOfMinutes(9 * 60)), pointerType: "touch" });
    firePointer("pointerMove", block, { ...pointer(xOfDay(2), yOfMinutes(13 * 60)), pointerType: "touch" });
    firePointer("pointerUp", block, { ...pointer(xOfDay(2), yOfMinutes(13 * 60)), pointerType: "touch" });

    expect(onEdit).not.toHaveBeenCalled();
  });

  describe("keyboard equivalent (Shift + arrows)", () => {
    it("nudges the entry a quarter hour at a time", () => {
      const mon = weekDayStr(0);
      const onEdit = vi.fn().mockResolvedValue({});
      renderCalendarWith([nineToTenOn(mon)], onEdit);

      const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
      fireEvent.keyDown(block, { key: "ArrowDown", shiftKey: true });

      expect(onEdit).toHaveBeenCalledWith("e1", {
        date: mon,
        startTime: iso(mon, "09:15"),
        endTime: iso(mon, "10:15"),
        durationMinutes: 60,
      });
    });

    it("moves the entry a day at a time", () => {
      const mon = weekDayStr(0);
      const tue = weekDayStr(1);
      const onEdit = vi.fn().mockResolvedValue({});
      renderCalendarWith([nineToTenOn(mon)], onEdit);

      const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
      fireEvent.keyDown(block, { key: "ArrowRight", shiftKey: true });

      expect(onEdit).toHaveBeenCalledWith("e1", expect.objectContaining({
        date: tue,
        startTime: iso(tue, "09:00"),
      }));
    });

    it("stops at the edge of the displayed week instead of moving the entry out of view", () => {
      const sun = weekDayStr(6);
      const onEdit = vi.fn().mockResolvedValue({});
      renderCalendarWith([nineToTenOn(sun)], onEdit);

      const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
      fireEvent.keyDown(block, { key: "ArrowRight", shiftKey: true });

      expect(onEdit).not.toHaveBeenCalled();
    });

    it("leaves plain arrow keys to the grid's roving focus", () => {
      const mon = weekDayStr(0);
      const onEdit = vi.fn().mockResolvedValue({});
      renderCalendarWith([nineToTenOn(mon)], onEdit);

      const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
      fireEvent.keyDown(block, { key: "ArrowDown" });

      expect(onEdit).not.toHaveBeenCalled();
    });
  });

  // Blocks live inside the gridcell they start in, so any nudge that crosses
  // a 30-minute or day boundary remounts them somewhere else in the DOM.
  // Focus used to fall to <body> on every second Shift+Down and on every
  // Shift+Left/Right — defeating the keyboard alternative to the drag (#89).
  describe("keyboard focus survives the reschedule (#89)", () => {
    /** Re-render with the edit applied, the way the entries hook does
     *  optimistically, so the block really is remounted into its new cell. */
    function renderWithApply(entry: ReturnType<typeof nineToTenOn>) {
      const onEdit = vi.fn().mockResolvedValue({});
      const view = renderCalendarWith([entry], onEdit);
      const rerenderWith = (patch: Record<string, unknown>) =>
        view.rerender(
          <DataRangeProvider>
            <CalendarPage
              entries={[{ ...entry, ...patch } as typeof entry]}
              projects={[project]}
              tasks={[]}
              onCreateEntry={vi.fn()}
              onEdit={onEdit}
              onDelete={vi.fn()}
            />
          </DataRangeProvider>
        );
      return { onEdit, rerenderWith };
    }

    it("puts focus back on the block after a nudge into a different slot cell", () => {
      const mon = weekDayStr(0);
      // 09:45 → 10:00 crosses into the next half-hour row, the case that used
      // to drop focus.
      const entry = { ...nineToTenOn(mon), startTime: `${mon}T09:45:00`, endTime: `${mon}T10:45:00` };
      const { onEdit, rerenderWith } = renderWithApply(entry);

      const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
      block.focus();
      fireEvent.keyDown(block, { key: "ArrowDown", shiftKey: true });
      rerenderWith(onEdit.mock.calls[0][1]);

      const moved = screen.getByRole("button", { name: /Edit entry: Standup/ });
      expect(moved).not.toBe(block);
      expect(document.activeElement).toBe(moved);
    });

    it("puts focus back on the block after a nudge to another day", () => {
      const mon = weekDayStr(0);
      const { onEdit, rerenderWith } = renderWithApply(nineToTenOn(mon));

      const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
      block.focus();
      fireEvent.keyDown(block, { key: "ArrowRight", shiftKey: true });
      rerenderWith(onEdit.mock.calls[0][1]);

      expect(document.activeElement).toBe(screen.getByRole("button", { name: /Edit entry: Standup/ }));
    });

    it("does not take focus back from wherever the user moved it meanwhile", () => {
      const mon = weekDayStr(0);
      const { onEdit, rerenderWith } = renderWithApply(nineToTenOn(mon));

      const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
      block.focus();
      fireEvent.keyDown(block, { key: "ArrowRight", shiftKey: true });
      const elsewhere = screen.getByRole("button", { name: "Next week" });
      elsewhere.focus();
      rerenderWith(onEdit.mock.calls[0][1]);

      expect(document.activeElement).toBe(elsewhere);
    });

    it("announces the entry's new time, which nothing else confirms", () => {
      const mon = weekDayStr(0);
      renderCalendarWith([nineToTenOn(mon)], vi.fn().mockResolvedValue({}));

      const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
      fireEvent.keyDown(block, { key: "ArrowDown", shiftKey: true });

      const status = screen.getByRole("status");
      expect(status.textContent).toContain("Standup moved to");
      expect(status.textContent).toContain("9:15 AM");
      expect(status.textContent).toContain("10:15 AM");
    });
  });
});

describe("CalendarPage totals include the running session (#74)", () => {
  // Fixed clock so "elapsed so far" is deterministic. Local noon on today's
  // date, with the running entry started at 09:00 local — 180 minutes ago.
  function freezeAtNoon(): string {
    const ds = todayStr();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${ds}T12:00:00`));
    return ds;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts elapsed time of the running entry in the day and week totals", () => {
    const ds = freezeAtNoon();
    renderCalendarWith([
      {
        id: "run", projectId: "p1", description: "In progress",
        startTime: `${ds}T09:00:00`, date: ds, userId: "u1", userDisplayName: "U",
      },
    ]);

    // The running entry has no durationMinutes, so both totals used to read
    // zero while the block on screen visibly grew.
    expect(screen.getByText("3h this week")).not.toBeNull();
    expect(screen.getAllByText("3h").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Nothing logged this week/)).toBeNull();
  });

  it("adds the running time on top of completed entries for the same day", () => {
    const ds = freezeAtNoon();
    renderCalendarWith([
      {
        id: "done", projectId: "p1", description: "Done",
        startTime: `${ds}T07:00:00`, endTime: `${ds}T08:00:00`,
        durationMinutes: 60, date: ds, userId: "u1", userDisplayName: "U",
      },
      {
        id: "run", projectId: "p1", description: "In progress",
        startTime: `${ds}T09:00:00`, date: ds, userId: "u1", userDisplayName: "U",
      },
    ]);

    expect(screen.getByText("4h this week")).not.toBeNull();
  });

  it("leaves totals alone when nothing is running", () => {
    const ds = freezeAtNoon();
    renderCalendarWith([
      {
        id: "done", projectId: "p1", description: "Done",
        startTime: `${ds}T07:00:00`, endTime: `${ds}T08:00:00`,
        durationMinutes: 60, date: ds, userId: "u1", userDisplayName: "U",
      },
    ]);

    expect(screen.getByText("1h this week")).not.toBeNull();
  });
});

describe("CalendarPage untracked gaps (P2-15)", () => {
  /** Freeze the clock inside the working day so "the rest of today" is a
   *  fixed span rather than whatever time the suite happens to run at. */
  function freezeAt(hour: number): string {
    const ds = todayStr();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${ds}T${String(hour).padStart(2, "0")}:00:00`));
    return ds;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  function logged(ds: string, id: string, startHM: string, endHM: string, minutes: number) {
    return {
      id, projectId: "p1", description: id,
      startTime: `${ds}T${startHM}:00`, endTime: `${ds}T${endHM}:00`,
      durationMinutes: minutes, date: ds, userId: "u1", userDisplayName: "U",
    };
  }

  function gapButtons(): HTMLElement[] {
    return screen.queryAllByRole("button", { name: /Log the untracked/ });
  }

  it("draws a slot over each untracked stretch of the working day", () => {
    const ds = freezeAt(17);
    renderCalendarWith([
      logged(ds, "morning", "09:00", "10:00", 60),
      logged(ds, "afternoon", "11:30", "12:30", 60),
    ]);

    // 08:00→09:00, 10:00→11:30, and 12:30→now.
    expect(gapButtons()).toHaveLength(3);
    expect(gapButtons()[1].getAttribute("aria-label")).toContain("1h 30m");
  });

  it("shows the gap's length on the block", () => {
    const ds = freezeAt(17);
    renderCalendarWith([
      logged(ds, "a", "08:00", "10:00", 120),
      logged(ds, "b", "11:00", "17:00", 360),
    ]);

    expect(screen.getByText("+ 1h untracked")).not.toBeNull();
  });

  it("leaves a fully-tracked day alone", () => {
    const ds = freezeAt(17);
    renderCalendarWith([logged(ds, "all-day", "08:00", "17:00", 540)]);
    expect(gapButtons()).toHaveLength(0);
  });

  it("does not flag a day with nothing logged on it", () => {
    freezeAt(17);
    renderCalendarWith([]);
    expect(gapButtons()).toHaveLength(0);
  });

  it("opens the log modal spanning the gap when one is clicked", () => {
    const ds = freezeAt(17);
    renderCalendarWith([
      logged(ds, "morning", "09:00", "10:00", 60),
      logged(ds, "afternoon", "11:30", "12:30", 60),
    ]);

    fireEvent.click(gapButtons()[1]);

    expect(screen.getByRole("dialog")).not.toBeNull();
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("10:00");
    expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("11:30");
  });

  // Past days are scanned once and cached, so they no longer see the current
  // time of day at all (#95) — which is the honest reading anyway.
  it("closes a still-running entry at the end of its own day, not at today's clock", () => {
    vi.useFakeTimers();
    // A fixed midweek day, so "yesterday" is in the rendered week whatever day
    // the suite actually runs on.
    vi.setSystemTime(new Date("2026-08-12T10:00:00"));
    renderCalendarWith([
      {
        id: "overnight", projectId: "p1", description: "overnight",
        startTime: "2026-08-11T09:00:00",
        date: "2026-08-11", userId: "u1", userDisplayName: "U",
      },
    ]);

    // Only 08:00→09:00 is untracked. Reading today's 10:00 onto yesterday
    // would invent an untracked afternoon the timer was in fact running for.
    const yesterdayGaps = gapButtons()
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter((label) => label.includes("August 11"));
    expect(yesterdayGaps).toHaveLength(1);
    expect(yesterdayGaps[0]).toContain("8:00 AM – 9:00 AM");
  });

  it("does not offer gaps on a day that hasn't happened yet", () => {
    const ds = freezeAt(17);
    // Tomorrow is in the same rendered week for six days out of seven; on the
    // seventh the entry simply isn't in view, and no gaps is still correct.
    const d = new Date(`${ds}T12:00:00`);
    d.setDate(d.getDate() + 1);
    const tomorrow = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    renderCalendarWith([logged(tomorrow, "ahead", "09:00", "10:00", 60)]);
    expect(gapButtons()).toHaveLength(0);
  });
});

/**
 * The days the clocks move (#87).
 *
 * Every calendar write path used to derive `durationMinutes` by subtracting
 * two minutes-of-day readings while storing wall-clock timestamps. On a 23-
 * or 25-hour day those two representations disagree, and the entry was saved
 * with a duration contradicting its own timestamps: an hour under-billed
 * every autumn, an hour over-billed every spring, and a zero-length entry for
 * anything dropped in the hour that doesn't exist.
 *
 * The suite runs in America/New_York (vitest.config.ts), so these are the
 * real transitions rather than a simulation of them.
 */
describe("CalendarPage across a DST transition (#87)", () => {
  useStubbedGrid();

  const FALL_BACK = "2026-11-01";   // 01:00–02:00 happens twice; a 25-hour day
  const SPRING_FORWARD = "2026-03-08"; // 02:00–03:00 never happens; 23 hours

  /** Show the week containing `date`, with the clock frozen inside it. */
  function showWeekOf(date: string) {
    vi.useFakeTimers();
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 2); // Wednesday of that week
    vi.setSystemTime(d);
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  function entryOn(date: string, from: string, to: string, durationMinutes: number) {
    return {
      id: "e1", projectId: "p1", description: "Standup",
      startTime: `${date}T${from}:00`, endTime: `${date}T${to}:00`,
      durationMinutes, date, userId: "u1", userDisplayName: "U",
    };
  }

  it("bills the extra hour when a resize spans the repeated hour", () => {
    showWeekOf(FALL_BACK);
    const onEdit = vi.fn().mockResolvedValue({});
    // 01:00 (EDT) → 02:00 (EST) is already two real hours.
    renderCalendarWith([entryOn(FALL_BACK, "01", "02", 120)], onEdit);

    const handle = document.querySelector(".cal-entry__handle--bottom")!;
    firePointer("pointerDown", handle, pointer(xOfDay(6), yOfMinutes(120)));
    firePointer("pointerUp", handle, pointer(xOfDay(6), yOfMinutes(180)));

    // Dragged out to 03:00, which is three hours after 01:00 on this day.
    // The old maths wrote 120 and the timesheet lost an hour of real work.
    expect(onEdit).toHaveBeenCalledWith("e1", {
      endTime: iso(FALL_BACK, "03:00"),
      durationMinutes: 180,
    });
  });

  it("keeps a moved entry's real length when it lands after the repeated hour", () => {
    showWeekOf(FALL_BACK);
    const onEdit = vi.fn().mockResolvedValue({});
    renderCalendarWith([entryOn(FALL_BACK, "01", "03", 180)], onEdit);

    const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
    firePointer("pointerDown", block, pointer(xOfDay(6), yOfMinutes(60)));
    firePointer("pointerMove", block, pointer(xOfDay(6), yOfMinutes(10 * 60)));
    firePointer("pointerUp", block, pointer(xOfDay(6), yOfMinutes(10 * 60)));

    // Three real hours, moved to a part of the day with no transition in it:
    // 10:00 → 13:00, still three hours.
    expect(onEdit).toHaveBeenCalledWith("e1", {
      date: FALL_BACK,
      startTime: iso(FALL_BACK, "10:00"),
      endTime: iso(FALL_BACK, "13:00"),
      durationMinutes: 180,
    });
  });

  it("does not collapse an entry dropped on the hour that never happens", () => {
    showWeekOf(SPRING_FORWARD);
    const mon = weekDayStr(0);
    const onEdit = vi.fn().mockResolvedValue({});
    renderCalendarWith([nineToTenOn(mon)], onEdit);

    const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
    firePointer("pointerDown", block, pointer(xOfDay(0), yOfMinutes(9 * 60)));
    firePointer("pointerMove", block, pointer(xOfDay(6), yOfMinutes(120)));
    firePointer("pointerUp", block, pointer(xOfDay(6), yOfMinutes(120)));

    // 02:00 doesn't exist that morning, so the drop resolves to 03:00 — and
    // the entry keeps its hour instead of being saved with start === end.
    const [, patch] = onEdit.mock.calls[0];
    expect(patch).toEqual({
      date: SPRING_FORWARD,
      startTime: iso(SPRING_FORWARD, "03:00"),
      endTime: iso(SPRING_FORWARD, "04:00"),
      durationMinutes: 60,
    });
    expect(patch.startTime).not.toBe(patch.endTime);
  });

  it("nudges by real minutes, stepping over the hour the clocks skip", () => {
    showWeekOf(SPRING_FORWARD);
    const onEdit = vi.fn().mockResolvedValue({});
    // 01:45 (EST) → 03:45 (EDT): an hour of real time, either side of the gap.
    renderCalendarWith([entryOn(SPRING_FORWARD, "01:45", "03:45", 60)], onEdit);

    const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
    fireEvent.keyDown(block, { key: "ArrowDown", shiftKey: true });

    // A quarter hour after 01:45 is 03:00 that morning — the wall clock jumps
    // an hour because fifteen minutes of real time did.
    expect(onEdit).toHaveBeenCalledWith("e1", {
      date: SPRING_FORWARD,
      startTime: iso(SPRING_FORWARD, "03:00"),
      endTime: iso(SPRING_FORWARD, "04:00"),
      durationMinutes: 60,
    });
  });

  it("clamps a move to the real end of a 25-hour day", () => {
    showWeekOf(FALL_BACK);
    const onEdit = vi.fn().mockResolvedValue({});
    renderCalendarWith([entryOn(FALL_BACK, "09", "10", 60)], onEdit);

    const block = screen.getByRole("button", { name: /Edit entry: Standup/ });
    firePointer("pointerDown", block, pointer(xOfDay(6), yOfMinutes(9 * 60)));
    firePointer("pointerMove", block, pointer(xOfDay(6), yOfMinutes(30 * 60)));
    firePointer("pointerUp", block, pointer(xOfDay(6), yOfMinutes(30 * 60)));

    // Dropped past the bottom of the grid: the entry ends at midnight, which
    // on this day is 25 hours after the day began, not 24.
    expect(onEdit).toHaveBeenCalledWith("e1", {
      date: FALL_BACK,
      startTime: iso(FALL_BACK, "23:00"),
      endTime: iso("2026-11-02", "00:00"),
      durationMinutes: 60,
    });
  });
});
