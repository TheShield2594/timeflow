/**
 * The calendar's pointer gestures, tested without a grid (#115).
 *
 * These used to live in CalendarPage's closure, which meant every assertion
 * about a snap boundary, a threshold, or a DST clamp had to go through a
 * rendered 672-cell grid — and jsdom reports every getBoundingClientRect as
 * zeroes, so the geometry had to be faked at the DOM level anyway. Here the
 * grid rect is one stub and the rest is arithmetic.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useDragCreate, useEntryMove, useEntryResize } from "./useCalendarDrag";
import { PX_PER_MIN, SLOT_HEIGHT } from "../utils/calendarGeometry";
import type { Project, TimeEntry } from "../types";

/** A grid whose top edge is at y=0, so clientY *is* the offset into the day. */
function stubGrid() {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 700, bottom: 1728, width: 700, height: 1728, x: 0, y: 0, toJSON: () => ({}) });
  return { current: el };
}

const captured: { pointerId: number }[] = [];
function pointer(over: Partial<{ button: number; clientX: number; clientY: number; pointerType: string }> = {}) {
  return {
    button: 0, clientX: 100, clientY: 0, pointerType: "mouse", pointerId: 1,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: { setPointerCapture: (id: number) => captured.push({ pointerId: id }) },
    currentTarget: {
      setPointerCapture: (id: number) => captured.push({ pointerId: id }),
      releasePointerCapture: vi.fn(),
    },
    ...over,
  } as unknown as React.PointerEvent;
}

/** clientY for a given minutes-of-day, on the stub grid. */
const atMinutes = (min: number) => min * PX_PER_MIN;

const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: "e1", projectId: "p1", description: "Standup",
  date: "2026-07-29",
  startTime: new Date("2026-07-29T09:00:00").toISOString(),
  endTime: new Date("2026-07-29T10:00:00").toISOString(),
  durationMinutes: 60,
  userId: "u1", userDisplayName: "U",
  ...over,
});

afterEach(() => { cleanup(); captured.length = 0; vi.clearAllMocks(); });

describe("useDragCreate", () => {
  function setup() {
    const openCreate = vi.fn();
    const onSlotFocus = vi.fn();
    const { result } = renderHook(() => useDragCreate(stubGrid(), openCreate, onSlotFocus));
    return { result, openCreate, onSlotFocus };
  }

  it("opens the create modal on the default span when the press never moves", () => {
    const { result, openCreate, onSlotFocus } = setup();

    act(() => { result.current.onPointerDown(pointer() as never, "2026-07-29", 18, 2); });
    expect(onSlotFocus).toHaveBeenCalledWith({ row: 18, col: 2 });
    expect(result.current.state).toMatchObject({ dayStr: "2026-07-29", fromRow: 18, toRow: 18 });

    act(() => { result.current.onPointerUp(pointer({ clientY: 18 * SLOT_HEIGHT + 4 }) as never); });
    // No end minute: openCreate falls back to its own +1h default, which is
    // exactly what a plain click always did.
    expect(openCreate).toHaveBeenCalledWith("2026-07-29", 18 * 30);
    expect(result.current.state).toBeNull();
  });

  it("passes the dragged span, inclusive of the slot the pointer ended in", () => {
    const { result, openCreate } = setup();

    act(() => { result.current.onPointerDown(pointer() as never, "2026-07-29", 18, 2); });
    act(() => { result.current.onPointerMove(pointer({ clientY: 21 * SLOT_HEIGHT + 4 }) as never); });
    expect(result.current.state?.toRow).toBe(21);

    act(() => { result.current.onPointerUp(pointer({ clientY: 21 * SLOT_HEIGHT + 4 }) as never); });
    expect(openCreate).toHaveBeenCalledWith("2026-07-29", 18 * 30, 22 * 30);
  });

  it("normalises an upward drag so start is always before end", () => {
    const { result, openCreate } = setup();

    act(() => { result.current.onPointerDown(pointer() as never, "2026-07-29", 21, 2); });
    act(() => { result.current.onPointerUp(pointer({ clientY: 18 * SLOT_HEIGHT + 4 }) as never); });

    expect(openCreate).toHaveBeenCalledWith("2026-07-29", 18 * 30, 22 * 30);
  });

  it("drops the drag on cancel rather than opening the modal", () => {
    const { result, openCreate } = setup();

    act(() => { result.current.onPointerDown(pointer() as never, "2026-07-29", 18, 2); });
    act(() => { result.current.onPointerCancel(); });

    expect(result.current.state).toBeNull();
    expect(openCreate).not.toHaveBeenCalled();
  });

  it("ignores a non-primary button", () => {
    const { result } = setup();
    act(() => { result.current.onPointerDown(pointer({ button: 2 }) as never, "2026-07-29", 18, 2); });
    expect(result.current.state).toBeNull();
  });
});

describe("useEntryResize", () => {
  function setup() {
    const onEdit = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() => useEntryResize(stubGrid(), onEdit));
    return { result, onEdit };
  }

  it("previews the dragged edge and commits an elapsed duration", async () => {
    const { result, onEdit } = setup();
    const e = entry();

    act(() => { result.current.onStart(pointer() as never, e, "end"); });
    act(() => { result.current.onMove(pointer({ clientY: atMinutes(11 * 60) }) as never); });
    expect(result.current.preview).toEqual({ entryId: "e1", edge: "end", minutes: 11 * 60 });

    await act(async () => { await result.current.onEnd(pointer({ clientY: atMinutes(11 * 60) }) as never); });

    expect(onEdit).toHaveBeenCalledWith("e1", {
      endTime: new Date("2026-07-29T11:00:00").toISOString(),
      durationMinutes: 120,
    });
    expect(result.current.preview).toBeNull();
  });

  it("moves the start edge without touching the end", async () => {
    const { result, onEdit } = setup();

    act(() => { result.current.onStart(pointer() as never, entry(), "start"); });
    await act(async () => { await result.current.onEnd(pointer({ clientY: atMinutes(9 * 60 + 30) }) as never); });

    expect(onEdit).toHaveBeenCalledWith("e1", {
      startTime: new Date("2026-07-29T09:30:00").toISOString(),
      durationMinutes: 30,
    });
  });

  it("refuses to shrink an entry below the minimum span", async () => {
    const { result, onEdit } = setup();

    // Dragging the end edge up to the start would make a zero-length entry.
    act(() => { result.current.onStart(pointer() as never, entry(), "end"); });
    await act(async () => { await result.current.onEnd(pointer({ clientY: atMinutes(9 * 60) }) as never); });

    expect(onEdit).toHaveBeenCalledWith("e1", expect.objectContaining({ durationMinutes: 15 }));
  });

  it("saves nothing when the edge lands where it started", async () => {
    const { result, onEdit } = setup();

    act(() => { result.current.onStart(pointer() as never, entry(), "end"); });
    await act(async () => { await result.current.onEnd(pointer({ clientY: atMinutes(10 * 60) }) as never); });

    expect(onEdit).not.toHaveBeenCalled();
  });

  it("won't resize an entry whose real end is on the next day", () => {
    // The block is clamped to 24:00 on the grid, so dragging either edge
    // would rewrite a span the user can't see.
    const { result } = setup();
    const overnight = entry({ endTime: new Date("2026-07-30T01:00:00").toISOString() });

    act(() => { result.current.onStart(pointer() as never, overnight, "end"); });
    expect(result.current.preview).toBeNull();
  });

  it("drops the preview on cancel without saving", async () => {
    const { result, onEdit } = setup();

    act(() => { result.current.onStart(pointer() as never, entry(), "end"); });
    act(() => { result.current.cancel(); });
    await act(async () => { await result.current.onEnd(pointer({ clientY: atMinutes(11 * 60) }) as never); });

    expect(onEdit).not.toHaveBeenCalled();
  });

  it("measures across a fall-back midnight in elapsed minutes, not clock minutes", async () => {
    // 2026-11-01 in America/New_York is 25 hours. An entry dragged to end at
    // the bottom of the grid ran 25 hours, not 24 (#87).
    const { result, onEdit } = setup();
    const dstEntry = entry({
      date: "2026-11-01",
      startTime: new Date("2026-11-01T00:00:00").toISOString(),
      endTime: new Date("2026-11-01T01:00:00").toISOString(),
    });

    act(() => { result.current.onStart(pointer() as never, dstEntry, "end"); });
    await act(async () => { await result.current.onEnd(pointer({ clientY: atMinutes(24 * 60) }) as never); });

    expect(onEdit).toHaveBeenCalledWith("e1", {
      endTime: new Date("2026-11-02T00:00:00").toISOString(),
      durationMinutes: 25 * 60,
    });
  });
});

describe("useEntryMove", () => {
  const weekDays = [
    "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30",
    "2026-07-31", "2026-08-01", "2026-08-02",
  ].map((d) => new Date(`${d}T00:00:00`));

  function setup() {
    const onEdit = vi.fn().mockResolvedValue({});
    const projectById = new Map<string, Project>([
      ["p1", { id: "p1", name: "Alpha", color: "#719500", isActive: true, createdAt: "" }],
    ]);
    const { result } = renderHook(() => useEntryMove({
      gridRef: stubGrid(),
      weekDays,
      weekBounds: { from: "2026-07-27", to: "2026-08-02" },
      projectById,
      onEdit,
    }));
    // Day columns 100px apart, so a clientX picks a weekday.
    weekDays.forEach((_, i) => {
      const el = document.createElement("div");
      el.getBoundingClientRect = () =>
        ({ left: i * 100, right: (i + 1) * 100, top: 0, bottom: 0, width: 100, height: 0, x: 0, y: 0, toJSON: () => ({}) });
      act(() => { result.current.registerDayColumn(i, el); });
    });
    return { result, onEdit };
  }

  it("treats a press that barely moves as a click, not a reschedule", () => {
    const { result, onEdit } = setup();

    act(() => { result.current.onStart(pointer({ clientX: 250, clientY: atMinutes(9 * 60) }) as never, entry()); });
    act(() => { result.current.onMove(pointer({ clientX: 251, clientY: atMinutes(9 * 60) + 1 }) as never); });
    act(() => { result.current.onEnd(pointer({ clientX: 251, clientY: atMinutes(9 * 60) + 1 }) as never); });

    expect(result.current.preview).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
    // And the click that follows still opens the edit modal.
    expect(result.current.consumeSuppressedClick()).toBe(false);
  });

  it("moves an entry to another day, preserving its duration", () => {
    const { result, onEdit } = setup();

    act(() => { result.current.onStart(pointer({ clientX: 250, clientY: atMinutes(9 * 60) }) as never, entry()); });
    // Thursday (column 3), 14:00.
    act(() => { result.current.onMove(pointer({ clientX: 350, clientY: atMinutes(14 * 60) }) as never); });
    expect(result.current.preview).toEqual({
      entryId: "e1", date: "2026-07-30", startMin: 14 * 60, durationMin: 60,
    });

    act(() => { result.current.onEnd(pointer({ clientX: 350, clientY: atMinutes(14 * 60) }) as never); });

    expect(onEdit).toHaveBeenCalledWith("e1", {
      date: "2026-07-30",
      startTime: new Date("2026-07-30T14:00:00").toISOString(),
      endTime: new Date("2026-07-30T15:00:00").toISOString(),
      durationMinutes: 60,
    });
    // The click the browser sends next is the tail of the drag, not an edit.
    expect(result.current.consumeSuppressedClick()).toBe(true);
    // ...and reading it clears it, so it can't leak into the next gesture.
    expect(result.current.consumeSuppressedClick()).toBe(false);
  });

  it("leaves touch alone — a finger-drag on a block is usually a scroll", () => {
    const { result } = setup();
    act(() => {
      result.current.onStart(pointer({ pointerType: "touch", clientX: 250, clientY: atMinutes(9 * 60) }) as never, entry());
    });
    act(() => { result.current.onMove(pointer({ clientX: 350, clientY: atMinutes(14 * 60) }) as never); });
    expect(result.current.preview).toBeNull();
  });

  it("swallows the click after a cancelled drag that had already moved", () => {
    const { result, onEdit } = setup();

    act(() => { result.current.onStart(pointer({ clientX: 250, clientY: atMinutes(9 * 60) }) as never, entry()); });
    act(() => { result.current.onMove(pointer({ clientX: 350, clientY: atMinutes(14 * 60) }) as never); });
    act(() => { result.current.cancel(); });

    expect(onEdit).not.toHaveBeenCalled();
    // Escape drops the move; without this, it would then open the edit modal
    // on the way out.
    expect(result.current.consumeSuppressedClick()).toBe(true);
  });

  it("nudges by real minutes and announces where the entry landed", () => {
    const { result, onEdit } = setup();

    act(() => { result.current.nudge(entry(), 15, 0); });

    expect(onEdit).toHaveBeenCalledWith("e1", {
      date: "2026-07-29",
      startTime: new Date("2026-07-29T09:15:00").toISOString(),
      endTime: new Date("2026-07-29T10:15:00").toISOString(),
      durationMinutes: 60,
    });
    expect(result.current.nudgeMessage).toContain("Standup moved to");
    expect(result.current.refocusIdRef.current).toBe("e1");
  });

  it("won't nudge an entry off the week on screen", () => {
    const { result, onEdit } = setup();
    // Monday is the first column; a step back would leave the visible week.
    const monday = entry({
      date: "2026-07-27",
      startTime: new Date("2026-07-27T09:00:00").toISOString(),
      endTime: new Date("2026-07-27T10:00:00").toISOString(),
    });

    act(() => { result.current.nudge(monday, 0, -1); });

    expect(onEdit).not.toHaveBeenCalled();
  });

  it("steps over the hour a spring-forward day skips", () => {
    // 2026-03-08 in America/New_York loses 02:00–03:00. A 15-minute nudge
    // from 01:45 has to land at 03:00, not in an hour that doesn't exist.
    const { result, onEdit } = setup();
    const dstEntry = entry({
      date: "2026-03-08",
      startTime: new Date("2026-03-08T01:45:00").toISOString(),
      endTime: new Date("2026-03-08T03:00:00").toISOString(),
    });

    act(() => { result.current.nudge(dstEntry, 15, 0); });

    expect(onEdit).toHaveBeenCalledWith("e1", expect.objectContaining({
      startTime: new Date("2026-03-08T03:00:00").toISOString(),
    }));
  });
});
