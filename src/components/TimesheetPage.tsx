import React, { useEffect, useMemo, useState } from "react";
import type { TimeEntry, Project, Task } from "../types";
import { formatMinutes } from "../hooks";
import { useDataRange } from "../contexts/DataRangeContext";
import { useWeeklyTarget } from "../hooks/useWeeklyTarget";
import { getCurrentUser } from "../services/userService";
import { friendlyDate, localDateStr, toTimeInput, weekStartStr } from "../utils/dates";
import { EntryModal, EntryDraft, EntrySaveData } from "./EntryModal";
import { IconClock, IconPencil, IconPlay, IconPlus, IconSearch, IconX } from "./Icons";
import {
  DateRangeFilter,
  DateRangeState,
  resolveDateRange,
} from "./DateRangeFilter";

interface Props {
  entries: TimeEntry[];
  projects: Project[];
  tasks: Task[];
  timerBusy?: boolean;
  onDelete: (id: string) => void;
  onEdit: (id: string, data: Partial<TimeEntry>) => Promise<TimeEntry>;
  onCreate: (data: Omit<TimeEntry, "id">) => Promise<TimeEntry>;
  onContinue?: (entry: TimeEntry) => void;
  onLoadTasksForProject?: (projectId: string) => void;
}

const TIMESHEET_PRESETS = ["7d", "30d", "90d", "thisMonth"] as const;
const INITIAL_VISIBLE_DAYS = 30;

interface ModalState {
  editingId: string | null; // null = create
  draft: EntryDraft;
}

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

/** Default draft for a new manual entry: the last full hour. Between 00:00
 *  and 00:59 that hour is yesterday 23:00–00:00 (midnight-end = next-day
 *  midnight, which EntryModal understands). */
function newEntryDraft(): EntryDraft {
  const now = new Date();
  const isPastMidnight = now.getHours() === 0;
  const date = isPastMidnight ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now;
  const startHour = isPastMidnight ? 23 : now.getHours() - 1;
  return {
    date: localDateStr(date),
    startTime: `${String(startHour).padStart(2, "0")}:00`,
    endTime: `${String(now.getHours()).padStart(2, "0")}:00`,
    description: "",
    projectId: "",
    taskId: "",
    jiraTicket: "",
    ratio: "",
  };
}

export const TimesheetPage: React.FC<Props> = ({
  entries, projects, tasks, timerBusy, onDelete, onEdit, onCreate, onContinue, onLoadTasksForProject,
}) => {
  const { ensureRangeLoaded } = useDataRange();
  const { targetHours } = useWeeklyTarget();
  const [modal, setModal] = useState<ModalState | null>(null);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [visibleDays, setVisibleDays] = useState(INITIAL_VISIBLE_DAYS);
  const [rangeState, setRangeState] = useState<DateRangeState>({
    preset: "30d",
    customFrom: "",
    customTo: "",
  });

  const { from, to } = useMemo(() => resolveDateRange(rangeState), [rangeState]);

  // Reset visible days when the filter/range changes so "Load more" state doesn't carry over.
  useEffect(() => { setVisibleDays(INITIAL_VISIBLE_DAYS); }, [from, to, search, projectFilter]);

  useEffect(() => {
    ensureRangeLoaded(from, to);
  }, [from, to, ensureRangeLoaded]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (e.date < from || e.date > to) return false;
      if (projectFilter && e.projectId !== projectFilter) return false;
      if (!q) return true;
      const project = projects.find((p) => p.id === e.projectId);
      const task = tasks.find((t) => t.id === e.taskId);
      return [e.description, project?.name, task?.name, e.jiraTicket]
        .some((s) => s?.toLowerCase().includes(q));
    });
  }, [entries, from, to, search, projectFilter, projects, tasks]);

  const grouped = useMemo(() => groupByDate(filteredEntries), [filteredEntries]);
  const sortedDates = useMemo(
    () => [...grouped.keys()].sort((a, b) => b.localeCompare(a)),
    [grouped]
  );
  const visibleDates = useMemo(() => sortedDates.slice(0, visibleDays), [sortedDates, visibleDays]);
  const hasMore = sortedDates.length > visibleDays;

  const totalMinutes = useMemo(
    () => filteredEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0),
    [filteredEntries]
  );

  // Current calendar week (Mon–Sun) total across ALL entries — independent of
  // the page's search/range filters — for the weekly-target chip.
  const thisWeekMinutes = useMemo(() => {
    const weekFrom = weekStartStr(localDateStr());
    return entries.reduce(
      (s, e) => (e.date >= weekFrom ? s + (e.durationMinutes || 0) : s),
      0
    );
  }, [entries]);

  const openNew = () => setModal({ editingId: null, draft: newEntryDraft() });

  const openEdit = (entry: TimeEntry) => {
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
      await onCreate({ ...data, userId: user.id, userDisplayName: user.displayName });
    }
  };

  const hasActiveFilter = search.trim() !== "" || projectFilter !== "";

  return (
    <div className="timesheet">
      <div className="reports__header">
        <h2 className="timesheet__title">Timesheet</h2>
        <DateRangeFilter
          presets={[...TIMESHEET_PRESETS]}
          value={rangeState}
          onChange={setRangeState}
          info={
            rangeState.preset === "custom" && rangeState.customFrom && rangeState.customTo
              ? `${filteredEntries.length} entries · ${formatMinutes(totalMinutes)} total`
              : undefined
          }
          rightSlot={
            <button className="btn-primary btn-icon" onClick={openNew}>
              <IconPlus /> Add entry
            </button>
          }
        />
      </div>

      <div className="timesheet__toolbar">
        <div className="search-box">
          <IconSearch className="search-box__icon" />
          <input
            className="search-box__input"
            placeholder="Search description, project, task, ticket…"
            aria-label="Search entries by description, project, task, or ticket"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-box__clear" onClick={() => setSearch("")} aria-label="Clear search">
              <IconX size={13} />
            </button>
          )}
        </div>
        <select
          className="timesheet__project-filter"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          aria-label="Filter by project"
        >
          <option value="">All projects</option>
          {/* Archived projects stay filterable — this dropdown scopes history. */}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}{p.isActive ? "" : " (archived)"}</option>
          ))}
        </select>
        <span className="timesheet__toolbar-total">{formatMinutes(totalMinutes)} total</span>
        {targetHours > 0 && (
          <span
            className="week-target-chip"
            title={`Logged this week (Mon–Sun) vs your ${targetHours}h target`}
          >
            <span className="week-target-chip__label">
              Week: {formatMinutes(thisWeekMinutes)} / {targetHours}h
            </span>
            <span className="week-target-chip__track">
              <span
                className={`week-target-chip__fill ${thisWeekMinutes >= targetHours * 60 ? "week-target-chip__fill--met" : ""}`}
                style={{ width: `${Math.min(100, (thisWeekMinutes / (targetHours * 60)) * 100)}%` }}
              />
            </span>
          </span>
        )}
      </div>

      {modal && (
        <EntryModal
          title={modal.editingId ? "Edit Entry" : "Add Entry"}
          initial={modal.draft}
          projects={projects}
          tasks={tasks}
          onSave={handleModalSave}
          onDelete={modal.editingId ? () => { onDelete(modal.editingId!); setModal(null); } : undefined}
          onClose={() => setModal(null)}
          onLoadTasksForProject={onLoadTasksForProject}
        />
      )}

      {filteredEntries.length === 0 ? (
        <div className="timesheet__empty">
          <IconClock size={44} className="timesheet__empty-icon" />
          <p>
            {entries.length === 0
              ? "No time entries yet. Start the timer or add one manually."
              : hasActiveFilter
                ? "Nothing matches these filters."
                : "No entries in this range. Pick a wider window above."}
          </p>
          {entries.length === 0 && (
            <button className="btn-primary btn-icon" onClick={openNew}>
              <IconPlus /> Add your first entry
            </button>
          )}
        </div>
      ) : (
        <>
        {visibleDates.map((date) => {
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
                            {entry.jiraTicket && (
                              <span className="badge badge--task">{entry.jiraTicket}</span>
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
                              : <span className="entry-row__running">Running…</span>
                            }
                          </span>
                        </div>
                      </div>
                      {/* Running sessions are owned by the timer bar — only
                          completed entries can be edited or deleted here.
                          (Deleting the running draft row would strand the
                          timer's stop in a 404-retry loop.) */}
                      {entry.endTime && (
                        <>
                          {onContinue && (
                            <button
                              className="entry-row__continue"
                              onClick={() => onContinue(entry)}
                              disabled={timerBusy || !project?.isActive}
                              title={
                                timerBusy ? "Timer already running"
                                  : !project?.isActive ? "Project is archived"
                                  : "Continue — start the timer with this entry's project, task and description"
                              }
                              aria-label={`Continue working on ${entry.description || project?.name || "this entry"}`}
                            >
                              <IconPlay size={12} /> Continue
                            </button>
                          )}
                          <button
                            className="entry-row__edit"
                            onClick={() => openEdit(entry)}
                            title="Edit entry"
                            aria-label="Edit entry"
                          >
                            <IconPencil />
                          </button>
                          <button
                            className="entry-row__delete"
                            onClick={() => onDelete(entry.id)}
                            title="Delete entry"
                            aria-label="Delete entry"
                          >
                            <IconX />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {hasMore && (
          <div className="timesheet__load-more">
            <button
              className="btn-ghost"
              onClick={() => setVisibleDays((n) => n + INITIAL_VISIBLE_DAYS)}
            >
              Load more ({sortedDates.length - visibleDays} more {sortedDates.length - visibleDays === 1 ? "day" : "days"})
            </button>
          </div>
        )}
        </>
      )}
    </div>
  );
};
