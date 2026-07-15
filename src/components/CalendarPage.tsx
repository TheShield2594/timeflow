import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimeEntry, Project, Task } from "../types";
import { getCurrentUser } from "../services/userService";
import { addDaysStr, localDateStr, minutesOfDay, toTimeInput } from "../utils/dates";
import { formatMinutes } from "../hooks";
import { useDataRange } from "../contexts/DataRangeContext";
import { useWeeklyTarget } from "../hooks/useWeeklyTarget";
import { EntryModal, EntryDraft, EntrySaveData } from "./EntryModal";
import { IconCheck, IconChevronLeft, IconChevronRight, IconPencil, IconX } from "./Icons";
import { RangeSpinner } from "./RangeSpinner";

interface Props {
  entries: TimeEntry[];
  projects: Project[];
  tasks: Task[];
  rangeLoading?: boolean;
  onCreateEntry: (data: Omit<TimeEntry, "id">) => Promise<TimeEntry>;
  onEdit: (id: string, data: Partial<TimeEntry>) => Promise<TimeEntry>;
  onDelete: (id: string) => void;
  onLoadTasksForProject?: (projectId: string) => void;
}

interface ModalState {
  editingId: string | null; // null = create
  draft: EntryDraft;
}

// Full 24h grid; we auto-scroll to the workday on mount so early/late entries
// are never silently hidden.
const SLOT_HEIGHT = 36; // px per 30-min slot
const SLOTS_PER_HOUR = 2;
const TOTAL_SLOTS = 24 * SLOTS_PER_HOUR;
const PX_PER_MIN = SLOT_HEIGHT / 30;
const SCROLL_TO_HOUR = 7;
const MIN_ENTRY_PX = 22;
// Drag-resize snaps to quarter-hour steps and can't shrink an entry below this.
const RESIZE_SNAP_MIN = 15;
const MIN_RESIZE_DURATION_MIN = 15;

function getWeekDays(anchor: Date): Date[] {
  const days: Date[] = [];
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

function formatHour(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display} ${suffix}`;
}

// Combine a date string with a minutes-of-day offset into an ISO timestamp,
// the same way EntryModal builds startTime/endTime from date + "HH:MM".
function isoAtMinutes(dateStr: string, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).toISOString();
}

// Describe a 30-min slot index (0-47) as a time, for gridcell aria-labels.
function formatSlotTime(slotIdx: number): string {
  const totalMin = slotIdx * 30;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return m === 0 ? `${display}:00 ${suffix}` : `${display}:${m} ${suffix}`;
}

interface Positioned {
  entry: TimeEntry;
  startMin: number;
  endMin: number;
  running: boolean;
  col: number;
  cols: number;
}

/**
 * Assign side-by-side columns to overlapping entries (Outlook-style).
 * Entries are clustered by transitive overlap; within a cluster each entry
 * takes the first column whose previous occupant has ended.
 */
function layoutDay(items: Omit<Positioned, "col" | "cols">[]): Positioned[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const result: Positioned[] = [];
  let cluster: Positioned[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const n = Math.max(colEnds.length, 1);
    cluster.forEach((p) => { p.cols = n; });
    cluster = [];
    colEnds = [];
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= item.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(item.endMin);
    } else {
      colEnds[col] = item.endMin;
    }
    const positioned: Positioned = { ...item, col, cols: 1 };
    cluster.push(positioned);
    result.push(positioned);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();
  return result;
}

interface EntryBlockProps {
  entry: TimeEntry;
  startMin: number;
  endMin: number;
  running: boolean;
  resizable: boolean;
  col: number;
  cols: number;
  color: string;
  projectName: string;
  taskName?: string;
  onClick: (e: React.MouseEvent, entry: TimeEntry) => void;
  onKeyDown: (e: React.KeyboardEvent, entry: TimeEntry) => void;
  onResizeStart: (e: React.PointerEvent, entry: TimeEntry, edge: "start" | "end") => void;
  onResizeMove: (e: React.PointerEvent) => void;
  onResizeEnd: (e: React.PointerEvent) => void;
  onResizeCancel: () => void;
}

/** "23h 30m / 40h" progress vs the weekly target, with an inline editor.
 *  Shown for whichever week the calendar is displaying. */
const WeekTargetProgress: React.FC<{ weekMinutes: number }> = ({ weekMinutes }) => {
  const { targetHours, setTargetHours } = useWeeklyTarget();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");

  const commit = () => {
    const n = Number(input);
    setTargetHours(Number.isFinite(n) ? n : 0);
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="week-target-editor">
        <input
          className="week-target-editor__input"
          type="number"
          min="0"
          max="168"
          step="0.5"
          placeholder="h/week"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label="Weekly target hours (0 to remove)"
          autoFocus
        />
        <button className="week-target-editor__ok" onClick={commit} title="Save target" aria-label="Save weekly target"><IconCheck size={13} /></button>
        <button className="week-target-editor__cancel" onClick={() => setEditing(false)} title="Cancel" aria-label="Cancel"><IconX size={13} /></button>
      </span>
    );
  }

  if (targetHours <= 0) {
    return (
      <button
        className="week-target-set"
        onClick={() => { setInput("40"); setEditing(true); }}
        title="Set a weekly hours target to see progress here"
      >
        Set weekly target
      </button>
    );
  }

  const targetMinutes = targetHours * 60;
  const met = weekMinutes >= targetMinutes;
  return (
    <span className="week-target" title={`${formatMinutes(weekMinutes)} of your ${targetHours}h weekly target`}>
      <span className="week-target__label">
        {formatMinutes(weekMinutes)} / {targetHours}h
      </span>
      <span className="week-target__track" role="progressbar" aria-valuemin={0} aria-valuemax={targetMinutes} aria-valuenow={Math.min(weekMinutes, targetMinutes)} aria-label="Weekly target progress">
        <span
          className={`week-target__fill ${met ? "week-target__fill--met" : ""}`}
          style={{ width: `${Math.min(100, (weekMinutes / targetMinutes) * 100)}%` }}
        />
      </span>
      <button
        className="week-target__edit"
        onClick={() => { setInput(String(targetHours)); setEditing(true); }}
        title="Edit weekly target"
        aria-label="Edit weekly target"
      >
        <IconPencil size={11} />
      </button>
    </span>
  );
};

const CalendarEntryBlock = React.memo<EntryBlockProps>(({
  entry, startMin, endMin, running, resizable, col, cols, color, projectName, taskName,
  onClick, onKeyDown, onResizeStart, onResizeMove, onResizeEnd, onResizeCancel,
}) => {
  const top = startMin * PX_PER_MIN;
  const height = Math.max((endMin - startMin) * PX_PER_MIN - 2, MIN_ENTRY_PX);
  const widthPct = 100 / cols;

  return (
    <div
      className={`cal-entry cal-entry--clickable ${running ? "cal-entry--running" : ""}`}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${col * widthPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        background: color + "22",
        borderLeft: `3px solid ${color}`,
        // Project accent colors include dark swatches (navy, forest) picked to
        // read fine on light theme's white cards; on dark theme's near-black
        // cards that same dark hex is barely distinguishable from the
        // background. --pc feeds .cal-entry__name/__handle, which lighten it
        // via color-mix in dark theme (see styles.css) instead of using it raw.
        "--pc": color,
      } as React.CSSProperties}
      onClick={(e) => onClick(e, entry)}
      onKeyDown={(e) => onKeyDown(e, entry)}
      role="button"
      tabIndex={0}
      aria-label={`${running ? "Running session" : "Edit entry"}: ${entry.description || projectName || "Untitled"}`}
      title={running ? "Timer running" : "Click to edit, or drag the top/bottom edge to resize"}
    >
      {resizable && (
        <div
          className="cal-entry__handle cal-entry__handle--top"
          aria-hidden="true"
          onPointerDown={(e) => onResizeStart(e, entry, "start")}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeCancel}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div className="cal-entry__name">
        {entry.description || projectName || "Untitled"}
      </div>
      {taskName && height >= 42 && (
        <div className="cal-entry__task">{taskName}</div>
      )}
      {height >= 58 && (
        <div className="cal-entry__time">
          {new Date(entry.startTime).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
          {" – "}
          {running
            ? "now"
            : new Date(entry.endTime!).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
      {resizable && (
        <div
          className="cal-entry__handle cal-entry__handle--bottom"
          aria-hidden="true"
          onPointerDown={(e) => onResizeStart(e, entry, "end")}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeCancel}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
});
CalendarEntryBlock.displayName = "CalendarEntryBlock";

export const CalendarPage: React.FC<Props> = ({ entries, projects, tasks, rangeLoading, onCreateEntry, onEdit, onDelete, onLoadTasksForProject }) => {
  const { ensureRangeLoaded } = useDataRange();
  const [anchor, setAnchor] = useState(() => new Date());
  const weekDays = useMemo(() => getWeekDays(anchor), [anchor]);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 769);
  const [mobileDay, setMobileDay] = useState(() => new Date());

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const bodyRef = useRef<HTMLDivElement>(null);
  // The CSS Grid container itself (48 rows × 36px) — its bounding rect gives
  // us a scroll-aware, column-agnostic reference point for turning a pointer
  // Y coordinate into a slot row or minutes-of-day during drag/resize.
  const gridRef = useRef<HTMLDivElement>(null);

  // Re-render once a minute so the now-line, the running entry's height and
  // the "today" highlight stay current during long-lived sessions.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(handle);
  }, []);
  const today = localDateStr(new Date(tick));

  // Keep a ref to entries so the scroll effect can read them without depending
  // on them (we don't want to re-scroll on every entry CRUD operation).
  const entriesScrollRef = useRef(entries);
  useEffect(() => { entriesScrollRef.current = entries; }, [entries]);

  // Scroll to the earliest entry in the visible week on mount and on week
  // navigation; fall back to 7 AM when there are no entries.
  useEffect(() => {
    const weekDateSet = new Set(weekDays.map((d) => localDateStr(d)));
    const weekEntries = entriesScrollRef.current.filter((e) => weekDateSet.has(e.date) && e.startTime);
    let targetHour = SCROLL_TO_HOUR;
    if (weekEntries.length > 0) {
      const minMinutes = Math.min(...weekEntries.map((e) => minutesOfDay(e.startTime)));
      targetHour = Math.max(0, Math.floor(minMinutes / 60) - 1);
    }
    bodyRef.current?.scrollTo({ top: targetHour * SLOTS_PER_HOUR * SLOT_HEIGHT - 6 });
  }, [weekDays]);

  // Make sure the data for the visible week is loaded — navigating backwards
  // past the initial 90-day window will pull more entries from Dataverse.
  useEffect(() => {
    if (weekDays.length === 0) return;
    ensureRangeLoaded(localDateStr(weekDays[0]), localDateStr(weekDays[weekDays.length - 1]));
  }, [weekDays, ensureRangeLoaded]);

  const [modal, setModal] = useState<ModalState | null>(null);

  // Roving tabindex for the grid's keyboard-navigable slot cells.
  const [focusedCell, setFocusedCell] = useState({ row: SCROLL_TO_HOUR * SLOTS_PER_HOUR, col: 0 });
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const prevWeek = () => {
    const d = new Date(anchor);
    d.setDate(d.getDate() - 7);
    setAnchor(d);
  };
  const nextWeek = () => {
    const d = new Date(anchor);
    d.setDate(d.getDate() + 7);
    setAnchor(d);
  };
  const goToday = () => setAnchor(new Date());

  // Static entries (completed) — only recomputed when entries or today changes, not every tick.
  const staticPositionedByDate = useMemo(() => {
    const byDate = new Map<string, Omit<Positioned, "col" | "cols">[]>();
    entries.forEach((e) => {
      if (!e.startTime || !e.endTime) return; // skip running
      const startMin = minutesOfDay(e.startTime);
      const endMin = localDateStr(new Date(e.endTime)) > e.date
        ? 24 * 60
        : Math.max(minutesOfDay(e.endTime), startMin + 15);
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date)!.push({ entry: e, startMin, endMin, running: false });
    });
    const out = new Map<string, Positioned[]>();
    byDate.forEach((items, date) => out.set(date, layoutDay(items)));
    return out;
  }, [entries]);

  // Running entry — recomputed every tick so its block height tracks current time.
  const runningEntry = useMemo(() => entries.find((e) => !e.endTime), [entries]);
  const runningPositioned = useMemo((): Positioned | null => {
    if (!runningEntry?.startTime) return null;
    const nowDate = new Date(tick);
    const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
    const startMin = minutesOfDay(runningEntry.startTime);
    const endMin = runningEntry.date === today
      ? Math.max(nowMin, startMin + 15)
      : 24 * 60;
    return { entry: runningEntry, startMin, endMin, running: true, col: 0, cols: 1 };
  }, [runningEntry, today, tick]);

  // Merge static + running into a single map for rendering.
  const positionedByDate = useMemo(() => {
    if (!runningPositioned) return staticPositionedByDate;
    const merged = new Map(staticPositionedByDate);
    const date = runningPositioned.entry.date;
    const staticItems = merged.get(date) ?? [];
    // Layout the running entry alongside the static ones for the same day.
    const allItems: Omit<Positioned, "col" | "cols">[] = [
      ...staticItems.map((p) => ({ entry: p.entry, startMin: p.startMin, endMin: p.endMin, running: p.running })),
      { entry: runningPositioned.entry, startMin: runningPositioned.startMin, endMin: runningPositioned.endMin, running: true },
    ];
    merged.set(date, layoutDay(allItems));
    return merged;
  }, [staticPositionedByDate, runningPositioned]);

  const dayTotals = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((e) => {
      map.set(e.date, (map.get(e.date) || 0) + (e.durationMinutes || 0));
    });
    return map;
  }, [entries]);

  const weekTotal = useMemo(
    () => weekDays.reduce((s, d) => s + (dayTotals.get(localDateStr(d)) || 0), 0),
    [weekDays, dayTotals]
  );

  const monthLabel = useMemo(() => {
    const months = weekDays.map((d) => d.toLocaleDateString("en", { month: "long", year: "numeric" }));
    return [...new Set(months)].join(" / ");
  }, [weekDays]);

  const timeSlots = useMemo(() => {
    const slots: { hour: number; half: boolean }[] = [];
    for (let h = 0; h < 24; h++) {
      slots.push({ hour: h, half: false });
      slots.push({ hour: h, half: true });
    }
    return slots;
  }, []);

  const now = new Date(tick);
  const nowTop = (now.getHours() * 60 + now.getMinutes()) * PX_PER_MIN;

  // Open the create modal for a day, starting at the given minutes-of-day.
  // A click (or keyboard Enter) on a single slot has no explicit end, so it
  // defaults to a 1-hour block; a drag passes its own dragged-out end.
  const openCreate = (dayStr: string, startTotalMins: number, endTotalMinsArg?: number) => {
    const hour = Math.floor(startTotalMins / 60);
    const minute = startTotalMins % 60;
    const endTotalMins = endTotalMinsArg !== undefined
      ? Math.min(endTotalMinsArg, 24 * 60)
      : Math.min(startTotalMins + 60, 24 * 60);
    // 24*60 means "midnight, end of day" — EntryModal already treats an
    // endTime of "00:00" as next-day midnight (see its overnight handling).
    const atMidnight = endTotalMins >= 24 * 60;
    const endHr = Math.floor(endTotalMins / 60) % 24;
    const endMin = endTotalMins % 60;
    setModal({
      editingId: null,
      draft: {
        date: dayStr,
        startTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        endTime: atMidnight ? "00:00" : `${String(endHr).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`,
        description: "",
        projectId: "",
        taskId: "",
        jiraTicket: "",
        ratio: "",
      },
    });
  };

  // ── Drag-to-create ──────────────────────────────────────────────────
  // Pointer-captured drag across slot cells in a single day column: press
  // on an empty slot, drag to extend the range, release to open the create
  // modal pre-filled with the dragged span. A drag that never moves behaves
  // exactly like the old plain click (openCreate's default +1h).
  const [dragCreate, setDragCreate] = useState<{ dayStr: string; dayIdx: number; fromRow: number; toRow: number } | null>(null);

  const rowFromClientY = useCallback((clientY: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const row = Math.floor((clientY - rect.top) / SLOT_HEIGHT);
    return Math.max(0, Math.min(row, TOTAL_SLOTS - 1));
  }, []);

  const minutesFromClientY = useCallback((clientY: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const raw = (clientY - rect.top) / PX_PER_MIN;
    const snapped = Math.round(raw / RESIZE_SNAP_MIN) * RESIZE_SNAP_MIN;
    return Math.max(0, Math.min(snapped, 24 * 60));
  }, []);

  const handleSlotPointerDown = (e: React.PointerEvent<HTMLDivElement>, dayStr: string, row: number, col: number) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFocusedCell({ row, col });
    setDragCreate({ dayStr, dayIdx: col, fromRow: row, toRow: row });
  };

  const handleSlotPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragCreate) return;
    setDragCreate((prev) => (prev ? { ...prev, toRow: rowFromClientY(e.clientY) } : prev));
  };

  const handleSlotPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragCreate) return;
    const toRow = rowFromClientY(e.clientY);
    const fromRow = Math.min(dragCreate.fromRow, toRow);
    const lastRow = Math.max(dragCreate.fromRow, toRow);
    const dayStr = dragCreate.dayStr;
    setDragCreate(null);
    if (fromRow === lastRow) {
      openCreate(dayStr, fromRow * 30);
    } else {
      openCreate(dayStr, fromRow * 30, (lastRow + 1) * 30);
    }
  };

  // A cancelled pointer (e.g. an OS gesture interrupts the drag) should just
  // drop the in-progress drag, not silently open the create modal.
  const handleSlotPointerCancel = () => setDragCreate(null);

  // ── Drag-to-resize ──────────────────────────────────────────────────
  // Same pointer-capture approach, applied to a handle at an entry block's
  // top/bottom edge instead of a slot cell. Live-previews just the one
  // entry being resized rather than re-running the day's column layout.
  const [resizePreview, setResizePreview] = useState<{ entryId: string; edge: "start" | "end"; minutes: number } | null>(null);
  const resizingRef = useRef<{ entry: TimeEntry; edge: "start" | "end" } | null>(null);

  const handleResizeStart = useCallback((e: React.PointerEvent, entry: TimeEntry, edge: "start" | "end") => {
    if (e.button !== 0 || !entry.endTime) return;
    // Entries clamped to 24:00 because they cross midnight aren't resizable
    // here — their real end lives on the next calendar day.
    if (localDateStr(new Date(entry.endTime)) > entry.date) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizingRef.current = { entry, edge };
    const minutes = edge === "start" ? minutesOfDay(entry.startTime) : minutesOfDay(entry.endTime);
    setResizePreview({ entryId: entry.id, edge, minutes });
  }, []);

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    const state = resizingRef.current;
    if (!state) return;
    const { entry, edge } = state;
    const startMinutes = minutesOfDay(entry.startTime);
    const endMinutes = minutesOfDay(entry.endTime!);
    const raw = minutesFromClientY(e.clientY);
    const minutes = edge === "start"
      ? Math.max(0, Math.min(raw, endMinutes - MIN_RESIZE_DURATION_MIN))
      : Math.max(startMinutes + MIN_RESIZE_DURATION_MIN, Math.min(raw, 24 * 60));
    setResizePreview({ entryId: entry.id, edge, minutes });
  }, [minutesFromClientY]);

  const handleResizeCancel = useCallback(() => {
    resizingRef.current = null;
    setResizePreview(null);
  }, []);

  const handleResizeEnd = useCallback(async (e: React.PointerEvent) => {
    const state = resizingRef.current;
    resizingRef.current = null;
    setResizePreview(null);
    if (!state) return;
    const { entry, edge } = state;
    const startMinutes = minutesOfDay(entry.startTime);
    const endMinutes = minutesOfDay(entry.endTime!);
    const raw = minutesFromClientY(e.clientY);
    if (edge === "start") {
      const newStart = Math.max(0, Math.min(raw, endMinutes - MIN_RESIZE_DURATION_MIN));
      if (newStart === startMinutes) return;
      await onEdit(entry.id, {
        startTime: isoAtMinutes(entry.date, newStart),
        durationMinutes: endMinutes - newStart,
      });
    } else {
      const newEnd = Math.max(startMinutes + MIN_RESIZE_DURATION_MIN, Math.min(raw, 24 * 60));
      if (newEnd === endMinutes) return;
      const endIso = newEnd >= 24 * 60
        ? new Date(`${addDaysStr(entry.date, 1)}T00:00:00`).toISOString()
        : isoAtMinutes(entry.date, newEnd);
      await onEdit(entry.id, {
        endTime: endIso,
        durationMinutes: newEnd - startMinutes,
      });
    }
  }, [minutesFromClientY, onEdit]);

  // Escape drops an in-progress drag-create or drag-resize instead of
  // letting the eventual pointerup commit a span the user regrets. The
  // stray pointerup that follows is harmless: both handlers no-op once
  // their drag state is cleared.
  useEffect(() => {
    if (!dragCreate && !resizePreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Consume the keystroke: this Escape means "cancel the drag", and it
      // must not double as input to any other window-level handler.
      e.preventDefault();
      e.stopPropagation();
      setDragCreate(null);
      handleResizeCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragCreate, resizePreview, handleResizeCancel]);

  // Move the roving-tabindex focus to a clamped (row, col) slot cell and
  // imperatively focus its DOM node (arrow keys don't trigger React re-focus).
  const moveFocus = (row: number, col: number) => {
    const clampedRow = Math.max(0, Math.min(row, TOTAL_SLOTS - 1));
    const clampedCol = Math.max(0, Math.min(col, weekDays.length - 1));
    setFocusedCell({ row: clampedRow, col: clampedCol });
    cellRefs.current.get(`${clampedRow}-${clampedCol}`)?.focus();
  };

  // Arrow keys move the grid cursor; Enter/Space create at the focused slot.
  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, row: number, col: number, dayStr: string) => {
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        moveFocus(row - 1, col);
        break;
      case "ArrowDown":
        e.preventDefault();
        moveFocus(row + 1, col);
        break;
      case "ArrowLeft":
        e.preventDefault();
        moveFocus(row, col - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        moveFocus(row, col + 1);
        break;
      case "Home":
        e.preventDefault();
        moveFocus(0, col);
        break;
      case "End":
        e.preventDefault();
        moveFocus(TOTAL_SLOTS - 1, col);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        openCreate(dayStr, row * 30);
        break;
      default:
        break;
    }
  };

  // Click or keyboard-activate existing entry → edit
  const handleEntryClick = useCallback((e: React.MouseEvent | React.KeyboardEvent, entry: TimeEntry) => {
    e.stopPropagation();
    // The running session is owned by the timer bar; editing (or deleting)
    // its draft row here would strand the timer's stop in a 404-retry loop.
    if (!entry.endTime) return;
    setModal({
      editingId: entry.id,
      draft: {
        date: entry.date,
        startTime: toTimeInput(entry.startTime),
        endTime: entry.endTime ? toTimeInput(entry.endTime) : "",
        description: entry.description || "",
        projectId: entry.projectId,
        taskId: entry.taskId || "",
        jiraTicket: entry.jiraTicket || "",
        ratio: entry.ratio !== undefined ? String(entry.ratio) : "",
      },
    });
  }, []);

  const handleEntryKeyDown = useCallback((e: React.KeyboardEvent, entry: TimeEntry) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleEntryClick(e, entry);
    }
  }, [handleEntryClick]);

  const handleModalSave = async (data: EntrySaveData) => {
    if (modal?.editingId) {
      await onEdit(modal.editingId, data);
    } else {
      const user = getCurrentUser();
      await onCreateEntry({ ...data, userId: user.id, userDisplayName: user.displayName });
    }
  };

  return (
    <div className="calendar">

      {modal && (
        <EntryModal
          title={modal.editingId ? "Edit Entry" : "Log Time"}
          initial={modal.draft}
          projects={projects}
          tasks={tasks}
          onSave={handleModalSave}
          onDelete={modal.editingId ? () => { onDelete(modal.editingId!); setModal(null); } : undefined}
          onClose={() => setModal(null)}
          onLoadTasksForProject={onLoadTasksForProject}
        />
      )}

      {/* ── Header ── */}
      <div className="calendar__header">
        <div className="calendar__title-row">
          <div className="calendar__title-group">
            <h2 className="calendar__title">{monthLabel}</h2>
            <span className="calendar__week-total">{formatMinutes(weekTotal)} this week</span>
            <WeekTargetProgress weekMinutes={weekTotal} />
            {rangeLoading && <RangeSpinner label="Loading this week's entries…" />}
          </div>
          <div className="calendar__nav">
            <button className="cal-nav-btn" onClick={prevWeek} aria-label="Previous week">
              <IconChevronLeft />
            </button>
            <button className="cal-nav-btn cal-nav-btn--today" onClick={goToday}>Today</button>
            <button className="cal-nav-btn" onClick={nextWeek} aria-label="Next week">
              <IconChevronRight />
            </button>
          </div>
        </div>
        {weekTotal === 0 && (
          <div className="calendar__empty-hint">
            Nothing logged this week. Click any time slot to add an entry.
          </div>
        )}

        {/* Day headers */}
        <div className="calendar__day-headers">
          <div className="calendar__gutter" />
          {weekDays.map((day) => {
            const ds = localDateStr(day);
            const isToday = ds === today;
            const total = dayTotals.get(ds) || 0;
            return (
              <div key={ds} className={`calendar__day-header ${isToday ? "calendar__day-header--today" : ""}`}>
                <div className="calendar__day-name">
                  {day.toLocaleDateString("en", { weekday: "short" })}
                </div>
                <div className={`calendar__day-num ${isToday ? "calendar__day-num--today" : ""}`}>
                  {day.getDate()}
                </div>
                <div className="calendar__day-total">{total > 0 ? formatMinutes(total) : " "}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Mobile day-list view ── */}
      <div className="cal-mobile-day-nav">
        <button className="cal-nav-btn" onClick={() => { const d = new Date(mobileDay); d.setDate(d.getDate() - 1); setMobileDay(d); }} aria-label="Previous day"><IconChevronLeft /></button>
        <span className="cal-mobile-day-nav__label">
          {mobileDay.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })}
        </span>
        <button className="cal-nav-btn" onClick={() => { const d = new Date(mobileDay); d.setDate(d.getDate() + 1); setMobileDay(d); }} aria-label="Next day"><IconChevronRight /></button>
      </div>
      {isMobile && (() => {
        const ds = localDateStr(mobileDay);
        const dayItems = (positionedByDate.get(ds) ?? []).slice().sort((a, b) => a.startMin - b.startMin);
        return (
          <div className="cal-mobile-list">
            {dayItems.length === 0 ? (
              <p className="cal-mobile-empty">No entries — tap below to add one.</p>
            ) : dayItems.map(({ entry, running }) => {
              const project = projects.find((p) => p.id === entry.projectId);
              return (
                <div key={entry.id} className="cal-mobile-entry" onClick={() => handleEntryClick({ stopPropagation: () => {} } as React.MouseEvent, entry)} role="button" tabIndex={0} onKeyDown={(e) => handleEntryKeyDown(e, entry)}>
                  <div className="cal-mobile-entry__bar" style={{ background: project?.color || "#6366f1" }} />
                  <div className="cal-mobile-entry__info">
                    <div className="cal-mobile-entry__name">{entry.description || project?.name || "Untitled"}</div>
                    <div className="cal-mobile-entry__time">
                      {new Date(entry.startTime).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                      {" – "}
                      {running ? "now" : entry.endTime ? new Date(entry.endTime).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }) : ""}
                    </div>
                  </div>
                </div>
              );
            })}
            <button className="btn-primary" style={{ marginTop: 8, width: "100%" }} onClick={() => openCreate(ds, 9 * 60)}>+ Add entry</button>
          </div>
        );
      })()}

      {/* ── Grid ── */}
      <div className="calendar__grid-wrap">
      <div className="calendar__body" ref={bodyRef}>
        <div className="calendar__grid" ref={gridRef} role="grid" aria-label="Week calendar" aria-rowcount={TOTAL_SLOTS} aria-colcount={weekDays.length}>
          {/* Time gutter */}
          <div className="calendar__time-col" aria-hidden="true">
            {timeSlots.map(({ hour, half }, i) => (
              <div key={i} className="calendar__time-slot">
                <span className="calendar__time-label">
                  {!half ? formatHour(hour) : ""}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns — decorative slot lines, now-line and time entries */}
          {weekDays.map((day, dayIdx) => {
            const ds = localDateStr(day);
            const isToday = ds === today;
            const dayEntries = positionedByDate.get(ds) || [];

            return (
              <div
                key={ds}
                className={`calendar__day-col ${isToday ? "calendar__day-col--today" : ""}`}
                style={{ gridColumn: dayIdx + 2 }}
              >
                {/* Slot lines */}
                {timeSlots.map(({ half }, i) => (
                  <div key={i} className={`calendar__slot-line ${half ? "calendar__slot-line--half" : ""}`} />
                ))}

                {/* Current time indicator */}
                {isToday && (
                  <div
                    className="calendar__now-line"
                    style={{ top: `${nowTop}px` }}
                  />
                )}

                {/* Time entries */}
                {dayEntries.map(({ entry, startMin, endMin, running, col, cols }) => {
                  const project = projects.find((p) => p.id === entry.projectId);
                  const task = tasks.find((t) => t.id === entry.taskId);
                  const resizable = !running && !!entry.endTime && localDateStr(new Date(entry.endTime)) <= entry.date;
                  const isResizing = resizePreview?.entryId === entry.id;
                  const effStartMin = isResizing && resizePreview!.edge === "start" ? resizePreview!.minutes : startMin;
                  const effEndMin = isResizing && resizePreview!.edge === "end" ? resizePreview!.minutes : endMin;
                  return (
                    <CalendarEntryBlock
                      key={entry.id}
                      entry={entry}
                      startMin={effStartMin}
                      endMin={effEndMin}
                      running={running}
                      resizable={resizable}
                      col={col}
                      cols={cols}
                      color={project?.color || "#6366f1"}
                      projectName={project?.name || "Untitled"}
                      taskName={task?.name}
                      onClick={handleEntryClick}
                      onKeyDown={handleEntryKeyDown}
                      onResizeStart={handleResizeStart}
                      onResizeMove={handleResizeMove}
                      onResizeEnd={handleResizeEnd}
                      onResizeCancel={handleResizeCancel}
                    />
                  );
                })}

                {/* Live preview while dragging out a new entry's time range */}
                {dragCreate && dragCreate.dayIdx === dayIdx && (() => {
                  const lo = Math.min(dragCreate.fromRow, dragCreate.toRow);
                  const hi = Math.max(dragCreate.fromRow, dragCreate.toRow);
                  return (
                    <div
                      className="cal-drag-preview"
                      aria-hidden="true"
                      style={{ top: `${lo * SLOT_HEIGHT}px`, height: `${(hi - lo + 1) * SLOT_HEIGHT}px` }}
                    />
                  );
                })()}
              </div>
            );
          })}

          {/* Keyboard-navigable slot cells — row-major so ARIA rows span all days */}
          {timeSlots.map((_, row) => (
            <div key={row} role="row" aria-rowindex={row + 1} style={{ display: "contents" }}>
              {weekDays.map((day, col) => {
                const ds = localDateStr(day);
                const isToday = ds === today;
                const isFocused = focusedCell.row === row && focusedCell.col === col;
                return (
                  <div
                    key={`${row}-${col}`}
                    ref={(el) => {
                      if (el) cellRefs.current.set(`${row}-${col}`, el);
                      else cellRefs.current.delete(`${row}-${col}`);
                    }}
                    role="gridcell"
                    aria-colindex={col + 1}
                    className="calendar__slot-cell"
                    data-today={isToday ? "true" : undefined}
                    style={{ gridRow: row + 1, gridColumn: col + 2 }}
                    tabIndex={isFocused ? 0 : -1}
                    aria-label={`${formatSlotTime(row)} on ${day.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })} — click, or drag to set a time range`}
                    onPointerDown={(e) => handleSlotPointerDown(e, ds, row, col)}
                    onPointerMove={handleSlotPointerMove}
                    onPointerUp={handleSlotPointerUp}
                    onPointerCancel={handleSlotPointerCancel}
                    onKeyDown={(e) => handleCellKeyDown(e, row, col, ds)}
                    onFocus={() => setFocusedCell({ row, col })}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      </div>{/* end calendar__grid-wrap */}
    </div>
  );
};
