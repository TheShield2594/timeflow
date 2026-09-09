import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Project, Task, TimeEntry } from "../types";
import { formatMinutes, parseRatioInput } from "../hooks";
import {
  DATE_LOCALE, MINUTES_PER_DAY, addDaysStr, clockAt, isoAtMinutes, localDateStr, minutesOfDay,
} from "../utils/dates";
import { isDirtyDraft } from "../utils/forms";
import { findUntrackedGaps, type Gap } from "../utils/gaps";
import type { WorkingHours } from "../hooks/useWorkingHours";
import { DayBar } from "./DayBar";
import { Sheet } from "./Sheet";
import { Pill } from "./Pill";

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

export type SheetMode = "stop" | "edit" | "create";

interface Props {
  mode: SheetMode;
  /** Overrides the sheet's own heading — the calendar's "Log all" run names
   *  its position in the queue here. */
  title?: string;
  initial: EntryDraft;
  projects: Project[];
  tasks: Task[];
  /** Every entry on the draft's date, so the bar can show where this one sits
   *  among the others. */
  dayEntries: TimeEntry[];
  workingHours: WorkingHours;
  nowMinutes: number;
  /** The record this sheet is about, so the bar can draw it in the accent. */
  entryId?: string;
  onSave: (data: EntrySaveData) => Promise<unknown>;
  /**
   * Fired once the entry is *completely* saved, just before onClose.
   *
   * Distinct from onSave because the overnight-split path calls onSave twice,
   * one half at a time. A caller that treats a single onSave resolving as
   * "done" would act on a half-saved entry if the second call then failed.
   */
  onSaved?: () => void;
  /** Stop mode: discard the entry that was just saved. Edit mode: delete it.
   *  Both delete immediately and offer undo — see the footer. */
  onDelete?: () => void;
  onClose: () => void;
  onLoadTasksForProject?: (projectId: string) => void;
  onAddTask?: (data: Omit<Task, "id">) => Promise<Task>;
  /** Open a second sheet on the gap this entry left behind. */
  onFillGap?: (startMin: number, endMin: number) => void;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

const TITLE: Record<SheetMode, string> = {
  stop: "Save entry",
  edit: "Edit entry",
  create: "Log time",
};

export const EntrySheet: React.FC<Props> = ({
  mode, title, initial, projects, tasks, dayEntries, workingHours, nowMinutes, entryId,
  onSave, onSaved, onDelete, onClose, onLoadTasksForProject, onAddTask, onFillGap,
}) => {
  const [draft, setDraft] = useState<EntryDraft>(initial);
  const [saving, setSaving] = useState(false);
  // The draft as it was when the sheet opened. A ref, not the `initial` prop:
  // the prop is re-created by the parent on every render, and `draft` is
  // seeded from it exactly once, so this is the only stable pristine copy.
  const pristine = useRef(initial);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  // null = no overnight conflict; 'ask' = choice pending; 'keep' = end is next
  // day; 'split' = save two entries either side of midnight.
  const [overnightMode, setOvernightMode] = useState<"ask" | "keep" | "split" | null>(null);

  // Active tasks only — except the entry's current task, which stays listed
  // even if deactivated so editing an old entry doesn't silently clear it.
  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === draft.projectId && (t.isActive || t.id === draft.taskId)),
    [tasks, draft.projectId, draft.taskId]
  );

  useEffect(() => {
    if (draft.projectId) onLoadTasksForProject?.(draft.projectId);
  }, [draft.projectId, onLoadTasksForProject]);

  // Editing any field that defines the already-saved half's time span
  // invalidates the split bookkeeping below.
  const splitFirstSaved = useRef(false);
  const set = (patch: Partial<EntryDraft>) => {
    if (patch.date !== undefined || patch.startTime !== undefined || patch.endTime !== undefined) {
      splitFirstSaved.current = false;
    }
    setDraft((d) => ({ ...d, ...patch }));
  };

  const isOvernightConflict = !!(
    draft.startTime && draft.endTime && draft.endTime !== "00:00" &&
    timeToMinutes(draft.endTime) < timeToMinutes(draft.startTime)
  );
  useEffect(() => {
    if (isOvernightConflict && overnightMode === null) setOvernightMode("ask");
    if (!isOvernightConflict) setOvernightMode(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOvernightConflict]);

  // An end of 00:00, or a "keep"/"split" choice, means end is the next
  // calendar day. Walk the calendar rather than adding 24h of milliseconds,
  // which is an hour off across a DST transition.
  const endsNextDay = draft.endTime === "00:00" || overnightMode === "keep" || overnightMode === "split";

  // Memoized because the two memos below depend on them: a fresh Date on every
  // render would make every dependent recompute on every keystroke, and the
  // day bar rebuilds a whole day's geometry.
  const startDt = useMemo(
    () => (draft.date && draft.startTime ? new Date(`${draft.date}T${draft.startTime}:00`) : null),
    [draft.date, draft.startTime]
  );
  const endDt = useMemo(
    () => (draft.date && draft.endTime
      ? new Date(`${endsNextDay ? addDaysStr(draft.date, 1) : draft.date}T${draft.endTime}:00`)
      : null),
    [draft.date, draft.endTime, endsNextDay]
  );
  const durationMinutes = startDt && endDt ? Math.round((endDt.getTime() - startDt.getTime()) / 60000) : null;

  /**
   * Only the modes that can edit the time can produce a bad one.
   *
   * A stop sheet opens over a span the clock already decided, and `stopAt`
   * clamps a timer started and stopped inside the same minute to zero — a
   * mis-click away at any time. Gating Save on that left the one sheet whose
   * entry is *already saved* unable to commit a correction to its own
   * description.
   */
  const timeError = mode !== "stop" && durationMinutes !== null && durationMinutes <= 0 && overnightMode !== "ask"
    ? "End time must be after the start time."
    : null;
  const canSave = !!draft.projectId && !!startDt && !!endDt && !timeError && overnightMode !== "ask" && !saving;

  /**
   * The bar shows the day *including* this entry as it currently reads in the
   * form, not as it was stored — so dragging an end time in the Time row moves
   * the accent block while you watch.
   */
  const barEntries = useMemo(() => {
    const others = dayEntries.filter((e) => e.id !== entryId);
    if (!startDt || !endDt || durationMinutes === null || durationMinutes <= 0) return others;
    const preview: TimeEntry = {
      id: entryId ?? "__draft__",
      projectId: draft.projectId,
      taskId: draft.taskId || undefined,
      description: draft.description,
      startTime: startDt.toISOString(),
      endTime: endDt.toISOString(),
      durationMinutes,
      date: draft.date,
      userId: "", userDisplayName: "",
    };
    return [...others, preview];
  }, [dayEntries, entryId, startDt, endDt, durationMinutes, draft.projectId, draft.taskId, draft.description, draft.date]);

  // Today is capped at the current minute so the rest of it isn't offered
  // before it has happened; a past day is fair game to its own end, and
  // reading today's clock onto it would invent an untracked afternoon.
  const isToday = draft.date === localDateStr();
  const dayEnd = isToday ? nowMinutes : MINUTES_PER_DAY;

  /**
   * The one gap worth mentioning: the nearest hole to this entry, preferring
   * the one before it, because the time somebody forgot is almost always the
   * time just before the thing they remembered to track.
   */
  const nudge = useMemo(() => {
    if (!startDt) return null;
    const gaps: Gap[] = findUntrackedGaps({
      entries: barEntries, date: draft.date,
      nowMinutes: dayEnd,
      upperBoundMin: isToday ? nowMinutes : undefined,
      workDayStartMin: workingHours.startMin,
      workDayEndMin: workingHours.endMin,
      gapMustExceedMinutes: workingHours.gapMustExceedMinutes,
    });
    if (gaps.length === 0) return null;
    const startMin = minutesOfDay(startDt.toISOString());
    const before = gaps.filter((g) => g.endMin <= startMin).pop();
    const gap = before ?? gaps[0];
    return { gap, when: gap.endMin <= startMin ? "earlier" : "later" };
  }, [barEntries, draft.date, dayEnd, isToday, nowMinutes, startDt, workingHours]);

  const activeProject = projects.find((p) => p.id === draft.projectId);

  const handleCreateTask = async () => {
    const name = newTaskName.trim();
    if (!name || !draft.projectId || !onAddTask) {
      // An empty field that lost focus is somebody changing their mind, not a
      // task waiting to be named.
      setAddingTask(false);
      setNewTaskName("");
      return;
    }
    // Cleared *before* the await: the field commits on Enter and again on
    // blur, and pressing Enter then clicking away sent the same name twice
    // while the first request was still in flight.
    setAddingTask(false);
    setNewTaskName("");
    try {
      const task = await onAddTask({ projectId: draft.projectId, name, isActive: true });
      set({ taskId: task.id });
    } catch {
      // Toasted upstream. A lost keystroke is recoverable; a duplicate task is
      // a name somebody else will bill against.
    }
  };

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
      if (overnightMode === "split") {
        // Midnight at the end of the start date = 00:00 on the next calendar
        // day, computed on the calendar so it stays exact on DST days.
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
          startTime: startDt.toISOString(), endTime: endDt.toISOString(),
          durationMinutes: durationMinutes!,
        });
      }
      // Both halves are in by here, so this is the only place that can
      // honestly claim the entry was saved.
      onSaved?.();
      onClose();
    } catch {
      // The data hooks already toast the failure; keep the sheet open to retry.
    } finally {
      setSaving(false);
    }
  };

  const headlineDuration = durationMinutes !== null && durationMinutes >= 0
    ? formatMinutes(durationMinutes)
    : "—";
  const dateLabel = new Date(`${draft.date}T00:00:00`).toLocaleDateString(DATE_LOCALE, {
    weekday: "long", day: "numeric", month: "long",
  });

  return (
    <Sheet
      label={title ?? TITLE[mode]}
      onClose={() => { if (!saving) onClose(); }}
      busy={saving}
      keepOnBackdropClick={isDirtyDraft(draft, pristine.current)}
    >
      <div className="t-large-title">{headlineDuration}</div>
      <div className="sheet__meta t-subhead">
        {draft.startTime} – {draft.endTime}{endsNextDay ? " (next day)" : ""} · {dateLabel}
      </div>

      <div className="sheet__section">
        <DayBar
          entries={barEntries}
          projects={projects}
          date={draft.date}
          nowMinutes={dayEnd}
          workingHours={workingHours}
          upperBoundMin={isToday ? nowMinutes : undefined}
          accentEntryId={entryId ?? "__draft__"}
          warnGaps
          small
          showAxis={false}
        />
        <div className="sheet__nudge">
          <span>
            {mode === "stop" ? "This lands here." : "Where this entry sits in the day."}
            {nudge && ` ${formatMinutes(nudge.gap.endMin - nudge.gap.startMin)} ${nudge.when} the same day is still untracked.`}
          </span>
          {nudge && onFillGap && (
            <Pill size="inline" onClick={() => onFillGap(nudge.gap.startMin, nudge.gap.endMin)}>
              Fill it
            </Pill>
          )}
        </div>
      </div>

      <div className="sheet__section field-list">
        <div className="field-row">
          <label className="field-row__label" htmlFor="entry-desc">Description</label>
          <span className="field-row__value">
            <input
              id="entry-desc"
              className="field-row__input"
              placeholder="What did you work on?"
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
              maxLength={500}
              autoFocus
              data-autofocus
            />
          </span>
        </div>

        <div className="field-row">
          <label className="field-row__label" htmlFor="entry-project">Project</label>
          <span className="field-row__value">
            <select
              id="entry-project"
              className="field-row__select"
              value={draft.projectId}
              onChange={(e) => set({ projectId: e.target.value, taskId: "" })}
            >
              <option value="">Select project…</option>
              {/* Active projects only — plus this entry's own project if it has
                  since been archived, so editing an old entry can't clear it. */}
              {projects.filter((p) => p.isActive || p.id === draft.projectId).map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.isActive ? "" : " (archived)"}</option>
              ))}
            </select>
          </span>
        </div>

        <div className="field-row">
          <label className="field-row__label" htmlFor="entry-task">Task</label>
          <span className="field-row__value">
            {addingTask ? (
              <input
                className="field-row__input"
                placeholder="New task name"
                aria-label="New task name"
                value={newTaskName}
                onChange={(e) => setNewTaskName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleCreateTask(); }
                  if (e.key === "Escape") { setAddingTask(false); setNewTaskName(""); }
                }}
                onBlur={handleCreateTask}
                autoFocus
              />
            ) : (
              <>
                {/* Naming work before doing it produces bad names, so task
                    creation lives here — at the point the work is over and the
                    person knows what it was. */}
                {onAddTask && draft.projectId && (
                  <button type="button" className="field-row__action is-inline" onClick={() => setAddingTask(true)}>
                    New task…
                  </button>
                )}
                <select
                  id="entry-task"
                  className="field-row__select"
                  value={draft.taskId}
                  onChange={(e) => set({ taskId: e.target.value })}
                  disabled={!draft.projectId}
                >
                  <option value="">No task</option>
                  {projectTasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </>
            )}
          </span>
        </div>

        {mode !== "stop" && (
          <div className="field-row">
            <label className="field-row__label" htmlFor="entry-start">Time</label>
            <span className="field-row__value">
              <input
                id="entry-start" type="time" className="input input--time"
                value={draft.startTime} onChange={(e) => set({ startTime: e.target.value })}
              />
              <span className="field-row__sep">to</span>
              <input
                type="time" className="input input--time" aria-label="End time"
                value={draft.endTime} onChange={(e) => set({ endTime: e.target.value })}
              />
            </span>
          </div>
        )}

        <div className="field-row">
          <label className="field-row__label" htmlFor="entry-ratio">Billed to</label>
          <span className="field-row__value">
            <input
              id="entry-ratio"
              className="field-row__input"
              type="number" step="1" min="0"
              style={{ maxWidth: 110 }}
              placeholder="Account"
              /* A billing account identifier, never a multiplier — nothing in
                 the app may do arithmetic with it (#71). */
              aria-label="Billing account this entry's time is billed to"
              value={draft.ratio}
              onChange={(e) => set({ ratio: e.target.value })}
            />
            <span className="field-row__sep" aria-hidden="true">·</span>
            <input
              className="field-row__input"
              style={{ maxWidth: 140 }}
              placeholder="Ticket"
              aria-label="Ticket reference"
              value={draft.jiraTicket}
              onChange={(e) => set({ jiraTicket: e.target.value })}
              maxLength={50}
            />
          </span>
        </div>
      </div>

      {activeProject && (
        <p className="sheet__note">
          Inherited from {activeProject.name}. Changing it here affects this entry only.
        </p>
      )}

      {timeError && <p className="form-error" role="alert">{timeError}</p>}
      {overnightMode === "ask" && (
        <p className="sheet__note" role="alert">
          This ends before it starts. Did you work past midnight?{" "}
          <button type="button" className="field-row__action is-inline" onClick={() => setOvernightMode("split")}>Split at midnight</button>
          {" · "}
          <button type="button" className="field-row__action is-inline" onClick={() => setOvernightMode("keep")}>Keep as one entry</button>
        </p>
      )}
      {overnightMode === "split" && (
        <p className="sheet__note">
          Saves two entries: {draft.startTime}–00:00, then 00:00–{draft.endTime} on the next day.
        </p>
      )}

      <div className="sheet__foot">
        {/* No confirmation dialog on delete — it deletes and offers undo.
            Confirming twice for something reversible is the pattern this app
            is done with. */}
        {onDelete && (
          <Pill tone={mode === "stop" ? "quiet" : "danger"} onClick={() => { if (!saving) onDelete(); }} disabled={saving}>
            {mode === "stop" ? "Discard" : "Delete"}
          </Pill>
        )}
        <div className="sheet__foot-right">
          {mode !== "stop" && <Pill tone="quiet" onClick={onClose} disabled={saving}>Cancel</Pill>}
          <Pill tone="primary" onClick={handleSave} disabled={!canSave}>
            {saving ? "Saving…" : "Save"}
          </Pill>
        </div>
      </div>
    </Sheet>
  );
};

/** A draft for a span the user selected on a bar or the calendar grid. */
export function draftForSpan(date: string, startMin: number, endMin: number, projectId = ""): EntryDraft {
  return {
    date,
    startTime: clockAt(startMin),
    endTime: clockAt(endMin),
    description: "",
    projectId,
    taskId: "",
    jiraTicket: "",
    ratio: "",
  };
}

/** A draft for an entry that already exists. */
export function draftForEntry(entry: TimeEntry): EntryDraft {
  const end = entry.endTime ?? isoAtMinutes(entry.date, minutesOfDay(entry.startTime));
  return {
    date: entry.date,
    startTime: clockAt(minutesOfDay(entry.startTime)),
    endTime: clockAt(minutesOfDay(end)),
    description: entry.description ?? "",
    projectId: entry.projectId,
    taskId: entry.taskId ?? "",
    jiraTicket: entry.jiraTicket ?? "",
    ratio: entry.ratio !== undefined ? String(entry.ratio) : "",
  };
}
