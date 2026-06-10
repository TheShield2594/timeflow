import React, { useEffect, useMemo, useRef, useState } from "react";
import type { TimeEntry, Project, Task } from "../types";
import { getCurrentUser } from "../services/userService";
import { localDateStr, minutesOfDay, toTimeInput } from "../utils/dates";
import { formatMinutes } from "../hooks";
import { EntryModal, EntryDraft, EntrySaveData } from "./EntryModal";
import { IconChevronLeft, IconChevronRight } from "./Icons";

interface Props {
  entries: TimeEntry[];
  projects: Project[];
  tasks: Task[];
  onCreateEntry: (data: Omit<TimeEntry, "id">) => Promise<TimeEntry>;
  onEdit: (id: string, data: Partial<TimeEntry>) => Promise<TimeEntry>;
  onDelete: (id: string) => void;
  onEnsureRangeLoaded?: (from: string, to: string) => void;
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

export const CalendarPage: React.FC<Props> = ({ entries, projects, tasks, onCreateEntry, onEdit, onDelete, onEnsureRangeLoaded }) => {
  const [anchor, setAnchor] = useState(() => new Date());
  const weekDays = useMemo(() => getWeekDays(anchor), [anchor]);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Re-render once a minute so the now-line, the running entry's height and
  // the "today" highlight stay current during long-lived sessions.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(handle);
  }, []);
  const today = localDateStr(new Date(tick));

  // Land the scroll position at the start of the workday on first render.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: SCROLL_TO_HOUR * SLOTS_PER_HOUR * SLOT_HEIGHT - 6 });
  }, []);

  // Make sure the data for the visible week is loaded — navigating backwards
  // past the initial 90-day window will pull more entries from Dataverse.
  useEffect(() => {
    if (!onEnsureRangeLoaded || weekDays.length === 0) return;
    onEnsureRangeLoaded(localDateStr(weekDays[0]), localDateStr(weekDays[weekDays.length - 1]));
  }, [weekDays, onEnsureRangeLoaded]);

  const [modal, setModal] = useState<ModalState | null>(null);

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

  // Map: dateStr → positioned entries (overlaps resolved into columns).
  // Running entries (no endTime) are drawn up to "now".
  const positionedByDate = useMemo(() => {
    const byDate = new Map<string, Omit<Positioned, "col" | "cols">[]>();
    const nowDate = new Date(tick);
    const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
    entries.forEach((e) => {
      if (!e.startTime) return;
      const running = !e.endTime;
      const startMin = minutesOfDay(e.startTime);
      let endMin: number;
      if (running) {
        endMin = e.date === today ? Math.max(nowMin, startMin + 15) : 24 * 60;
      } else {
        // Entries that spill past local midnight render clamped to the day.
        endMin = localDateStr(new Date(e.endTime!)) > e.date ? 24 * 60 : minutesOfDay(e.endTime!);
      }
      if (endMin <= startMin) endMin = startMin + 15;
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date)!.push({ entry: e, startMin, endMin, running });
    });
    const out = new Map<string, Positioned[]>();
    byDate.forEach((items, date) => out.set(date, layoutDay(items)));
    return out;
  }, [entries, today, tick]);

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
  const openCreate = (dayStr: string, totalMins: number) => {
    const hour = Math.floor(totalMins / 60);
    const minute = totalMins % 60;
    const endTotalMins = Math.min(totalMins + 60, 24 * 60 - 30);
    const endHr = Math.floor(endTotalMins / 60);
    const endMin = endTotalMins % 60;
    setModal({
      editingId: null,
      draft: {
        date: dayStr,
        startTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        endTime: `${String(endHr).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`,
        description: "",
        projectId: "",
        taskId: "",
        jiraTicket: "",
        ratio: "",
      },
    });
  };

  // Click empty slot → create
  const handleSlotClick = (e: React.MouseEvent<HTMLDivElement>, dayStr: string) => {
    if ((e.target as HTMLElement).closest(".cal-entry")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const slotIdx = Math.max(0, Math.min(Math.floor(y / SLOT_HEIGHT), TOTAL_SLOTS - 1));
    openCreate(dayStr, slotIdx * 30);
  };

  // Keyboard on a day column → create at 9 AM (no pointer position to map).
  const handleColKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, dayStr: string) => {
    if (e.target !== e.currentTarget) return; // let entry keys be handled by the entry
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openCreate(dayStr, 9 * 60);
    }
  };

  // Click or keyboard-activate existing entry → edit
  const handleEntryClick = (e: React.MouseEvent | React.KeyboardEvent, entry: TimeEntry) => {
    e.stopPropagation();
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
  };

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
        />
      )}

      {/* ── Header ── */}
      <div className="calendar__header">
        <div className="calendar__title-row">
          <div className="calendar__title-group">
            <h2 className="calendar__title">{monthLabel}</h2>
            <span className="calendar__week-total">{formatMinutes(weekTotal)} this week</span>
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

      {/* ── Grid ── */}
      <div className="calendar__body" ref={bodyRef}>
        <div className="calendar__grid">
          {/* Time gutter */}
          <div className="calendar__time-col">
            {timeSlots.map(({ hour, half }, i) => (
              <div key={i} className="calendar__time-slot">
                <span className="calendar__time-label">
                  {!half ? formatHour(hour) : ""}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((day) => {
            const ds = localDateStr(day);
            const isToday = ds === today;
            const dayEntries = positionedByDate.get(ds) || [];

            return (
              <div
                key={ds}
                className={`calendar__day-col calendar__day-col--clickable ${isToday ? "calendar__day-col--today" : ""}`}
                onClick={(e) => handleSlotClick(e, ds)}
                onKeyDown={(e) => handleColKeyDown(e, ds)}
                role="button"
                tabIndex={0}
                aria-label={`Log time on ${day.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}`}
                title="Click to log time"
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
                  const top = startMin * PX_PER_MIN;
                  const height = Math.max((endMin - startMin) * PX_PER_MIN - 2, MIN_ENTRY_PX);
                  const widthPct = 100 / cols;
                  const color = project?.color || "#6366f1";

                  return (
                    <div
                      key={entry.id}
                      className={`cal-entry cal-entry--clickable ${running ? "cal-entry--running" : ""}`}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `calc(${col * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        background: color + "22",
                        borderLeft: `3px solid ${color}`,
                      }}
                      onClick={(e) => handleEntryClick(e, entry)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleEntryClick(e, entry);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${running ? "Running session" : "Edit entry"}: ${entry.description || project?.name || "Untitled"}`}
                      title={running ? "Timer running" : "Click to edit"}
                    >
                      <div className="cal-entry__name" style={{ color }}>
                        {entry.description || project?.name || "Untitled"}
                      </div>
                      {task && height >= 42 && (
                        <div className="cal-entry__task">{task.name}</div>
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
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
