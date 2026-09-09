import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OutlookEvent, TimeEntry } from "../types";
import { useOutlookOverlay } from "../hooks/useOutlookOverlay";
import {
  DATE_LOCALE, clockAt, localDateStr, minutesOfDay, toTimeInput,
} from "../utils/dates";
import { Gap, findUntrackedGaps } from "../utils/gaps";
import { rangeLabel } from "../utils/ranges";
import { byId, indexById } from "../utils/entityIndex";
import { DEFAULT_PROJECT_COLOR } from "../utils/colors";
import {
  MINUTES_PER_DAY,
  PX_PER_MIN,
  Positioned,
  SLOTS_PER_HOUR,
  SLOT_HEIGHT,
  SNAP_MIN,
  TOTAL_SLOTS,
  clockLabel,
  formatHour,
  formatSlotTime,
  getWeekDays,
  layoutDay,
} from "../utils/calendarGeometry";
import { formatMinutes } from "../hooks";
import { useDragCreate, useEntryMove, useEntryResize } from "../hooks/useCalendarDrag";
import { useGridRovingFocus } from "../hooks/useGridRovingFocus";
import { useRangeRequest } from "../contexts/DataRangeContext";
import { useData } from "../contexts/DataContext";
import type { WorkingHours } from "../hooks/useWorkingHours";
import { EntrySheet, EntryDraft, EntrySaveData } from "./EntrySheet";
import { FloatingActionBar } from "./FloatingActionBar";

interface Props {
  workingHours: WorkingHours;
}

interface ModalState {
  editingId: string | null; // null = create
  draft: EntryDraft;
  /** Set when the modal was opened from an Outlook meeting — a successful
   *  save marks that event as logged (see outlookService). */
  sourceEventId?: string;
  /** Meetings still to log after this one, when the modal was opened by a
   *  day's "Log all". Saving advances; cancelling abandons the rest. */
  queue?: OutlookEvent[];
  /** Position in that run, for the modal title ("Log Time · 2 of 5"). */
  queueStep?: { at: number; total: number };
}

// Full 24h grid (geometry constants live in utils/calendarGeometry); we
// auto-scroll to the workday on mount so early/late entries are never
// silently hidden.
const SCROLL_TO_HOUR = 7;
const MIN_ENTRY_PX = 22;

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

  // data-entry-id: the block is remounted into a different gridcell whenever
  // a reschedule crosses a slot or day boundary, and this is how the page
  // finds the new node to hand keyboard focus back to (#89).
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
        borderLeft: `3px solid ${color}`,
        // Project accent colors include dark swatches (navy, forest) picked to
        // read fine on light theme's white cards; on dark theme's near-black
        // cards that same dark hex is barely distinguishable from the
        // background. --pc feeds .cal-entry's own background plus
        // .cal-entry__name/__handle, all of which mix it against the current
        // surface in CSS (see styles.css) instead of using it raw.
        "--pc": color,
      } as React.CSSProperties}
      data-entry-id={entry.id}
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
          {clockAt(minutesOfDay(entry.startTime))}
          {" – "}
          {running
            ? "now"
            : clockAt(minutesOfDay(entry.endTime!))}
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
  onMute: (subject: string) => void;
}

/**
 * An Outlook meeting drawn behind the tracked entries (z-index below
 * .cal-entry). Clicking it opens the Log Time modal prefilled with the
 * meeting's span and subject — the categorize step.
 *
 * Deliberately the quietest object on the grid: a flat tint and a dashed left
 * edge, no hatch and no full border. Twenty-plus ghosts each carrying a
 * diagonal hatch made the texture *be* the page, and a week with nothing
 * tracked read as fully booked rather than fully untracked. The tracked
 * entries this page exists to show are the only high-contrast things on it.
 */
const OutlookGhostBlock = React.memo<GhostBlockProps>(({ event, startMin, endMin, rowTopMin, logged, onLog, onMute }) => {
  const top = (startMin - rowTopMin) * PX_PER_MIN;
  const height = Math.max((endMin - startMin) * PX_PER_MIN - 2, MIN_ENTRY_PX);
  const timeLabel = `${clockLabel(startMin)} – ${clockLabel(endMin)}`;
  return (
    // A plain container holding two sibling buttons. The block used to be a
    // role="button" div, which left nowhere valid to put the mute control —
    // a button nested inside another button is not a thing.
    <div
      className={`cal-ghost ${logged ? "cal-ghost--logged" : ""}`}
      style={{ top: `${top}px`, height: `${height}px` }}
      // Stop the cell's drag-to-create from also arming on this press.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Fills the block, so the whole meeting is the click target. A real
          button, so Enter/Space work without hand-rolled key handling. */}
      <button
        type="button"
        className="cal-ghost__log"
        onClick={(e) => { e.stopPropagation(); onLog(event); }}
        aria-label={`Log time for Outlook meeting: ${event.subject}, ${timeLabel}${logged ? " (already logged)" : ""}`}
        title={logged
          ? `${event.subject} — already logged; click to log again`
          : `${event.subject} — click to log this meeting as a time entry`}
      >
        <span className="cal-ghost__name">
          {logged && <span className="cal-ghost__check" aria-hidden="true">✓ </span>}
          {event.subject}
        </span>
        {height >= 42 && <span className="cal-ghost__time">{timeLabel}</span>}
      </button>
      {/* Spelled out on hover/focus rather than left to a bare click, which
          nothing on the block announced. */}
      <div className="cal-ghost__actions">
        {!logged && <span className="cal-ghost__cta" aria-hidden="true">+ Log</span>}
        <button
          type="button"
          className="cal-ghost__mute"
          onClick={(e) => { e.stopPropagation(); onMute(event.subject); }}
          title={`Hide every "${event.subject}" from the overlay`}
          aria-label={`Hide all "${event.subject}" meetings from the calendar overlay`}
        >
          Hide
        </button>
      </div>
    </div>
  );
});
OutlookGhostBlock.displayName = "OutlookGhostBlock";

interface GapBlockProps {
  /** Passed through to `onFill` so the handler can be one stable function for
   *  the whole grid — closing over the day per cell handed this memo a fresh
   *  `onFill` on every render and it never once hit (#95). */
  date: string;
  startMin: number;
  endMin: number;
  rowTopMin: number;
  dayLabel: string;
  onFill: (date: string, startMin: number, endMin: number) => void;
}

/**
 * A stretch of the working day nothing was logged against (P2-15), drawn as
 * a faint hatched slot behind everything else.
 *
 * The slot itself is inert (pointer-events: none) and only its label is a
 * button. A gap routinely spans hours, and swallowing pointer events across
 * all of it would take drag-to-create away exactly where it's most useful —
 * on the empty parts of a thin day. So: drag anywhere to log a span you
 * choose, or click the label to fill the whole gap in one go.
 */
const UntrackedGapBlock = React.memo<GapBlockProps>(({ date, startMin, endMin, rowTopMin, dayLabel, onFill }) => {
  const top = (startMin - rowTopMin) * PX_PER_MIN;
  const height = Math.max((endMin - startMin) * PX_PER_MIN - 2, MIN_ENTRY_PX);
  const duration = formatMinutes(endMin - startMin);
  const timeLabel = `${clockLabel(startMin)} – ${clockLabel(endMin)}`;
  return (
    // No aria-hidden on the wrapper: it would take the button inside it out of
    // the accessibility tree too, and that button is the whole feature.
    <div className="cal-gap" style={{ top: `${top}px`, height: `${height}px` }}>
      <button
        type="button"
        className="cal-gap__fill"
        aria-label={`Log the untracked ${duration} on ${dayLabel}, ${timeLabel}`}
        title={`${duration} untracked, ${timeLabel} — click to fill it in`}
        // Stop the cell's drag-to-create from also arming on this press.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onFill(date, startMin, endMin); }}
      >
        + {duration} untracked
      </button>
    </div>
  );
});
UntrackedGapBlock.displayName = "UntrackedGapBlock";

export const CalendarPage: React.FC<Props> = ({ workingHours }) => {
  const {
    entries, projects, tasks,
    createEntry: onCreateEntry, editEntry: onEdit, deleteEntry: onDelete,
    loadTasksForProject: onLoadTasksForProject, addTask,
  } = useData();
  const [anchor, setAnchor] = useState(() => new Date());
  const weekDays = useMemo(() => getWeekDays(anchor), [anchor]);
  const projectById = useMemo(() => indexById(projects), [projects]);
  const taskById = useMemo(() => indexById(tasks), [tasks]);
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
  // Mode, muting, logged-ids and ghost placement live in useOutlookOverlay;
  // what stays here is the write path — the modal, and the queue that walks
  // it for "Log all" (#115).
  const outlook = useOutlookOverlay(weekBounds.from, weekBounds.to);
  const { events: outlookEvents, unloggedByDate, loggedEventIds } = outlook;

  // Click a meeting → the normal Log Time modal, prefilled with the meeting's
  // span and subject; the user adds project/task and saves.
  const openLogEvent = useCallback((
    event: OutlookEvent,
    queue: OutlookEvent[] = [],
    queueStep?: { at: number; total: number },
  ) => {
    const date = localDateStr(new Date(event.startTime));
    const crossesMidnight = localDateStr(new Date(event.endTime)) > date;
    setModal({
      editingId: null,
      sourceEventId: event.id,
      queue,
      queueStep,
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

  // "Log all" walks the day's meetings one modal at a time rather than
  // creating entries in bulk: each meeting still needs a project, and they
  // genuinely go to different ones. The queue only saves the re-clicking.
  const logAllForDay = useCallback((date: string) => {
    const list = unloggedByDate.get(date) ?? [];
    if (list.length === 0) return;
    openLogEvent(list[0], list.slice(1), { at: 1, total: list.length });
  }, [unloggedByDate, openLogEvent]);

  const [modal, setModal] = useState<ModalState | null>(null);

  // Roving tabindex for the grid's keyboard-navigable slot cells.
  const grid = useGridRovingFocus(TOTAL_SLOTS, weekDays.length, {
    row: SCROLL_TO_HOUR * SLOTS_PER_HOUR,
    col: 0,
  });
  const { focused: focusedCell, setFocused: setFocusedCell } = grid;

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

  // The week, not the month: the screen shows seven days, and naming it
  // "September 2026" describes something four times larger than what is on it.
  const weekLabel = useMemo(
    () => rangeLabel(localDateStr(weekDays[0]), localDateStr(weekDays[6])),
    [weekDays]
  );

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
  // Stable: it reads nothing but its arguments, and the gap blocks take it as
  // a prop through React.memo.
  const openCreate = useCallback((dayStr: string, startTotalMins: number, endTotalMinsArg?: number) => {
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
  }, []);

  // The three pointer gestures and the keyboard nudge live in
  // hooks/useCalendarDrag — each is a state machine worth testing without a
  // rendered grid underneath it (#115).
  const dragCreate = useDragCreate(gridRef, openCreate, setFocusedCell);
  const resize = useEntryResize(gridRef, onEdit);
  const move = useEntryMove({ gridRef, weekDays, weekBounds, projectById, onEdit });
  // Destructured because these are the stable halves. The hook objects
  // themselves change identity whenever a drag previews, and depending on one
  // would re-create the entry-block callbacks mid-drag — exactly the churn
  // the memoized blocks exist to avoid (#95).
  const { cancel: cancelCreate } = dragCreate;
  const { cancel: cancelResize } = resize;
  const {
    cancel: cancelMove, nudge: nudgeEntry, refocusIdRef, consumeSuppressedClick,
  } = move;

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

  // Put focus back on a nudged entry's freshly-mounted node. Only when focus
  // actually fell to the body — if the entry stayed in its cell the node was
  // never unmounted and still holds focus, and if the user has moved on to
  // something else in the meantime, stealing it back would be worse than the
  // bug (#89). useLayoutEffect so it lands before the browser paints.
  useLayoutEffect(() => {
    const id = refocusIdRef.current;
    if (!id) return;
    refocusIdRef.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    const blocks = gridRef.current?.querySelectorAll<HTMLElement>("[data-entry-id]") ?? [];
    Array.from(blocks).find((el) => el.dataset.entryId === id)?.focus();
  }, [entriesByCell, refocusIdRef]);

  // Untracked gaps (P2-15), grouped into slot cells the same way. Computed
  // per visible day from entries already in memory — no extra fetch.
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const collectGaps = useCallback((target: Map<string, Gap[]>, date: string, upTo: number | undefined, atMinutes: number) => {
    findUntrackedGaps({ entries, date, nowMinutes: atMinutes, upperBoundMin: upTo }).forEach((gap) => {
      const row = Math.max(0, Math.min(Math.floor(gap.startMin / 30), TOTAL_SLOTS - 1));
      const key = `${date}-${row}`;
      const list = target.get(key);
      if (list) list.push(gap);
      else target.set(key, [gap]);
    });
  }, [entries]);

  // A finished day can't grow a new gap, so the six of them are memoized on
  // the data alone. Only today's trailing gap has to keep pace with the clock,
  // and folding it in separately is what stops the minute tick from rescanning
  // every entry seven times over (#95).
  const pastGapsByCell = useMemo(() => {
    const m = new Map<string, Gap[]>();
    weekDays.forEach((day) => {
      const date = localDateStr(day);
      // Future days have nothing to be missing yet; today is handled below.
      if (date >= today) return;
      collectGaps(m, date, undefined, MINUTES_PER_DAY);
    });
    return m;
  }, [weekDays, today, collectGaps]);

  const gapsByCell = useMemo(() => {
    if (!weekDays.some((day) => localDateStr(day) === today)) return pastGapsByCell;
    const m = new Map(pastGapsByCell);
    collectGaps(m, today, nowMinutes, nowMinutes);
    return m;
  }, [pastGapsByCell, weekDays, today, nowMinutes, collectGaps]);

  // Escape drops an in-progress drag-create, drag-resize or drag-move
  // instead of letting the eventual pointerup commit a change the user
  // regrets. The stray pointerup that follows is harmless: every handler
  // no-ops once its drag state is cleared.
  useEffect(() => {
    if (!dragCreate.state && !resize.preview && !move.preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Consume the keystroke: this Escape means "cancel the drag", and it
      // must not double as input to any other window-level handler.
      e.preventDefault();
      e.stopPropagation();
      cancelCreate();
      cancelResize();
      cancelMove();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragCreate.state, resize.preview, move.preview, cancelCreate, cancelResize, cancelMove]);

  // Arrows/Home/End are the grid cursor's; Enter and Space create at the
  // focused slot, which is the calendar's business rather than the cursor's.
  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, row: number, col: number, dayStr: string) => {
    if (grid.onKeyDown(e, row, col)) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openCreate(dayStr, row * 30);
    }
  };

  // Click or keyboard-activate existing entry → edit
  const handleEntryClick = useCallback((e: React.MouseEvent | React.KeyboardEvent, entry: TimeEntry) => {
    e.stopPropagation();
    // The click that closes a drag-to-move isn't a request to edit (#79).
    if (consumeSuppressedClick()) {
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
  }, [consumeSuppressedClick]);

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

  // Set on a successful save that has more of a "Log all" run to go. The
  // modal calls onClose itself once a save lands, so the close handler is
  // where the next meeting gets opened — and because only a *save* arms this,
  // cancelling or pressing Escape abandons the rest of the run, as it should.
  const queueAdvanceRef = useRef<{ next: OutlookEvent; rest: OutlookEvent[]; step: { at: number; total: number } } | null>(null);

  const handleModalSave = async (data: EntrySaveData) => {
    if (modal?.editingId) {
      await onEdit(modal.editingId, data);
    } else {
      await onCreateEntry(data);
    }
  };

  // Runs only once the entry is completely saved — including both halves of an
  // overnight split. Doing this per-onSave instead would, if the second half
  // failed and the user then cancelled, advance the queue past a meeting that
  // was only half-recorded and tick its ghost off as logged.
  const handleModalSaved = () => {
    if (modal?.editingId) return;
    // Remember the source meeting so its ghost renders with a "logged" check.
    if (modal?.sourceEventId) {
      outlook.markLogged(modal.sourceEventId);
    }
    const [next, ...rest] = modal?.queue ?? [];
    queueAdvanceRef.current = next && modal?.queueStep
      ? { next, rest, step: { at: modal.queueStep.at + 1, total: modal.queueStep.total } }
      : null;
  };

  const closeModal = useCallback(() => {
    const advance = queueAdvanceRef.current;
    queueAdvanceRef.current = null;
    if (advance) openLogEvent(advance.next, advance.rest, advance.step);
    else setModal(null);
  }, [openLogEvent]);

  // Render one positioned entry block. Called from inside the `gridcell` the
  // entry starts in, so the block is positioned relative to that cell
  // (rowTopMin = the cell's minutes-of-day top).
  const renderEntryBlock = (p: Positioned, rowTopMin: number) => {
    const { entry, startMin, endMin, running, col, cols } = p;
    const project = projectById.get(entry.projectId);
    const task = byId(taskById, entry.taskId);
    const reshapable = !running && !!entry.endTime && localDateStr(new Date(entry.endTime)) <= entry.date;
    const isResizing = resize.preview?.entryId === entry.id;
    const effStartMin = isResizing && resize.preview!.edge === "start" ? resize.preview!.minutes : startMin;
    const effEndMin = isResizing && resize.preview!.edge === "end" ? resize.preview!.minutes : endMin;
    return (
      <CalendarEntryBlock
        key={entry.id}
        entry={entry}
        startMin={effStartMin}
        endMin={effEndMin}
        rowTopMin={rowTopMin}
        running={running}
        reshapable={reshapable}
        moving={move.preview?.entryId === entry.id}
        col={col}
        cols={cols}
        color={project?.color || DEFAULT_PROJECT_COLOR}
        projectName={project?.name || "Untitled"}
        taskName={task?.name}
        onClick={handleEntryClick}
        onKeyDown={handleEntryKeyDown}
        onResizeStart={resize.onStart}
        onResizeMove={resize.onMove}
        onResizeEnd={resize.onEnd}
        onResizeCancel={resize.cancel}
        onMoveStart={move.onStart}
        onMoveMove={move.onMove}
        onMoveEnd={move.onEnd}
        onMoveCancel={move.cancel}
      />
    );
  };

  return (
    <div className={`calendar ${outlook.mode === "faded" ? "calendar--outlook-faded" : ""}`}>

      {/* A Shift+arrow reschedule moves a block the user may not be able to
          see; without this the new time is confirmed nowhere, for anyone
          (WCAG 4.1.3). Kept outside the grid so a screen reader in
          table-navigation mode doesn't meet it as a stray cell. */}
      <div className="visually-hidden" role="status" aria-live="polite">{move.nudgeMessage}</div>

      {modal && (
        <EntrySheet
          // Advancing a "Log all" run swaps the draft without the sheet ever
          // unmounting, and EntrySheet seeds its own state from `initial`
          // once — without this key the next meeting would inherit the
          // previous one's form.
          key={modal.sourceEventId ?? modal.editingId ?? "new"}
          mode={modal.editingId ? "edit" : "create"}
          title={modal.queueStep ? `Log time · ${modal.queueStep.at} of ${modal.queueStep.total}` : undefined}
          entryId={modal.editingId ?? undefined}
          initial={modal.draft}
          projects={projects}
          tasks={tasks}
          dayEntries={entries.filter((e) => e.date === modal.draft.date)}
          workingHours={workingHours}
          nowMinutes={nowMinutes}
          onSave={handleModalSave}
          onSaved={handleModalSaved}
          onDelete={modal.editingId ? () => { onDelete(modal.editingId!); setModal(null); } : undefined}
          onClose={closeModal}
          onLoadTasksForProject={onLoadTasksForProject}
          onAddTask={addTask}
        />
      )}

      {/* ── Header ── */}
      <div className="calendar__header">
        <div className="calendar__title-row">
          <div className="calendar__title-group">
            <h1 className="calendar__title">{weekLabel}</h1>
            <span className="calendar__week-total">{formatMinutes(weekTotal)}</span>
          </div>
          <div className="calendar__nav">
            {/* One chip owns show/hide; a second appears only when a shown
                overlay failed to load and a retry makes sense. */}
            {outlook.mode === "off" ? (
              <button className="cal-outlook-toggle" onClick={outlook.cycleMode}>
                Outlook off
              </button>
            ) : outlook.status === "unavailable" ? (
              <button
                className="cal-outlook-toggle cal-outlook-toggle--warn"
                onClick={outlook.cycleMode}
                title="The Office 365 Outlook connector isn't set up for this app yet — an admin needs to add it (see the README's Outlook calendar section)."
              >
                Outlook not connected
              </button>
            ) : (
              <>
                <button className="cal-outlook-toggle cal-outlook-toggle--active" onClick={outlook.cycleMode}>
                  Outlook {outlook.mode}
                </button>
                {outlook.mutedCount > 0 && (
                  <button className="cal-outlook-toggle" onClick={outlook.unmuteAll}>
                    {outlook.mutedCount} hidden — undo
                  </button>
                )}
                {outlook.status === "error" && (
                  <button className="cal-outlook-toggle cal-outlook-toggle--warn" onClick={outlook.refresh}>
                    Retry
                  </button>
                )}
              </>
            )}
            <button className="cal-nav-btn" onClick={prevWeek} aria-label="Previous week">‹</button>
            <button className="cal-nav-btn cal-nav-btn--today" onClick={goToday}>Today</button>
            <button className="cal-nav-btn" onClick={nextWeek} aria-label="Next week">›</button>
          </div>
        </div>

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
                  {day.toLocaleDateString(DATE_LOCALE, { weekday: "short" })}
                </div>
                <div className={`calendar__day-num ${isToday ? "calendar__day-num--today" : ""}`}>
                  {day.getDate()}
                </div>
                <div className="calendar__day-total">{total > 0 ? formatMinutes(total) : " "}</div>
                {/* One click to walk the day's unaccounted-for meetings,
                    instead of hunting each ghost down individually. */}
                {(unloggedByDate.get(ds)?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    className="cal-day-log-all"
                    onClick={() => logAllForDay(ds)}
                    title={`Log all ${unloggedByDate.get(ds)!.length} meetings on this day, one at a time`}
                  >
                    Log {unloggedByDate.get(ds)!.length}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Mobile day-list view ── */}
      <div className="cal-mobile-day-nav">
        <button className="cal-nav-btn" onClick={() => { const d = new Date(mobileDay); d.setDate(d.getDate() - 1); setMobileDay(d); }} aria-label="Previous day">‹</button>
        <span className="cal-mobile-day-nav__label">
          {mobileDay.toLocaleDateString(DATE_LOCALE, { weekday: "short", day: "numeric", month: "short" })}
        </span>
        <button className="cal-nav-btn" onClick={() => { const d = new Date(mobileDay); d.setDate(d.getDate() + 1); setMobileDay(d); }} aria-label="Next day">›</button>
      </div>
      {isMobile && (() => {
        const ds = localDateStr(mobileDay);
        const dayItems = (positionedByDate.get(ds) ?? []).slice().sort((a, b) => a.startMin - b.startMin);
        const dayGhosts = outlookEvents
          .filter((ev) => localDateStr(new Date(ev.startTime)) === ds)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        // Same reading as the grid: only today is cut off at the current
        // minute, and a past day closes a still-running entry at its own end
        // rather than at a time of day that belongs to a different date.
        const dayGaps = ds > today ? [] : findUntrackedGaps({
          entries,
          date: ds,
          nowMinutes: ds === today ? nowMinutes : MINUTES_PER_DAY,
          upperBoundMin: ds === today ? nowMinutes : undefined,
        });
        return (
          <div className="cal-mobile-list">
            {dayGaps.map((gap) => (
              <button
                key={`gap-${gap.startMin}`}
                type="button"
                className="cal-mobile-gap"
                onClick={() => openCreate(ds, gap.startMin, gap.endMin)}
              >
                <span className="cal-mobile-gap__info">
                  <span className="cal-mobile-gap__name">
                    + {formatMinutes(gap.endMin - gap.startMin)} untracked
                  </span>
                  <span className="cal-mobile-entry__time">
                    {clockLabel(gap.startMin)} – {clockLabel(gap.endMin)}
                  </span>
                </span>
                <span className="cal-mobile-ghost__cta">Fill</span>
              </button>
            ))}
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
                    {loggedEventIds.has(event.id) && <span className="cal-ghost__check" aria-hidden="true">✓ </span>}
                    {event.subject}
                  </div>
                  <div className="cal-mobile-entry__time">
                    {clockAt(minutesOfDay(event.startTime))}
                    {" – "}
                    {clockAt(minutesOfDay(event.endTime))}
                  </div>
                </div>
                <span className="cal-mobile-ghost__cta">{loggedEventIds.has(event.id) ? "Logged" : "Log"}</span>
              </div>
            ))}
            {dayItems.length === 0 ? (
              <p className="cal-mobile-empty">No entries — tap below to add one.</p>
            ) : dayItems.map(({ entry, running }) => {
              const project = projectById.get(entry.projectId);
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
                  <div className="cal-mobile-entry__bar" style={{ background: project?.color || DEFAULT_PROJECT_COLOR }} />
                  <div className="cal-mobile-entry__info">
                    <div className="cal-mobile-entry__name">{entry.description || project?.name || "Untitled"}</div>
                    <div className="cal-mobile-entry__time">
                      {clockAt(minutesOfDay(entry.startTime))}
                      {" – "}
                      {running ? "now" : entry.endTime ? clockAt(minutesOfDay(entry.endTime)) : ""}
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
                  move.registerDayColumn(dayIdx, el);
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
                {move.preview && move.preview.date === ds && (
                  <div
                    className="cal-move-preview"
                    style={{
                      top: `${move.preview.startMin * PX_PER_MIN}px`,
                      height: `${Math.max(move.preview.durationMin * PX_PER_MIN, MIN_ENTRY_PX)}px`,
                    }}
                  >
                    <span className="cal-move-preview__time">
                      {clockLabel(move.preview.startMin)} – {clockLabel(move.preview.startMin + move.preview.durationMin)}
                    </span>
                  </div>
                )}

                {/* Live preview while dragging out a new entry's time range */}
                {dragCreate.state && dragCreate.state.dayIdx === dayIdx && (() => {
                  const lo = Math.min(dragCreate.state.fromRow, dragCreate.state.toRow);
                  const hi = Math.max(dragCreate.state.fromRow, dragCreate.state.toRow);
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
                      grid.registerCell(row, col, el);
                    }}
                    role="gridcell"
                    aria-colindex={col + 1}
                    className="calendar__slot-cell"
                    data-today={isToday ? "true" : undefined}
                    style={{ gridColumn: col + 1 }}
                    tabIndex={isFocused ? 0 : -1}
                    aria-label={`${formatSlotTime(row)} on ${day.toLocaleDateString(DATE_LOCALE, { weekday: "long", day: "numeric", month: "long" })} — click, or drag to set a time range`}
                    onPointerDown={(e) => dragCreate.onPointerDown(e, ds, row, col)}
                    onPointerMove={dragCreate.onPointerMove}
                    onPointerUp={dragCreate.onPointerUp}
                    onPointerCancel={dragCreate.onPointerCancel}
                    onKeyDown={(e) => handleCellKeyDown(e, row, col, ds)}
                    onFocus={() => setFocusedCell({ row, col })}
                  >
                    {/* Untracked gaps sit furthest back — they're the absence
                        of everything else drawn on top of them. */}
                    {gapsByCell.get(`${ds}-${row}`)?.map((gap) => (
                      <UntrackedGapBlock
                        key={`gap-${gap.startMin}`}
                        date={ds}
                        startMin={gap.startMin}
                        endMin={gap.endMin}
                        rowTopMin={row * 30}
                        dayLabel={day.toLocaleDateString(DATE_LOCALE, { weekday: "long", day: "numeric", month: "long" })}
                        onFill={openCreate}
                      />
                    ))}
                    {/* Ghosts render before (so behind) the tracked entries. */}
                    {outlook.ghostsByCell.get(`${ds}-${row}`)?.map(({ event, startMin, endMin }) => (
                      <OutlookGhostBlock
                        key={event.id}
                        event={event}
                        startMin={startMin}
                        endMin={endMin}
                        rowTopMin={row * 30}
                        logged={loggedEventIds.has(event.id)}
                        onLog={openLogEvent}
                        onMute={outlook.muteSubject}
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

      {/* The Calendar's primary action is direct manipulation, so the action
          bar has no button: it teaches the gesture instead — including the
          keyboard route, which is the half a `title` on a block could never
          reach (#106) — and carries the legend for the one thing on the grid
          that isn't yours. */}
      <FloatingActionBar
        hint={
          <>
            <span>
              Drag anywhere on the grid to log time. Drag a block&rsquo;s edge to change it, or
              Tab to one and use Shift + arrow keys.
            </span>
            <span className="action-bar__swatch" aria-hidden="true" />
            <span>Outlook meeting</span>
          </>
        }
      />
    </div>
  );
};
