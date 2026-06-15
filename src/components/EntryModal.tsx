import React, { useEffect, useMemo, useState } from "react";
import type { Project, Task } from "../types";
import { formatMinutes, parseRatioInput } from "../hooks";
import { IconX } from "./Icons";

export interface EntryDraft {
  date: string;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  description: string;
  projectId: string;
  taskId: string;
  jiraTicket: string;
  ratio: string;
}

/** Normalised payload handed back on save — times are ISO, duration computed. */
export interface EntrySaveData {
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  description?: string;
  projectId: string;
  taskId?: string;
  jiraTicket?: string;
  ratio?: number;
}

interface Props {
  title: string;
  initial: EntryDraft;
  projects: Project[];
  tasks: Task[];
  onSave: (data: EntrySaveData) => Promise<unknown>;
  onDelete?: () => void;
  onClose: () => void;
  onLoadTasksForProject?: (projectId: string) => void;
}

export const EntryModal: React.FC<Props> = ({ title, initial, projects, tasks, onSave, onDelete, onClose, onLoadTasksForProject }) => {
  const [draft, setDraft] = useState<EntryDraft>(initial);
  const [saving, setSaving] = useState(false);

  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === draft.projectId),
    [tasks, draft.projectId]
  );

  // Load tasks for the initially-selected project and whenever it changes.
  useEffect(() => {
    if (draft.projectId) onLoadTasksForProject?.(draft.projectId);
  }, [draft.projectId, onLoadTasksForProject]);

  // While a save is in flight, ignore every close/dismiss path so the modal
  // can't be torn down (or the entry deleted) mid-request.
  const safeClose = () => { if (!saving) onClose(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") safeClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const startDt = draft.date && draft.startTime ? new Date(`${draft.date}T${draft.startTime}:00`) : null;
  // An end of 00:00 means "midnight at the END of this day" — build it on the
  // next day so 23:30 → 00:00 is a valid 30-minute entry, not a negative one.
  const endDt = draft.date && draft.endTime
    ? new Date(new Date(`${draft.date}T${draft.endTime}:00`).getTime() + (draft.endTime === "00:00" ? 24 * 60 * 60 * 1000 : 0))
    : null;
  const durationMinutes = startDt && endDt
    ? Math.round((endDt.getTime() - startDt.getTime()) / 60000)
    : null;

  const timeError = durationMinutes !== null && durationMinutes <= 0
    ? "End time must be after the start time. For overnight work, split the entry at midnight."
    : null;

  const canSave = !!draft.projectId && !!startDt && !!endDt && !timeError && !saving;

  const set = (patch: Partial<EntryDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const handleSave = async () => {
    if (!canSave || !startDt || !endDt) return;
    setSaving(true);
    try {
      await onSave({
        date: draft.date,
        startTime: startDt.toISOString(),
        endTime: endDt.toISOString(),
        durationMinutes: durationMinutes!,
        description: draft.description.trim() || undefined,
        projectId: draft.projectId,
        taskId: draft.taskId || undefined,
        jiraTicket: draft.jiraTicket.trim() || undefined,
        ratio: parseRatioInput(draft.ratio),
      });
      onClose();
    } catch {
      // The data hooks already toast the failure; keep the modal open for retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cal-modal-overlay" onClick={safeClose}>
      <div className="cal-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="cal-modal__header">
          <h3 className="cal-modal__title">{title}</h3>
          <button className="cal-modal__close" onClick={safeClose} disabled={saving} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="cal-modal__body">
          <div className="field">
            <label className="cal-modal__label" htmlFor="entry-desc">Description</label>
            <input
              id="entry-desc"
              className="form-input"
              placeholder="What did you work on?"
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
              autoFocus
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label className="cal-modal__label" htmlFor="entry-project">Project</label>
              <select
                id="entry-project"
                className="form-input"
                value={draft.projectId}
                onChange={(e) => set({ projectId: e.target.value, taskId: "" })}
              >
                <option value="">Select project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="cal-modal__label" htmlFor="entry-task">Task</label>
              <select
                id="entry-task"
                className="form-input"
                value={draft.taskId}
                onChange={(e) => set({ taskId: e.target.value })}
                disabled={!draft.projectId}
              >
                <option value="">No task</option>
                {projectTasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="cal-modal__time-row">
            <div className="cal-modal__time-group">
              <label className="cal-modal__label" htmlFor="entry-date">Date</label>
              <input
                id="entry-date"
                type="date"
                className="entry-edit-form__time-input"
                value={draft.date}
                onChange={(e) => set({ date: e.target.value })}
              />
            </div>
            <div className="cal-modal__time-group">
              <label className="cal-modal__label" htmlFor="entry-start">Start</label>
              <input
                id="entry-start"
                type="time"
                className="entry-edit-form__time-input"
                value={draft.startTime}
                onChange={(e) => set({ startTime: e.target.value })}
              />
            </div>
            <div className="cal-modal__time-group">
              <label className="cal-modal__label" htmlFor="entry-end">End</label>
              <input
                id="entry-end"
                type="time"
                className="entry-edit-form__time-input"
                value={draft.endTime}
                onChange={(e) => set({ endTime: e.target.value })}
              />
            </div>
          </div>
          {timeError ? (
            <p className="form-error" role="alert">{timeError}</p>
          ) : durationMinutes !== null && durationMinutes > 0 ? (
            <p className="form-hint">Duration: {formatMinutes(durationMinutes)}</p>
          ) : null}
          <div className="field-row">
            <div className="field">
              <label className="cal-modal__label" htmlFor="entry-jira">Jira ticket</label>
              <input
                id="entry-jira"
                className="form-input"
                placeholder="e.g. PROJ-123"
                value={draft.jiraTicket}
                onChange={(e) => set({ jiraTicket: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="cal-modal__label" htmlFor="entry-ratio">Ratio</label>
              <input
                id="entry-ratio"
                className="form-input"
                type="number"
                step="1"
                min="0"
                placeholder="Optional"
                value={draft.ratio}
                onChange={(e) => set({ ratio: e.target.value })}
              />
            </div>
          </div>
        </div>
        <div className="cal-modal__footer">
          <button className="btn-primary" onClick={handleSave} disabled={!canSave}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button className="btn-ghost" onClick={safeClose} disabled={saving}>Cancel</button>
          {onDelete && (
            <button className="cal-modal__delete" onClick={() => { if (!saving) onDelete(); }} disabled={saving} aria-label="Delete entry">Delete</button>
          )}
        </div>
      </div>
    </div>
  );
};
