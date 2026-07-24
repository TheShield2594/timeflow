import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Project, Task } from "../types";
import { formatMinutes, parseRatioInput } from "../hooks";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { addDaysStr } from "../utils/dates";
import { HelpTip } from "./HelpTip";
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

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export const EntryModal: React.FC<Props> = ({ title, initial, projects, tasks, onSave, onDelete, onClose, onLoadTasksForProject }) => {
  const [draft, setDraft] = useState<EntryDraft>(initial);
  const [saving, setSaving] = useState(false);
  const modalRef = useFocusTrap<HTMLDivElement>();
  // null = no overnight conflict; 'ask' = prompt shown; 'keep' = treat end as next day; 'split' = save two entries
  const [overnightMode, setOvernightMode] = useState<'ask' | 'keep' | 'split' | null>(null);

  // Active tasks only — except the entry's current task, which stays listed
  // even if deactivated so editing an old entry doesn't silently clear it.
  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === draft.projectId && (t.isActive || t.id === draft.taskId)),
    [tasks, draft.projectId, draft.taskId]
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

  // Detect overnight: end (non-00:00) is earlier than start in minutes-of-day.
  const isOvernightConflict = !!(
    draft.startTime && draft.endTime && draft.endTime !== "00:00" &&
    timeToMinutes(draft.endTime) < timeToMinutes(draft.startTime)
  );

  // Tracks whether the first half of an overnight split has already been
  // saved, so retrying after the second half failed doesn't duplicate it.
  // Only edits to the fields that define the saved half's time span reset it —
  // re-creating the first half over a description/ratio/ticket tweak would
  // double-count the time, which is worse than those fields staying stale on
  // the already-saved half.
  const splitFirstSaved = useRef(false);

  // Reset overnight choice whenever times change in a way that removes the conflict.
  const set = (patch: Partial<EntryDraft>) => {
    if (patch.date !== undefined || patch.startTime !== undefined || patch.endTime !== undefined) {
      splitFirstSaved.current = false;
    }
    setDraft((d) => {
      const next = { ...d, ...patch };
      const stillOvernight = next.startTime && next.endTime && next.endTime !== "00:00" &&
        timeToMinutes(next.endTime) < timeToMinutes(next.startTime);
      if (!stillOvernight && overnightMode !== null) setOvernightMode(null);
      return next;
    });
  };

  // Show the prompt automatically when an overnight conflict is first detected.
  useEffect(() => {
    if (isOvernightConflict && overnightMode === null) setOvernightMode('ask');
    if (!isOvernightConflict) setOvernightMode(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOvernightConflict]);

  // An end of 00:00, or "keep"/"split" overnight mode, means end is next
  // calendar day. Walk the calendar (addDaysStr) rather than adding 24h of
  // milliseconds, which is an hour off across a DST transition.
  const endsNextDay = draft.endTime === "00:00" || overnightMode === 'keep' || overnightMode === 'split';
  const endDt = draft.date && draft.endTime
    ? new Date(`${endsNextDay ? addDaysStr(draft.date, 1) : draft.date}T${draft.endTime}:00`)
    : null;
  const durationMinutes = startDt && endDt
    ? Math.round((endDt.getTime() - startDt.getTime()) / 60000)
    : null;

  const timeError = durationMinutes !== null && durationMinutes <= 0 && overnightMode !== 'ask'
    ? "End time must be after the start time."
    : null;

  const canSave = !!draft.projectId && !!startDt && !!endDt && !timeError &&
    overnightMode !== 'ask' && !saving;

  const handleSave = async () => {
    if (!canSave || !startDt || !endDt) return;
    setSaving(true);
    const common = {
      description: draft.description.trim() || undefined,
      projectId: draft.projectId,
      taskId: draft.taskId || undefined,
      jiraTicket: draft.jiraTicket.trim() || undefined,
      ratio: parseRatioInput(draft.ratio),
    };
    try {
      if (overnightMode === 'split') {
        // Midnight at the end of the start date = 00:00 on the next calendar
        // day (computed on the calendar, so it's exact on DST days too).
        const nextDay = addDaysStr(draft.date, 1);
        const midnight = new Date(`${nextDay}T00:00:00`).getTime();
        const midnightIso = new Date(midnight).toISOString();
        // Skip the first half if a previous attempt already saved it and only
        // the second half failed — retrying must not duplicate it.
        if (!splitFirstSaved.current) {
          await onSave({
            ...common, date: draft.date,
            startTime: startDt.toISOString(), endTime: midnightIso,
            durationMinutes: Math.round((midnight - startDt.getTime()) / 60000),
          });
          splitFirstSaved.current = true;
        }
        await onSave({
          ...common, date: nextDay,
          startTime: midnightIso, endTime: endDt.toISOString(),
          durationMinutes: Math.round((endDt.getTime() - midnight) / 60000),
        });
      } else {
        await onSave({
          ...common, date: draft.date,
          startTime: startDt.toISOString(),
          endTime: endDt.toISOString(),
          durationMinutes: durationMinutes!,
        });
      }
      onClose();
    } catch {
      // The data hooks already toast the failure; keep the modal open for retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cal-modal-overlay" onClick={safeClose}>
      <div className="cal-modal" ref={modalRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
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
              maxLength={500}
              autoFocus
              data-autofocus
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
                {/* Active projects only — plus the entry's current project if
                    archived, so editing an old entry doesn't clear it. */}
                {projects.filter((p) => p.isActive || p.id === draft.projectId).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.isActive ? "" : " (archived)"}</option>
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
          {overnightMode === 'ask' && (
            <div className="overnight-prompt" role="alert">
              <p className="overnight-prompt__msg">Did you work past midnight? We can split this into two entries.</p>
              <div className="overnight-prompt__actions">
                <button className="btn-sm btn-primary" type="button" onClick={() => setOvernightMode('split')}>Split at midnight</button>
                <button className="btn-sm btn-ghost" type="button" onClick={() => setOvernightMode('keep')}>Keep as-is</button>
                <button className="btn-sm btn-ghost" type="button" onClick={() => { set({ endTime: "" }); setOvernightMode(null); }}>Correct the time</button>
              </div>
            </div>
          )}
          {timeError ? (
            <p className="form-error" role="alert">{timeError}</p>
          ) : overnightMode === 'split' ? (
            <p className="form-hint">Will create two entries: {draft.startTime}→00:00 and 00:00→{draft.endTime} (next day)</p>
          ) : overnightMode === 'keep' && durationMinutes !== null && durationMinutes > 0 ? (
            <p className="form-hint">Duration: {formatMinutes(durationMinutes)} (overnight)</p>
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
                maxLength={50}
              />
            </div>
            <div className="field">
              <span className="cal-modal__label-row">
                <label className="cal-modal__label" htmlFor="entry-ratio">Ratio</label>
                <HelpTip label="What is Ratio?" text="Billing ratio — tells billing which account/rate this entry's time is billed to. Leave blank if not applicable." />
              </span>
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
