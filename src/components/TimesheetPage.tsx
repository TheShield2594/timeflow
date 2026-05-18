import React, { useEffect, useMemo, useState } from "react";
import type { TimeEntry, Project, Task } from "../types";
import { formatMinutes } from "../hooks";
import {
  DateRangeFilter,
  DateRangeState,
  resolveDateRange,
} from "./DateRangeFilter";

interface EditDraft {
  description: string;
  projectId: string;
  taskId: string;
  date: string;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  ratio: string;     // raw input; parsed on save
}

interface Props {
  entries: TimeEntry[];
  projects: Project[];
  tasks: Task[];
  onDelete: (id: string) => void;
  onEdit: (id: string, data: Partial<TimeEntry>) => Promise<TimeEntry>;
  onEnsureRangeLoaded?: (from: string, to: string) => void;
}

const TIMESHEET_PRESETS = ["7d", "30d", "90d", "thisMonth"] as const;

function groupByDate(entries: TimeEntry[]): Map<string, TimeEntry[]> {
  const map = new Map<string, TimeEntry[]>();
  entries.forEach((e) => {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date)!.push(e);
  });
  return map;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
}

function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function friendlyDate(dateStr: string): string {
  const dt = new Date(dateStr + "T00:00:00");
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dateStr === today.toISOString().split("T")[0]) return "Today";
  if (dateStr === yesterday.toISOString().split("T")[0]) return "Yesterday";
  return dt.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" });
}

export const TimesheetPage: React.FC<Props> = ({ entries, projects, tasks, onDelete, onEdit, onEnsureRangeLoaded }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>({
    description: "", projectId: "", taskId: "", date: "", startTime: "", endTime: "", ratio: "",
  });
  const [rangeState, setRangeState] = useState<DateRangeState>({
    preset: "30d",
    customFrom: "",
    customTo: "",
  });

  const { from, to } = useMemo(() => resolveDateRange(rangeState), [rangeState]);

  useEffect(() => {
    onEnsureRangeLoaded?.(from, to);
  }, [from, to, onEnsureRangeLoaded]);

  const filteredEntries = useMemo(
    () => entries.filter((e) => e.date >= from && e.date <= to),
    [entries, from, to]
  );

  const grouped = useMemo(() => groupByDate(filteredEntries), [filteredEntries]);
  const sortedDates = useMemo(
    () => [...grouped.keys()].sort((a, b) => b.localeCompare(a)),
    [grouped]
  );

  const totalMinutes = useMemo(
    () => filteredEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0),
    [filteredEntries]
  );

  const startEdit = (entry: TimeEntry) => {
    setDraft({
      description: entry.description || "",
      projectId: entry.projectId,
      taskId: entry.taskId || "",
      date: entry.date,
      startTime: toTimeInput(entry.startTime),
      endTime: entry.endTime ? toTimeInput(entry.endTime) : "",
      ratio: entry.ratio !== undefined ? String(entry.ratio) : "",
    });
    setEditingId(entry.id);
  };

  const saveEdit = async () => {
    if (!editingId || !draft.projectId) return;
    const startDt = new Date(`${draft.date}T${draft.startTime}:00`);
    const endDt = draft.endTime ? new Date(`${draft.date}T${draft.endTime}:00`) : undefined;
    const durationMinutes = endDt
      ? Math.max(0, Math.round((endDt.getTime() - startDt.getTime()) / 60000))
      : undefined;
    const ratioNum = draft.ratio.trim() === "" ? undefined : Number(draft.ratio);
    await onEdit(editingId, {
      description: draft.description || undefined,
      projectId: draft.projectId,
      taskId: draft.taskId || undefined,
      date: draft.date,
      startTime: startDt.toISOString(),
      endTime: endDt?.toISOString(),
      durationMinutes,
      ratio: Number.isFinite(ratioNum) ? ratioNum : undefined,
    });
    setEditingId(null);
  };

  const filter = (
    <DateRangeFilter
      presets={[...TIMESHEET_PRESETS]}
      value={rangeState}
      onChange={setRangeState}
      info={
        rangeState.preset === "custom" && rangeState.customFrom && rangeState.customTo
          ? `${filteredEntries.length} entries · ${formatMinutes(totalMinutes)} total`
          : undefined
      }
    />
  );

  if (filteredEntries.length === 0) {
    return (
      <div className="timesheet">
        <div className="reports__header">
          <h2 className="timesheet__title">Timesheet</h2>
          {filter}
        </div>
        <div className="timesheet__empty">
          <div className="timesheet__empty-icon">⏱</div>
          <p>
            {entries.length === 0
              ? "No time entries yet. Start the timer to log your first session."
              : "No entries in this range. Pick a wider window above."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="timesheet">
      <div className="reports__header">
        <h2 className="timesheet__title">Timesheet</h2>
        {filter}
      </div>

      {sortedDates.map((date) => {
        const dayEntries = grouped.get(date)!;
        const dayTotal = dayEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);

        return (
          <div key={date} className="timesheet__day">
            <div className="timesheet__day-header">
              <span className="timesheet__day-label">{friendlyDate(date)}</span>
              <span className="timesheet__day-total">{formatMinutes(dayTotal)}</span>
            </div>

            <div className="timesheet__entries">
              {dayEntries.map((entry) => {
                const project = projects.find((p) => p.id === entry.projectId);
                const task = tasks.find((t) => t.id === entry.taskId);
                const isEditing = editingId === entry.id;
                const draftTasks = tasks.filter((t) => t.projectId === draft.projectId);

                if (isEditing) {
                  return (
                    <div key={entry.id} className="entry-edit-form">
                      <input
                        className="form-input"
                        placeholder="Description (optional)"
                        value={draft.description}
                        onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                        autoFocus
                      />
                      <div className="entry-edit-form__row">
                        <select
                          className="entry-edit-form__select"
                          value={draft.projectId}
                          onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value, taskId: "" }))}
                        >
                          <option value="">Select project…</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <select
                          className="entry-edit-form__select"
                          value={draft.taskId}
                          onChange={(e) => setDraft((d) => ({ ...d, taskId: e.target.value }))}
                        >
                          <option value="">No task</option>
                          {draftTasks.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="entry-edit-form__row">
                        <input
                          type="date"
                          className="entry-edit-form__time-input"
                          value={draft.date}
                          onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                        />
                        <input
                          type="time"
                          className="entry-edit-form__time-input"
                          value={draft.startTime}
                          onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value }))}
                        />
                        <span className="entry-edit-form__sep">–</span>
                        <input
                          type="time"
                          className="entry-edit-form__time-input"
                          value={draft.endTime}
                          onChange={(e) => setDraft((d) => ({ ...d, endTime: e.target.value }))}
                        />
                      </div>
                      <div className="entry-edit-form__row">
                        <input
                          type="number"
                          step="any"
                          className="entry-edit-form__time-input"
                          placeholder="Ratio (optional)"
                          value={draft.ratio}
                          onChange={(e) => setDraft((d) => ({ ...d, ratio: e.target.value }))}
                        />
                      </div>
                      <div className="entry-edit-form__actions">
                        <button
                          className="btn-primary"
                          onClick={saveEdit}
                          disabled={!draft.projectId}
                        >
                          Save
                        </button>
                        <button className="btn-ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                        <button
                          className="entry-edit-form__delete"
                          onClick={() => { onDelete(entry.id); setEditingId(null); }}
                        >
                          Delete entry
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={entry.id} className="entry-row">
                    <div
                      className="entry-row__accent"
                      style={{ background: project?.color || "#6366f1" }}
                    />
                    <div className="entry-row__body">
                      <div className="entry-row__top">
                        <span className="entry-row__desc">
                          {entry.description || <em className="entry-row__no-desc">No description</em>}
                        </span>
                        <div className="entry-row__badges">
                          {project && (
                            <span
                              className="badge"
                              style={{ background: project.color + "22", color: project.color, border: `1px solid ${project.color}44` }}
                            >
                              {project.name}
                            </span>
                          )}
                          {task && (
                            <span className="badge badge--task">{task.name}</span>
                          )}
                          {entry.ratio !== undefined && (
                            <span className="badge badge--task">Ratio: {entry.ratio}</span>
                          )}
                        </div>
                      </div>
                      <div className="entry-row__bottom">
                        <span className="entry-row__times">
                          {formatTime(entry.startTime)}
                          {entry.endTime && <> – {formatTime(entry.endTime)}</>}
                        </span>
                        <span className="entry-row__duration">
                          {entry.endTime
                            ? formatMinutes(entry.durationMinutes ?? 0)
                            : <span className="entry-row__running">● Running…</span>
                          }
                        </span>
                      </div>
                    </div>
                    <button
                      className="entry-row__edit"
                      onClick={() => startEdit(entry)}
                      title="Edit entry"
                    >
                      ✎
                    </button>
                    <button
                      className="entry-row__delete"
                      onClick={() => onDelete(entry.id)}
                      title="Delete entry"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
