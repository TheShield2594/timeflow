import React, { useMemo, useState } from "react";
import type { TimeEntry, Project, Task } from "../types";

interface Props {
  entries: TimeEntry[];
  projects: Project[];
  tasks: Task[];
  onCreateEntry: (data: Omit<TimeEntry, "id">) => Promise<TimeEntry>;
  onEdit: (id: string, data: Partial<TimeEntry>) => Promise<TimeEntry>;
  onDelete: (id: string) => void;
}

interface ModalDraft {
  editingId: string | null; // null = create, string = edit
  date: string;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  description: string;
  projectId: string;
  taskId: string;
}

// Hours displayed: 7 AM to 9 PM
const START_HOUR = 7;
const END_HOUR = 21;
const SLOT_HEIGHT = 36; // px per 30-min slot
const SLOTS_PER_HOUR = 2;
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * SLOTS_PER_HOUR;

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

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function slotIndex(isoTime: string): number {
  const d = new Date(isoTime);
  return (d.getHours() - START_HOUR) * SLOTS_PER_HOUR + (d.getMinutes() >= 30 ? 1 : 0);
}

function slotCount(startIso: string, endIso: string): number {
  const diffMins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
  return Math.max(1, Math.round(diffMins / 30));
}

function formatHour(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display} ${suffix}`;
}

function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const CalendarPage: React.FC<Props> = ({ entries, projects, tasks, onCreateEntry, onEdit, onDelete }) => {
  const [anchor, setAnchor] = useState(() => new Date());
  const weekDays = useMemo(() => getWeekDays(anchor), [anchor]);
  const today = toDateStr(new Date());

  const [modal, setModal] = useState<ModalDraft | null>(null);
  const [saving, setSaving] = useState(false);

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

  // Map: dateStr → TimeEntry[]
  const entriesByDate = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    entries.forEach((e) => {
      if (!e.startTime || !e.endTime) return;
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    });
    return map;
  }, [entries]);

  const monthLabel = useMemo(() => {
    const months = weekDays.map((d) => d.toLocaleDateString("en", { month: "long", year: "numeric" }));
    return [...new Set(months)].join(" / ");
  }, [weekDays]);

  const timeSlots = useMemo(() => {
    const slots: { hour: number; half: boolean }[] = [];
    for (let h = START_HOUR; h < END_HOUR; h++) {
      slots.push({ hour: h, half: false });
      slots.push({ hour: h, half: true });
    }
    return slots;
  }, []);

  const now = new Date();
  const nowSlot =
    now.getHours() >= START_HOUR && now.getHours() < END_HOUR
      ? (now.getHours() - START_HOUR) * SLOTS_PER_HOUR +
        (now.getMinutes() >= 30 ? 1 : 0) +
        now.getMinutes() % 30 / 30
      : null;

  // Click empty slot → create
  const handleSlotClick = (e: React.MouseEvent<HTMLDivElement>, dayStr: string) => {
    if ((e.target as HTMLElement).closest(".cal-entry")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const slotIdx = Math.max(0, Math.min(Math.floor(y / SLOT_HEIGHT), TOTAL_SLOTS - 1));
    const totalMins = START_HOUR * 60 + slotIdx * 30;
    const hour = Math.floor(totalMins / 60);
    const minute = totalMins % 60;
    const endTotalMins = Math.min(totalMins + 60, END_HOUR * 60);
    const endHr = Math.floor(endTotalMins / 60);
    const endMin = endTotalMins % 60;
    setModal({
      editingId: null,
      date: dayStr,
      startTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      endTime: `${String(endHr).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`,
      description: "",
      projectId: "",
      taskId: "",
    });
  };

  // Click existing entry → edit
  const handleEntryClick = (e: React.MouseEvent, entry: TimeEntry) => {
    e.stopPropagation();
    setModal({
      editingId: entry.id,
      date: entry.date,
      startTime: toTimeInput(entry.startTime),
      endTime: entry.endTime ? toTimeInput(entry.endTime) : "",
      description: entry.description || "",
      projectId: entry.projectId,
      taskId: entry.taskId || "",
    });
  };

  const handleSave = async () => {
    if (!modal || !modal.projectId) return;
    setSaving(true);
    try {
      const startDt = new Date(`${modal.date}T${modal.startTime}:00`);
      const endDt = new Date(`${modal.date}T${modal.endTime}:00`);
      const durationMinutes = Math.max(0, Math.round((endDt.getTime() - startDt.getTime()) / 60000));

      if (modal.editingId) {
        await onEdit(modal.editingId, {
          projectId: modal.projectId,
          taskId: modal.taskId || undefined,
          description: modal.description || undefined,
          startTime: startDt.toISOString(),
          endTime: endDt.toISOString(),
          durationMinutes,
          date: modal.date,
        });
      } else {
        await onCreateEntry({
          projectId: modal.projectId,
          taskId: modal.taskId || undefined,
          description: modal.description || undefined,
          startTime: startDt.toISOString(),
          endTime: endDt.toISOString(),
          durationMinutes,
          date: modal.date,
          userId: "current-user",
          userDisplayName: "You",
        });
      }
      setModal(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!modal?.editingId) return;
    onDelete(modal.editingId);
    setModal(null);
  };

  const modalTasks = modal ? tasks.filter((t) => t.projectId === modal.projectId) : [];

  return (
    <div className="calendar">

      {/* ── Log Time / Edit Entry Modal ── */}
      {modal && (
        <div className="cal-modal-overlay" onClick={() => setModal(null)}>
          <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cal-modal__header">
              <h3 className="cal-modal__title">{modal.editingId ? "Edit Entry" : "Log Time"}</h3>
              <button className="cal-modal__close" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="cal-modal__body">
              <input
                className="form-input"
                placeholder="Description (optional)"
                value={modal.description}
                onChange={(e) => setModal((d) => d && ({ ...d, description: e.target.value }))}
                autoFocus
              />
              <select
                className="form-input"
                value={modal.projectId}
                onChange={(e) => setModal((d) => d && ({ ...d, projectId: e.target.value, taskId: "" }))}
              >
                <option value="">Select project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {modal.projectId && (
                <select
                  className="form-input"
                  value={modal.taskId}
                  onChange={(e) => setModal((d) => d && ({ ...d, taskId: e.target.value }))}
                >
                  <option value="">No task</option>
                  {modalTasks.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
              <div className="cal-modal__time-row">
                <div className="cal-modal__time-group">
                  <label className="cal-modal__label">Date</label>
                  <input
                    type="date"
                    className="entry-edit-form__time-input"
                    value={modal.date}
                    onChange={(e) => setModal((d) => d && ({ ...d, date: e.target.value }))}
                  />
                </div>
                <div className="cal-modal__time-group">
                  <label className="cal-modal__label">Start</label>
                  <input
                    type="time"
                    className="entry-edit-form__time-input"
                    value={modal.startTime}
                    onChange={(e) => setModal((d) => d && ({ ...d, startTime: e.target.value }))}
                  />
                </div>
                <div className="cal-modal__time-group">
                  <label className="cal-modal__label">End</label>
                  <input
                    type="time"
                    className="entry-edit-form__time-input"
                    value={modal.endTime}
                    onChange={(e) => setModal((d) => d && ({ ...d, endTime: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div className="cal-modal__footer">
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={!modal.projectId || saving}
              >
                {saving ? "Saving…" : modal.editingId ? "Save Changes" : "Save Entry"}
              </button>
              <button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              {modal.editingId && (
                <button className="cal-modal__delete" onClick={handleDelete}>
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="calendar__header">
        <div className="calendar__title-row">
          <h2 className="calendar__title">{monthLabel}</h2>
          <div className="calendar__nav">
            <button className="cal-nav-btn" onClick={prevWeek}>‹</button>
            <button className="cal-nav-btn cal-nav-btn--today" onClick={goToday}>Today</button>
            <button className="cal-nav-btn" onClick={nextWeek}>›</button>
          </div>
        </div>

        {/* Day headers */}
        <div className="calendar__day-headers">
          <div className="calendar__gutter" />
          {weekDays.map((day) => {
            const ds = toDateStr(day);
            const isToday = ds === today;
            return (
              <div key={ds} className={`calendar__day-header ${isToday ? "calendar__day-header--today" : ""}`}>
                <div className="calendar__day-name">
                  {day.toLocaleDateString("en", { weekday: "short" })}
                </div>
                <div className={`calendar__day-num ${isToday ? "calendar__day-num--today" : ""}`}>
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="calendar__body">
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
            const ds = toDateStr(day);
            const isToday = ds === today;
            const dayEntries = entriesByDate.get(ds) || [];

            return (
              <div
                key={ds}
                className={`calendar__day-col calendar__day-col--clickable ${isToday ? "calendar__day-col--today" : ""}`}
                onClick={(e) => handleSlotClick(e, ds)}
                title="Click to log time"
              >
                {/* Slot lines */}
                {timeSlots.map(({ half }, i) => (
                  <div key={i} className={`calendar__slot-line ${half ? "calendar__slot-line--half" : ""}`} />
                ))}

                {/* Current time indicator */}
                {isToday && nowSlot !== null && (
                  <div
                    className="calendar__now-line"
                    style={{ top: `${nowSlot * SLOT_HEIGHT}px` }}
                  />
                )}

                {/* Time entries */}
                {dayEntries.map((entry) => {
                  const project = projects.find((p) => p.id === entry.projectId);
                  const task = tasks.find((t) => t.id === entry.taskId);
                  const startSlot = slotIndex(entry.startTime);
                  const slots = slotCount(entry.startTime, entry.endTime!);
                  const top = startSlot * SLOT_HEIGHT;
                  const height = slots * SLOT_HEIGHT - 2;

                  if (startSlot < 0 || startSlot >= TOTAL_SLOTS) return null;

                  return (
                    <div
                      key={entry.id}
                      className="cal-entry cal-entry--clickable"
                      style={{
                        top: `${top}px`,
                        height: `${Math.min(height, (TOTAL_SLOTS - startSlot) * SLOT_HEIGHT - 2)}px`,
                        background: (project?.color || "#6366f1") + "22",
                        borderLeft: `3px solid ${project?.color || "#6366f1"}`,
                      }}
                      onClick={(e) => handleEntryClick(e, entry)}
                      title="Click to edit"
                    >
                      <div className="cal-entry__name" style={{ color: project?.color || "#6366f1" }}>
                        {entry.description || project?.name || "Untitled"}
                      </div>
                      {task && (
                        <div className="cal-entry__task">{task.name}</div>
                      )}
                      {slots >= 2 && (
                        <div className="cal-entry__time">
                          {new Date(entry.startTime).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                          {" – "}
                          {new Date(entry.endTime!).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
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
