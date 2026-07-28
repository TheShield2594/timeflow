import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimeEntry, Project, Task, OutlookEvent } from "../types";
import { getCurrentUser } from "../services/userService";
import { markEventLogged, readLoggedEventIds } from "../services/outlookService";
import { useOutlookEvents } from "../hooks/useOutlookEvents";
import { addDaysStr, localDateStr, minutesOfDay, toTimeInput } from "../utils/dates";
import {
  ColumnRect,
  MINUTES_PER_DAY,
  MIN_RESIZE_DURATION_MIN,
  MOVE_THRESHOLD_PX,
  PX_PER_MIN,
  SLOTS_PER_HOUR,
  SLOT_HEIGHT,
  SNAP_MIN,
  TOTAL_SLOTS,
  clampMoveStart,
  dayIndexFromClientX,
  rowFromOffsetY,
  snapMinutesFromOffsetY,
} from "../utils/calendarGeometry";
import { formatMinutes } from "../hooks";
import { useRangeRequest } from "../contexts/DataRangeContext";
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
  /** Set when the modal was opened from an Outlook meeting — a successful
   *  save marks that event as logged (see outlookService). */
  sourceEventId?: string;
}

// Whether the Outlook overlay is shown, persisted per environment + user like
// the weekly target. Defaults to shown — the overlay is the feature's whole
// point, and it degrades to a "not connected" hint when the connector is
// missing rather than erroring.
const SHOW_OUTLOOK_KEY_PREFIX = "tt_show_outlook:";

function showOutlookKey(): string {
  const user = getCurrentUser();
  return `${SHOW_OUTLOOK_KEY_PREFIX}${user.environmentId}:${user.id}`;
}

function readShowOutlook(): boolean {
  try {
    return localStorage.getItem(showOutlookKey()) !== "0";
  } catch {
    return true;
  }
}

// Full 24h grid (geometry constants live in utils/calendarGeometry); we
// auto-scroll to the workday on mount so early/late entries are never
// silently hidden.
const SCROLL_TO_HOUR = 7;
const MIN_ENTRY_PX = 22;

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

// "9:15 AM" for a minutes-of-day offset. 24:00 (the end of the last slot)
// reads as midnight rather than "0:00 AM".
function clockLabel(minutes: number): string {
  const total = Math.min(minutes, 24 * 60);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = total >= 12 * 60 && total < 24 * 60 ? "PM" : "AM";
  const display = h24 > 12 ? h24 - 12 : h24 === 0 ? 12 : h24;
  return `${display}:${String(m).padStart(2, "0")} ${suffix}`;
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
  /** Minutes-of-day of the top of the gridcell this block is rendered inside;
   *  the block is absolutely positioned relative to that cell. */
  rowTopMin: number;
  running: boolean;
  /** Completed, same-day entry: its geometry can be dragged (resized/moved). */
  reshapable: boolean;
  /** True for the entry currently being dragged to a new slot. */
  moving: boolean;
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
  onMoveStart: (e: React.PointerEvent, entry: TimeEntry) => void;
  onMoveMove: (e: React.PointerEvent) => void;
  onMoveEnd: (e: React.PointerEvent) => void;
  onMoveCancel: () => void;
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
  entry, startMin, endMin, rowTopMin, running, reshapable, moving, col, cols, color, projectName, taskName,
  onClick, onKeyDown, onResizeStart, onResizeMove, onResizeEnd, onResizeCancel,
  onMoveStart, onMoveMove, onMoveEnd, onMoveCancel,
}) => {
  const top = (startMin - rowTopMin) * PX_PER_MIN;
  const height = Math.max((endMin - startMin) * PX_PER_MIN - 2, MIN_ENTRY_PX);
  const widthPct = 100 / cols;

  // Entries now sit inside the slot `gridcell`, so a pointerdown on the block
  // would otherwise bubble to the cell's drag-to-create handler and race the
  // entry's own click. Stop it here (and start a potential move); the resize
  // handles already stop their own pointerdown before it reaches this root.
  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onMoveStart(e, entry);
  };

  // The running session is owned by the timer bar — clicking its block here
  // does nothing (editing/deleting the draft row would strand the timer's
  // stop in a 404-retry loop). So it isn't a button: a non-interactive,
  // non-focusable block whose visible name/time carry the information, rather
  // than a focusable control that silently no-ops on Enter.
  const interactiveProps = running
    ? { "aria-label": `Running session: ${entry.description || projectName || "Untitled"}` }
    : {
        onClick: (e: React.MouseEvent) => onClick(e, entry),
        onKeyDown: (e: React.KeyboardEvent) => onKeyDown(e, entry),
        onPointerMove: onMoveMove,
        onPointerUp: onMoveEnd,
        onPointerCancel: onMoveCancel,
        role: "button",
        tabIndex: 0,
        "aria-label": `Edit entry: ${entry.description || projectName || "Untitled"}`,
        title: reshapable
          ? "Click to edit, drag to reschedule (Shift + arrow keys), or drag the top/bottom edge to resize"
          : "Click to edit",
      };

  return (
    <div
      className={`cal-entry ${running ? "cal-entry--running" : "cal-entry--clickable"}`
        + (reshapable ? " cal-entry--draggable" : "")
        + (moving ? " cal-entry--moving" : "")}
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
      onPointerDown={handlePointerDown}
      {...interactiveProps}
    >
      {reshapable && (
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
      {reshapable && (
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

interface GhostBlockProps {
  event: OutlookEvent;
  startMin: number;
  endMin: number;
  rowTopMin: number;
  logged: boolean;
  onLog: (event: OutlookEvent) => void;
}

/**
 * An Outlook meeting drawn as a muted, full-width block *behind* the tracked
 * entries (z-index below .cal-entry). Clicking it opens the Log Time modal
 * prefilled with the meeting's span and subject — the categorize step.
 */
const OutlookGhostBlock = React.memo<GhostBlockProps>(({ event, startMin, endMin, rowTopMin, logged, onLog }) => {
  const top = (startMin - rowTopMin) * PX_PER_MIN;
  const height = Math.max((endMin - startMin) * PX_PER_MIN - 2, MIN_ENTRY_PX);
  const timeLabel = `${clockLabel(startMin)} – ${clockLabel(endMin)}`;
  return (
    <div
      className={`cal-ghost ${logged ? "cal-ghost--logged" : ""}`}
      style={{ top: `${top}px`, height: `${height}px` }}
      role="button"
      tabIndex={0}
      aria-label={`Log time for Outlook meeting: ${event.subject}, ${timeLabel}${logged ? " (already logged)" : ""}`}
      title={logged
        ? `${event.subject} — already logged; click to log again`
        : `${event.subject} — click to log this meeting as a time entry`}
      // Stop the cell's drag-to-create from also arming on this press.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onLog(event); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onLog(event);
        }
      }}
    >
      <div className="cal-ghost__name">
        {logged && <IconCheck size={11} className="cal-ghost__check" />}
        {event.subject}
      </div>
      {height >= 42 && <div className="cal-ghost__time">{timeLabel}</div>}
    </div>
  );
});
OutlookGhostBlock.displayName = "OutlookGhostBlock";

export const CalendarPage: React.FC<Props> = ({ entries, projects, tasks, rangeLoading, onCreateEntry, onEdit, onDelete, onLoadTasksForProject }) => {
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
  // past the initial 90-day window will pull more entries from Dataverse. The
  // request is released when the user leaves the calendar, so paging back a
  // year doesn't keep every other page fetching that span (#74).
  const weekBounds = useMemo(() => ({
    from: weekDays.length ? localDateStr(weekDays[0]) : "",
    to: weekDays.length ? localDateStr(weekDays[weekDays.length - 1]) : "",
  }), [weekDays]);
  useRangeRequest("calendar", weekBounds.from, weekBounds.to);

  // ── Outlook meeting overlay ─────────────────────────────────────────
  const [showOutlook, setShowOutlook] = useState(readShowOutlook);
  const [loggedEventIds, setLoggedEventIds] = useState<Set<string>>(() => readLoggedEventIds());
  const {
    events: outlookEvents,
    status: outlookStatus,
    refresh: refreshOutlook,
  } = useOutlookEvents(weekBounds.from, weekBounds.to, showOutlook);

  const toggleOutlook = () => {
    setShowOutlook((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(showOutlookKey(), next ? "1" : "0");
      } catch { /* storage unavailable — the preference just won't persist */ }
      return next;
    });
  };

  // Ghosts grouped by the grid slot cell their start falls in, mirroring
  // entriesByCell below. Full-width blocks behind the entries, so they don't
  // participate in the entries' column layout.
  const ghostsByCell = useMemo(() => {
    const m = new Map<string, { event: OutlookEvent; startMin: number; endMin: number }[]>();
    outlookEvents.forEach((event) => {
      const date = localDateStr(new Date(event.startTime));
      const startMin = minutesOfDay(event.startTime);
      // Meetings that run past midnight are clamped to the day they start on,
      // exactly like entry blocks.
      const endMin = localDateStr(new Date(event.endTime)) > date
        ? 24 * 60
        : Math.max(minutesOfDay(event.endTime), startMin + 15);
      const row = Math.max(0, Math.min(Math.floor(startMin / 30), TOTAL_SLOTS - 1));
      const key = `${date}-${row}`;
      const list = m.get(key);
      const item = { event, startMin, endMin };
      if (list) list.push(item);
      else m.set(key, [item]);
    });
    return m;
  }, [outlookEvents]);

  // Click a meeting → the normal Log Time modal, prefilled with the meeting's
  // span and subject; the user adds project/task and saves.
  const openLogEvent = useCallback((event: OutlookEvent) => {
    const date = localDateStr(new Date(event.startTime));
    const crossesMidnight = localDateStr(new Date(event.endTime)) > date;
    setModal({
      editingId: null,
      sourceEventId: event.id,
      draft: {
        date,
        startTime: toTimeInput(event.startTime),
        // "00:00" reads as next-day midnight in EntryModal, clamping an
        // overnight meeting to the day it starts on (like the block does).
        endTime: crossesMidnight ? "00:00" : toTimeInput(event.endTime),
        description: event.subject,
        projectId: "",
        taskId: "",
        jiraTicket: "",
        ratio: "",
      },
    });
  }, []);

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

  // Elapsed minutes of the running session, on the day it's drawn: the entry
  // has no durationMinutes until it's stopped, so without this the day-header
  // and week totals sit at zero while the running block visibly grows (#74).
  // Bounded the same way the block is — a session started yesterday counts up
  // to midnight on its own date, not to the current clock.
  const runningMinutes = useMemo(() => {
    if (!runningEntry?.startTime) return 0;
    const nowDate = new Date(tick);
    const endMin = runningEntry.date === today
      ? nowDate.getHours() * 60 + nowDate.getMinutes()
      : 24 * 60;
    return Math.max(0, endMin - minutesOfDay(runningEntry.startTime));
  }, [runningEntry, today, tick]);

  const dayTotals = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((e) => {
      // Open entries carry no duration; the running one is added below.
      if (!e.endTime) return;
      map.set(e.date, (map.get(e.date) || 0) + (e.durationMinutes || 0));
    });
    if (runningEntry && runningMinutes > 0) {
      map.set(runningEntry.date, (map.get(runningEntry.date) || 0) + runningMinutes);
    }
    return map;
  }, [entries, runningEntry, runningMinutes]);

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
    return rowFromOffsetY(clientY - rect.top);
  }, []);

  const minutesFromClientY = useCallback((clientY: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return snapMinutesFromOffsetY(clientY - rect.top);
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
      // The entries hook rolls back and toasts on failure; catching here just
      // keeps a failed save from surfacing as an unhandled rejection.
      await onEdit(entry.id, {
        startTime: isoAtMinutes(entry.date, newStart),
        durationMinutes: endMinutes - newStart,
      }).catch(() => {});
    } else {
      const newEnd = Math.max(startMinutes + MIN_RESIZE_DURATION_MIN, Math.min(raw, 24 * 60));
      if (newEnd === endMinutes) return;
      const endIso = newEnd >= 24 * 60
        ? new Date(`${addDaysStr(entry.date, 1)}T00:00:00`).toISOString()
        : isoAtMinutes(entry.date, newEnd);
      await onEdit(entry.id, {
        endTime: endIso,
        durationMinutes: newEnd - startMinutes,
      }).catch(() => {});
    }
  }, [minutesFromClientY, onEdit]);

  // ── Drag-to-move (#79) ──────────────────────────────────────────────
  // Press anywhere on a completed entry block and drag it to another slot —
  // another time, another day of the week, or both. The entry keeps its
  // duration; only its start (and date) move. Below MOVE_THRESHOLD_PX the
  // gesture is still a plain click that opens the edit modal, so the pointer
  // drift in an ordinary click can't silently reschedule anything.
  //
  // The drop target is drawn as a separate ghost in the day column rather
  // than by relocating the block itself: the block holds the pointer
  // capture, and re-parenting it into another cell mid-drag would unmount
  // the captured node and strand the gesture with no pointerup to commit it.
  const [movePreview, setMovePreview] = useState<
    { entryId: string; date: string; startMin: number; durationMin: number } | null
  >(null);
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
  // Set on the pointerup that ends a real move so the click browsers fire
  // afterwards doesn't also open the edit modal. Cleared on the next
  // pointerdown, so a swallowed-but-never-delivered click can't leak into
  // the following interaction.
  const suppressClickRef = useRef(false);

  const dayColRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const readDayColumns = useCallback((): ColumnRect[] =>
    weekDays.map((_, i) => {
      const rect = dayColRefs.current.get(i)?.getBoundingClientRect();
      return { left: rect?.left ?? 0, right: rect?.right ?? 0 };
    }), [weekDays]);

  const handleMoveStart = useCallback((e: React.PointerEvent, entry: TimeEntry) => {
    suppressClickRef.current = false;
    if (e.button !== 0 || !entry.endTime) return;
    // Same restriction as resize: an entry clamped to 24:00 because it runs
    // past midnight has its real end on the next calendar day, so moving it
    // by start-plus-duration would silently rewrite the wrong span.
    if (localDateStr(new Date(entry.endTime)) > entry.date) return;
    // Touch is left alone deliberately: the block sits inside a vertically
    // scrollable grid, and a finger-drag starting on an entry is far more
    // often a scroll than a reschedule. Touch users get the edit modal (and
    // keyboard users get Shift + arrows, below).
    if (e.pointerType === "touch") return;
    const gridRect = gridRef.current?.getBoundingClientRect();
    if (!gridRect) return;
    const startMin = minutesOfDay(entry.startTime);
    const endMin = minutesOfDay(entry.endTime);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    movingRef.current = {
      entry,
      durationMin: Math.max(endMin - startMin, MIN_RESIZE_DURATION_MIN),
      grabOffsetMin: (e.clientY - gridRect.top) / PX_PER_MIN - startMin,
      originX: e.clientX,
      originY: e.clientY,
      gridTop: gridRect.top,
      dayColumns: readDayColumns(),
      moved: false,
      target: null,
    };
  }, [readDayColumns]);

  const handleMoveMove = useCallback((e: React.PointerEvent) => {
    const state = movingRef.current;
    if (!state) return;
    if (!state.moved) {
      const dx = e.clientX - state.originX;
      const dy = e.clientY - state.originY;
      if (Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) return;
      state.moved = true;
    }
    const dayIdx = dayIndexFromClientX(e.clientX, state.dayColumns);
    const day = weekDays[dayIdx];
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
    setMovePreview({ entryId: state.entry.id, durationMin: state.durationMin, ...target });
  }, [weekDays]);

  const handleMoveCancel = useCallback(() => {
    // A cancelled drag that had already moved still ends in a pointerup and
    // therefore a click — swallow it, or Escape would drop the move and then
    // open the edit modal on the way out.
    if (movingRef.current?.moved) suppressClickRef.current = true;
    movingRef.current = null;
    setMovePreview(null);
  }, []);

  const handleMoveEnd = useCallback((e: React.PointerEvent) => {
    const state = movingRef.current;
    movingRef.current = null;
    setMovePreview(null);
    if (!state) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    // Never travelled far enough to be a drag — leave the click alone so it
    // opens the edit modal exactly as it always did.
    if (!state.moved) return;
    suppressClickRef.current = true;
    const { entry, durationMin, target } = state;
    if (!target) return;
    if (target.date === entry.date && target.startMin === minutesOfDay(entry.startTime)) return;
    const endMin = target.startMin + durationMin;
    const endIso = endMin >= MINUTES_PER_DAY
      ? new Date(`${addDaysStr(target.date, 1)}T00:00:00`).toISOString()
      : isoAtMinutes(target.date, endMin);
    // The entries hook rolls the optimistic update back and toasts on
    // failure, so there's nothing to do here but not crash on rejection.
    void onEdit(entry.id, {
      date: target.date,
      startTime: isoAtMinutes(target.date, target.startMin),
      endTime: endIso,
      durationMinutes: durationMin,
    }).catch(() => {});
  }, [onEdit]);

  /** Shift + arrows: the keyboard equivalent of dragging a block to a new
   *  slot — ±15 minutes vertically, ±1 day horizontally. */
  const nudgeEntry = useCallback((entry: TimeEntry, deltaMin: number, deltaDays: number) => {
    if (!entry.endTime) return;
    if (localDateStr(new Date(entry.endTime)) > entry.date) return;
    const startMin = minutesOfDay(entry.startTime);
    const durationMin = Math.max(minutesOfDay(entry.endTime) - startMin, MIN_RESIZE_DURATION_MIN);
    // Clamped to the week on screen, exactly like a drag: the day columns
    // bound how far a pointer can carry a block, and an entry nudged off the
    // edge would simply vanish from the view the user is working in.
    const stepped = deltaDays ? addDaysStr(entry.date, deltaDays) : entry.date;
    const date = stepped < weekBounds.from ? entry.date
      : stepped > weekBounds.to ? entry.date
      : stepped;
    const newStart = clampMoveStart(startMin + deltaMin, durationMin);
    if (date === entry.date && newStart === startMin) return;
    const endMin = newStart + durationMin;
    const endIso = endMin >= MINUTES_PER_DAY
      ? new Date(`${addDaysStr(date, 1)}T00:00:00`).toISOString()
      : isoAtMinutes(date, endMin);
    void onEdit(entry.id, {
      date,
      startTime: isoAtMinutes(date, newStart),
      endTime: endIso,
      durationMinutes: durationMin,
    }).catch(() => {});
  }, [onEdit, weekBounds]);

  // Group entries by the grid slot cell they start in, keyed `${date}-${row}`,
  // so each block can render *inside* its starting `gridcell`. Entries used to
  // live in a separate day-column overlay that sat directly under the ARIA
  // grid outside any row/gridcell — screen readers in table-navigation mode
  // then saw a grid of empty cells and never reached the actual entries.
  const entriesByCell = useMemo(() => {
    const m = new Map<string, Positioned[]>();
    positionedByDate.forEach((items, date) => {
      items.forEach((p) => {
        const row = Math.max(0, Math.min(Math.floor(p.startMin / 30), TOTAL_SLOTS - 1));
        const key = `${date}-${row}`;
        const list = m.get(key);
        if (list) list.push(p);
        else m.set(key, [p]);
      });
    });
    return m;
  }, [positionedByDate]);

  // Escape drops an in-progress drag-create, drag-resize or drag-move
  // instead of letting the eventual pointerup commit a change the user
  // regrets. The stray pointerup that follows is harmless: every handler
  // no-ops once its drag state is cleared.
  useEffect(() => {
    if (!dragCreate && !resizePreview && !movePreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Consume the keystroke: this Escape means "cancel the drag", and it
      // must not double as input to any other window-level handler.
      e.preventDefault();
      e.stopPropagation();
      setDragCreate(null);
      handleResizeCancel();
      handleMoveCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragCreate, resizePreview, movePreview, handleResizeCancel, handleMoveCancel]);

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
    // The click that closes a drag-to-move isn't a request to edit (#79).
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
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
      return;
    }
    // Shift + arrows reschedule the focused entry — dragging it with the
    // keyboard (#79). stopPropagation keeps the keystroke from also driving
    // the enclosing gridcell's roving-tabindex arrow handling.
    if (!e.shiftKey) return;
    const nudge: Record<string, [number, number]> = {
      ArrowUp: [-SNAP_MIN, 0],
      ArrowDown: [SNAP_MIN, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = nudge[e.key];
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    nudgeEntry(entry, delta[0], delta[1]);
  }, [handleEntryClick, nudgeEntry]);

  const handleModalSave = async (data: EntrySaveData) => {
    if (modal?.editingId) {
      await onEdit(modal.editingId, data);
    } else {
      const user = getCurrentUser();
      await onCreateEntry({ ...data, userId: user.id, userDisplayName: user.displayName });
      // Entry saved from an Outlook meeting: remember it so the ghost renders
      // with a "logged" check. (An overnight split saves twice; marking twice
      // is harmless — it's a set.)
      if (modal?.sourceEventId) {
        setLoggedEventIds(markEventLogged(modal.sourceEventId));
      }
    }
  };

  // Render one positioned entry block. Called from inside the `gridcell` the
  // entry starts in, so the block is positioned relative to that cell
  // (rowTopMin = the cell's minutes-of-day top).
  const renderEntryBlock = (p: Positioned, rowTopMin: number) => {
    const { entry, startMin, endMin, running, col, cols } = p;
    const project = projects.find((pr) => pr.id === entry.projectId);
    const task = tasks.find((t) => t.id === entry.taskId);
    const reshapable = !running && !!entry.endTime && localDateStr(new Date(entry.endTime)) <= entry.date;
    const isResizing = resizePreview?.entryId === entry.id;
    const effStartMin = isResizing && resizePreview!.edge === "start" ? resizePreview!.minutes : startMin;
    const effEndMin = isResizing && resizePreview!.edge === "end" ? resizePreview!.minutes : endMin;
    return (
      <CalendarEntryBlock
        key={entry.id}
        entry={entry}
        startMin={effStartMin}
        endMin={effEndMin}
        rowTopMin={rowTopMin}
        running={running}
        reshapable={reshapable}
        moving={movePreview?.entryId === entry.id}
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
        onMoveStart={handleMoveStart}
        onMoveMove={handleMoveMove}
        onMoveEnd={handleMoveEnd}
        onMoveCancel={handleMoveCancel}
      />
    );
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
            {(() => {
              // One chip owns show/hide; a second appears only when a shown
              // overlay failed to load and a retry makes sense.
              if (!showOutlook) {
                return (
                  <button className="cal-outlook-toggle" onClick={toggleOutlook} title="Show your Outlook meetings on the calendar">
                    Outlook: off
                  </button>
                );
              }
              if (outlookStatus === "unavailable") {
                return (
                  <button
                    className="cal-outlook-toggle cal-outlook-toggle--warn"
                    onClick={toggleOutlook}
                    title="The Office 365 Outlook connector isn't set up for this app yet — an admin needs to add it (see the README's Outlook calendar section). Click to hide this."
                  >
                    Outlook: not connected
                  </button>
                );
              }
              return (
                <>
                  <button className="cal-outlook-toggle cal-outlook-toggle--active" onClick={toggleOutlook} title="Hide Outlook meetings">
                    Outlook: on
                  </button>
                  {outlookStatus === "error" && (
                    <button className="cal-outlook-toggle cal-outlook-toggle--warn" onClick={refreshOutlook} title="Couldn't load your Outlook meetings — click to retry">
                      Retry
                    </button>
                  )}
                </>
              );
            })()}
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
        const dayGhosts = outlookEvents
          .filter((ev) => localDateStr(new Date(ev.startTime)) === ds)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        return (
          <div className="cal-mobile-list">
            {dayGhosts.map((event) => (
              <div
                key={event.id}
                className={`cal-mobile-ghost ${loggedEventIds.has(event.id) ? "cal-mobile-ghost--logged" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => openLogEvent(event)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openLogEvent(event);
                  }
                }}
                aria-label={`Log time for Outlook meeting: ${event.subject}`}
              >
                <div className="cal-mobile-ghost__info">
                  <div className="cal-mobile-ghost__name">
                    {loggedEventIds.has(event.id) && <IconCheck size={11} className="cal-ghost__check" />}
                    {event.subject}
                  </div>
                  <div className="cal-mobile-entry__time">
                    {new Date(event.startTime).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                    {" – "}
                    {new Date(event.endTime).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <span className="cal-mobile-ghost__cta">{loggedEventIds.has(event.id) ? "Logged" : "Log"}</span>
              </div>
            ))}
            {dayItems.length === 0 ? (
              <p className="cal-mobile-empty">No entries — tap below to add one.</p>
            ) : dayItems.map(({ entry, running }) => {
              const project = projects.find((p) => p.id === entry.projectId);
              // Mirror CalendarEntryBlock: the running session is owned by the
              // timer bar, so its row isn't a button that silently no-ops on
              // tap/Enter — just a labeled, non-interactive block.
              const interactiveProps = running
                ? { "aria-label": `Running session: ${entry.description || project?.name || "Untitled"}` }
                : {
                    role: "button" as const,
                    tabIndex: 0,
                    onClick: () => handleEntryClick({ stopPropagation: () => {} } as React.MouseEvent, entry),
                    onKeyDown: (e: React.KeyboardEvent) => handleEntryKeyDown(e, entry),
                  };
              return (
                <div key={entry.id} className="cal-mobile-entry" {...interactiveProps}>
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

          {/* Day columns — decorative only (slot lines, now-line, drag
              preview). aria-hidden because the entries themselves now live in
              the gridcells below; leaving these plain <div>s in the ARIA grid
              would put non-row children directly under role="grid". */}
          {weekDays.map((day, dayIdx) => {
            const ds = localDateStr(day);
            const isToday = ds === today;

            return (
              <div
                key={ds}
                // Measured (not interacted with) during a drag-move: these
                // decorative columns are the only elements whose horizontal
                // extent maps cleanly to "which day is under the pointer".
                ref={(el) => {
                  if (el) dayColRefs.current.set(dayIdx, el);
                  else dayColRefs.current.delete(dayIdx);
                }}
                className={`calendar__day-col ${isToday ? "calendar__day-col--today" : ""}`}
                style={{ gridColumn: dayIdx + 2 }}
                aria-hidden="true"
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

                {/* Live preview of where a dragged entry would land (#79) */}
                {movePreview && movePreview.date === ds && (
                  <div
                    className="cal-move-preview"
                    style={{
                      top: `${movePreview.startMin * PX_PER_MIN}px`,
                      height: `${Math.max(movePreview.durationMin * PX_PER_MIN, MIN_ENTRY_PX)}px`,
                    }}
                  >
                    <span className="cal-move-preview__time">
                      {clockLabel(movePreview.startMin)} – {clockLabel(movePreview.startMin + movePreview.durationMin)}
                    </span>
                  </div>
                )}

                {/* Live preview while dragging out a new entry's time range */}
                {dragCreate && dragCreate.dayIdx === dayIdx && (() => {
                  const lo = Math.min(dragCreate.fromRow, dragCreate.toRow);
                  const hi = Math.max(dragCreate.fromRow, dragCreate.toRow);
                  return (
                    <div
                      className="cal-drag-preview"
                      style={{ top: `${lo * SLOT_HEIGHT}px`, height: `${(hi - lo + 1) * SLOT_HEIGHT}px` }}
                    />
                  );
                })()}
              </div>
            );
          })}

          {/* Keyboard-navigable slot cells — row-major so ARIA rows span all
              days. Each entry block is rendered inside the gridcell it starts
              in, so the grid actually contains its entries (screen readers in
              table-navigation mode reach them instead of seeing empty cells). */}
          {timeSlots.map((_, row) => (
            <div
              key={row}
              role="row"
              aria-rowindex={row + 1}
              className="calendar__slot-row"
              style={{ gridRow: row + 1 }}
            >
              {weekDays.map((day, col) => {
                const ds = localDateStr(day);
                const isToday = ds === today;
                const isFocused = focusedCell.row === row && focusedCell.col === col;
                const cellEntries = entriesByCell.get(`${ds}-${row}`);
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
                    style={{ gridColumn: col + 1 }}
                    tabIndex={isFocused ? 0 : -1}
                    aria-label={`${formatSlotTime(row)} on ${day.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })} — click, or drag to set a time range`}
                    onPointerDown={(e) => handleSlotPointerDown(e, ds, row, col)}
                    onPointerMove={handleSlotPointerMove}
                    onPointerUp={handleSlotPointerUp}
                    onPointerCancel={handleSlotPointerCancel}
                    onKeyDown={(e) => handleCellKeyDown(e, row, col, ds)}
                    onFocus={() => setFocusedCell({ row, col })}
                  >
                    {/* Ghosts render before (so behind) the tracked entries. */}
                    {ghostsByCell.get(`${ds}-${row}`)?.map(({ event, startMin, endMin }) => (
                      <OutlookGhostBlock
                        key={event.id}
                        event={event}
                        startMin={startMin}
                        endMin={endMin}
                        rowTopMin={row * 30}
                        logged={loggedEventIds.has(event.id)}
                        onLog={openLogEvent}
                      />
                    ))}
                    {cellEntries?.map((p) => renderEntryBlock(p, row * 30))}
                  </div>
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
