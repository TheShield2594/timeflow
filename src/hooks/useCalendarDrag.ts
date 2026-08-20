/**
 * The week calendar's three pointer gestures — create by dragging across
 * empty slots, resize by dragging an entry's edge, move by dragging the block
 * itself — plus the keyboard nudge that is the move gesture without a mouse.
 *
 * They lived inside CalendarPage's closure until #115, which made them
 * untestable in isolation: every assertion about a snap boundary or a DST
 * clamp had to go through a rendered 672-cell grid whose
 * getBoundingClientRect jsdom reports as zeroes. The arithmetic itself is in
 * utils/calendarGeometry; what's here is the state machine each gesture runs,
 * and each one is genuinely a state machine — a press that may or may not
 * become a drag, a preview that must not commit, a cancel that has to
 * suppress the click the browser will send anyway.
 *
 * Every handler returns the previous state object unchanged when the pointer
 * hasn't crossed into a new snap increment, which makes React bail out of the
 * render entirely. A pointermove fires at 60–120 Hz and each one used to
 * re-render the whole grid, while the value being dragged moves once per
 * increment.
 *
 * Nothing here writes a duration from clock-face arithmetic: on a 23- or
 * 25-hour day that contradicts its own timestamps (#87). Durations come from
 * `minutesBetween` over real instants, and placements from `placeEntry`.
 */
import { useCallback, useRef, useState } from "react";
import type React from "react";
import type { Project, TimeEntry } from "../types";
import {
  addDaysStr, dateAtMinutes, localDateStr, minutesBetween, minutesOfDay,
} from "../utils/dates";
import {
  ColumnRect,
  MINUTES_PER_DAY,
  MIN_RESIZE_DURATION_MIN,
  MOVE_THRESHOLD_PX,
  PX_PER_MIN,
  SNAP_MIN,
  clampMoveStart,
  dayIndexFromClientX,
  placeEntry,
  rowFromOffsetY,
  snapMinutesFromOffsetY,
} from "../utils/calendarGeometry";

type GridRef = React.RefObject<HTMLDivElement | null>;
type EditEntry = (id: string, data: Partial<TimeEntry>) => Promise<TimeEntry>;

/**
 * An entry whose real end is on the next calendar day is clamped to 24:00 on
 * the grid, so dragging either of its edges would rewrite a span the user
 * can't see. Both gestures refuse it rather than guessing.
 */
function isReshapable(entry: TimeEntry): boolean {
  return !!entry.endTime && localDateStr(new Date(entry.endTime)) <= entry.date;
}

// ---------------------------------------------------------------------------
// Drag to create
// ---------------------------------------------------------------------------

export interface DragCreateState {
  dayStr: string;
  dayIdx: number;
  fromRow: number;
  toRow: number;
}

export interface DragCreate {
  /** Non-null while a create drag is in progress; drives the preview block. */
  state: DragCreateState | null;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, dayStr: string, row: number, col: number) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  cancel: () => void;
}

/**
 * Press on an empty slot, drag to extend the range, release to open the
 * create modal pre-filled with the dragged span. A press that never moves
 * behaves exactly like the old plain click, which is why `openCreate` takes
 * an optional end.
 */
export function useDragCreate(
  gridRef: GridRef,
  openCreate: (dayStr: string, startMin: number, endMin?: number) => void,
  /** Adopt the pressed cell as the grid's roving-tabindex focus. */
  onSlotFocus: (cell: { row: number; col: number }) => void,
): DragCreate {
  const [state, setState] = useState<DragCreateState | null>(null);

  const rowFromClientY = useCallback((clientY: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return rowFromOffsetY(clientY - rect.top);
  }, [gridRef]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, dayStr: string, row: number, col: number) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    onSlotFocus({ row, col });
    setState({ dayStr, dayIdx: col, fromRow: row, toRow: row });
  }, [onSlotFocus]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!state) return;
    const toRow = rowFromClientY(e.clientY);
    setState((prev) => (prev && prev.toRow !== toRow ? { ...prev, toRow } : prev));
  }, [state, rowFromClientY]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!state) return;
    const toRow = rowFromClientY(e.clientY);
    const fromRow = Math.min(state.fromRow, toRow);
    const lastRow = Math.max(state.fromRow, toRow);
    setState(null);
    // A press that never left its slot opens the create modal on openCreate's
    // default span, exactly as a plain click always did.
    if (fromRow === lastRow) openCreate(state.dayStr, fromRow * 30);
    else openCreate(state.dayStr, fromRow * 30, (lastRow + 1) * 30);
  }, [state, rowFromClientY, openCreate]);

  // A cancelled pointer (an OS gesture interrupts the drag) drops the drag
  // rather than silently opening the create modal.
  const cancel = useCallback(() => setState(null), []);

  return { state, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: cancel, cancel };
}

// ---------------------------------------------------------------------------
// Drag to resize
// ---------------------------------------------------------------------------

export interface ResizePreview {
  entryId: string;
  edge: "start" | "end";
  minutes: number;
}

export interface EntryResize {
  /** Non-null while resizing; the block renders this edge instead of its own. */
  preview: ResizePreview | null;
  onStart: (e: React.PointerEvent, entry: TimeEntry, edge: "start" | "end") => void;
  onMove: (e: React.PointerEvent) => void;
  onEnd: (e: React.PointerEvent) => void;
  cancel: () => void;
}

/**
 * Drag a handle at an entry block's top or bottom edge. Previews just the one
 * entry rather than re-running the day's column layout on every pointermove.
 */
export function useEntryResize(gridRef: GridRef, onEdit: EditEntry): EntryResize {
  const [preview, setPreview] = useState<ResizePreview | null>(null);
  const resizingRef = useRef<{ entry: TimeEntry; edge: "start" | "end" } | null>(null);

  const minutesFromClientY = useCallback((clientY: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return snapMinutesFromOffsetY(clientY - rect.top);
  }, [gridRef]);

  const onStart = useCallback((e: React.PointerEvent, entry: TimeEntry, edge: "start" | "end") => {
    if (e.button !== 0 || !isReshapable(entry)) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizingRef.current = { entry, edge };
    const minutes = edge === "start" ? minutesOfDay(entry.startTime) : minutesOfDay(entry.endTime!);
    setPreview({ entryId: entry.id, edge, minutes });
  }, []);

  /** Where the dragged edge would land, respecting the minimum span. */
  const edgeMinutes = useCallback((entry: TimeEntry, edge: "start" | "end", clientY: number) => {
    const startMinutes = minutesOfDay(entry.startTime);
    const endMinutes = minutesOfDay(entry.endTime!);
    const raw = minutesFromClientY(clientY);
    return edge === "start"
      ? Math.max(0, Math.min(raw, endMinutes - MIN_RESIZE_DURATION_MIN))
      : Math.max(startMinutes + MIN_RESIZE_DURATION_MIN, Math.min(raw, MINUTES_PER_DAY));
  }, [minutesFromClientY]);

  const onMove = useCallback((e: React.PointerEvent) => {
    const state = resizingRef.current;
    if (!state) return;
    const { entry, edge } = state;
    const minutes = edgeMinutes(entry, edge, e.clientY);
    setPreview((prev) =>
      prev && prev.entryId === entry.id && prev.edge === edge && prev.minutes === minutes
        ? prev
        : { entryId: entry.id, edge, minutes }
    );
  }, [edgeMinutes]);

  const cancel = useCallback(() => {
    resizingRef.current = null;
    setPreview(null);
  }, []);

  const onEnd = useCallback(async (e: React.PointerEvent) => {
    const state = resizingRef.current;
    resizingRef.current = null;
    setPreview(null);
    if (!state) return;
    const { entry, edge } = state;
    const next = edgeMinutes(entry, edge, e.clientY);
    const current = minutesOfDay(edge === "start" ? entry.startTime : entry.endTime!);
    if (next === current) return;

    // Both edges resolve the dragged edge to an instant and measure the span
    // against the *other* edge's existing instant, so durationMinutes is
    // always elapsed time (#87). A drag that lands in the hour a
    // spring-forward day skips can collapse the span to nothing — that isn't
    // a resize the user can have meant, so it's abandoned rather than saved
    // as a zero-length entry.
    //
    // MINUTES_PER_DAY resolves to the next day's midnight, walked on the
    // calendar — the end of *this* day whatever its length.
    const movedDt = dateAtMinutes(entry.date, next);
    const durationMinutes = edge === "start"
      ? minutesBetween(movedDt, entry.endTime!)
      : minutesBetween(entry.startTime, movedDt);
    if (durationMinutes < MIN_RESIZE_DURATION_MIN) return;

    // The entries hook rolls back and toasts on failure; catching here just
    // keeps a failed save from surfacing as an unhandled rejection.
    await onEdit(entry.id, {
      [edge === "start" ? "startTime" : "endTime"]: movedDt.toISOString(),
      durationMinutes,
    }).catch(() => {});
  }, [edgeMinutes, onEdit]);

  return { preview, onStart, onMove, onEnd, cancel };
}

// ---------------------------------------------------------------------------
// Drag to move, and its keyboard equivalent
// ---------------------------------------------------------------------------

export interface MovePreview {
  entryId: string;
  date: string;
  startMin: number;
  durationMin: number;
}

export interface EntryMove {
  /** Non-null while moving; drawn as a ghost in the target day column. */
  preview: MovePreview | null;
  onStart: (e: React.PointerEvent, entry: TimeEntry) => void;
  onMove: (e: React.PointerEvent) => void;
  onEnd: (e: React.PointerEvent) => void;
  cancel: () => void;
  /** Register a day column's element so a drag can find which one it's over. */
  registerDayColumn: (idx: number, el: HTMLDivElement | null) => void;
  /** Shift + arrows: ±15 minutes vertically, ±1 day horizontally. */
  nudge: (entry: TimeEntry, deltaMin: number, deltaDays: number) => void;
  /** What the last nudge did, for the live region. */
  nudgeMessage: string;
  /** Id of the entry to put focus back on once the reschedule re-renders. */
  refocusIdRef: React.MutableRefObject<string | null>;
  /**
   * True when the click the browser sends after a real drag should be
   * swallowed. Reading it clears it, so a swallowed-but-never-delivered
   * click can't leak into the following interaction.
   */
  consumeSuppressedClick: () => boolean;
}

interface MoveOptions {
  gridRef: GridRef;
  weekDays: Date[];
  /** The displayed week's bounds; a nudge can't carry an entry outside it. */
  weekBounds: { from: string; to: string };
  projectById: Map<string, Project>;
  onEdit: EditEntry;
}

/**
 * Press anywhere on a completed entry block and drag it to another slot —
 * another time, another day, or both. The entry keeps its duration; only its
 * start (and date) move. Below MOVE_THRESHOLD_PX the gesture is still a plain
 * click that opens the edit modal, so the pointer drift in an ordinary click
 * can't silently reschedule anything.
 *
 * The drop target is drawn as a separate ghost in the day column rather than
 * by relocating the block itself: the block holds the pointer capture, and
 * re-parenting it into another cell mid-drag would unmount the captured node
 * and strand the gesture with no pointerup to commit it.
 */
export function useEntryMove({ gridRef, weekDays, weekBounds, projectById, onEdit }: MoveOptions): EntryMove {
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [nudgeMessage, setNudgeMessage] = useState("");
  const refocusIdRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const dayColRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const movingRef = useRef<{
    entry: TimeEntry;
    durationMin: number;
    /** Minutes between the entry's start and where the pointer grabbed it. */
    grabOffsetMin: number;
    originX: number;
    originY: number;
    gridTop: number;
    dayColumns: ColumnRect[];
    moved: boolean;
    target: { date: string; startMin: number } | null;
  } | null>(null);

  const registerDayColumn = useCallback((idx: number, el: HTMLDivElement | null) => {
    if (el) dayColRefs.current.set(idx, el);
    else dayColRefs.current.delete(idx);
  }, []);

  const readDayColumns = useCallback((): ColumnRect[] =>
    weekDays.map((_, i) => {
      const rect = dayColRefs.current.get(i)?.getBoundingClientRect();
      return { left: rect?.left ?? 0, right: rect?.right ?? 0 };
    }), [weekDays]);

  /** Elapsed length of an entry, floored at the minimum a drag can produce. */
  const durationOf = (entry: TimeEntry) =>
    Math.max(minutesBetween(entry.startTime, entry.endTime!), MIN_RESIZE_DURATION_MIN);

  const onStart = useCallback((e: React.PointerEvent, entry: TimeEntry) => {
    suppressClickRef.current = false;
    if (e.button !== 0 || !isReshapable(entry)) return;
    // Touch is left alone deliberately: the block sits inside a vertically
    // scrollable grid, and a finger-drag starting on an entry is far more
    // often a scroll than a reschedule. Touch users get the edit modal (and
    // keyboard users get Shift + arrows, below).
    if (e.pointerType === "touch") return;
    const gridRect = gridRef.current?.getBoundingClientRect();
    if (!gridRect) return;
    const startMin = minutesOfDay(entry.startTime);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    movingRef.current = {
      entry,
      // Elapsed minutes, not the difference of two clock readings — a move
      // preserves how long the entry actually ran (#87).
      durationMin: durationOf(entry),
      grabOffsetMin: (e.clientY - gridRect.top) / PX_PER_MIN - startMin,
      originX: e.clientX,
      originY: e.clientY,
      gridTop: gridRect.top,
      dayColumns: readDayColumns(),
      moved: false,
      target: null,
    };
  }, [gridRef, readDayColumns]);

  const onMove = useCallback((e: React.PointerEvent) => {
    const state = movingRef.current;
    if (!state) return;
    if (!state.moved) {
      const dx = e.clientX - state.originX;
      const dy = e.clientY - state.originY;
      if (Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) return;
      state.moved = true;
    }
    const day = weekDays[dayIndexFromClientX(e.clientX, state.dayColumns)];
    if (!day) return;
    // Snap the *grabbed point* back onto the entry's start, so the block
    // follows the cursor from wherever it was picked up rather than jumping
    // its top edge under the pointer.
    const rawStart = (e.clientY - state.gridTop) / PX_PER_MIN - state.grabOffsetMin;
    const snapped = Math.round(rawStart / SNAP_MIN) * SNAP_MIN;
    const target = {
      date: localDateStr(day),
      startMin: clampMoveStart(snapped, state.durationMin),
    };
    state.target = target;
    setPreview((prev) =>
      prev
        && prev.entryId === state.entry.id
        && prev.date === target.date
        && prev.startMin === target.startMin
        && prev.durationMin === state.durationMin
        ? prev
        : { entryId: state.entry.id, durationMin: state.durationMin, ...target }
    );
  }, [weekDays]);

  const cancel = useCallback(() => {
    // A cancelled drag that had already moved still ends in a pointerup and
    // therefore a click — swallow it, or Escape would drop the move and then
    // open the edit modal on the way out.
    if (movingRef.current?.moved) suppressClickRef.current = true;
    movingRef.current = null;
    setPreview(null);
  }, []);

  const onEnd = useCallback((e: React.PointerEvent) => {
    const state = movingRef.current;
    movingRef.current = null;
    setPreview(null);
    if (!state) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    // Never travelled far enough to be a drag — leave the click alone so it
    // opens the edit modal exactly as it always did.
    if (!state.moved) return;
    suppressClickRef.current = true;
    const { entry, durationMin, target } = state;
    if (!target) return;
    if (target.date === entry.date && target.startMin === minutesOfDay(entry.startTime)) return;
    // The entries hook rolls the optimistic update back and toasts on
    // failure, so there's nothing to do here but not crash on rejection.
    void onEdit(entry.id, {
      date: target.date,
      ...placeEntry(target.date, dateAtMinutes(target.date, target.startMin), durationMin),
    }).catch(() => {});
  }, [onEdit]);

  const nudge = useCallback((entry: TimeEntry, deltaMin: number, deltaDays: number) => {
    if (!isReshapable(entry)) return;
    const durationMin = durationOf(entry);
    // Clamped to the week on screen, exactly like a drag: the day columns
    // bound how far a pointer can carry a block, and an entry nudged off the
    // edge would simply vanish from the view the user is working in.
    const stepped = deltaDays ? addDaysStr(entry.date, deltaDays) : entry.date;
    const date = stepped < weekBounds.from || stepped > weekBounds.to ? entry.date : stepped;
    // A vertical nudge shifts the entry by real minutes, so on a
    // spring-forward day it steps over the hour that doesn't exist instead of
    // landing in it; a day step keeps the wall-clock time the user reads off
    // the grid (#87).
    const startDt = deltaMin
      ? new Date(new Date(entry.startTime).getTime() + deltaMin * 60000)
      : dateAtMinutes(date, minutesOfDay(entry.startTime));
    const placed = placeEntry(date, startDt, durationMin);
    if (date === entry.date && placed.startTime === new Date(entry.startTime).toISOString()) return;
    // The block is rendered inside the gridcell it starts in, so a nudge
    // across a 30-minute boundary (or onto another day) remounts it in a
    // different cell and the focused node stops existing. Remember what to
    // put focus back on once the new node is in the DOM (#89).
    refocusIdRef.current = entry.id;
    const label = entry.description || projectById.get(entry.projectId)?.name || "Entry";
    const time = (iso: string) =>
      new Date(iso).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
    setNudgeMessage(
      `${label} moved to ${new Date(placed.startTime).toLocaleDateString("en", {
        weekday: "long", month: "long", day: "numeric",
      })}, ${time(placed.startTime)} – ${time(placed.endTime)}`
    );
    void onEdit(entry.id, { date, ...placed }).catch(() => {});
  }, [onEdit, projectById, weekBounds]);

  const consumeSuppressedClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  return {
    preview, onStart, onMove, onEnd, cancel, registerDayColumn,
    nudge, nudgeMessage, refocusIdRef, consumeSuppressedClick,
  };
}
