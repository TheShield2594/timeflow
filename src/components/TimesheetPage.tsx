import React, { useEffect, useMemo, useState } from "react";
import type { TimeEntry } from "../types";
import { formatMinutes } from "../hooks";
import { useData } from "../contexts/DataContext";
import { useRangeRequest } from "../contexts/DataRangeContext";
import { useToday } from "../hooks/useToday";
import type { WorkingHours } from "../hooks/useWorkingHours";
import { MINUTES_PER_DAY, addDaysStr, clockAt, friendlyDate, minutesOfDay } from "../utils/dates";
import { byId, indexById } from "../utils/entityIndex";
import { findUntrackedGaps, type Gap } from "../utils/gaps";
import { RANGE_LABEL, resolveRange, type RangePreset, type RangeState } from "../utils/ranges";
import { buildExportFilename, exportToCSV } from "../services/csvExport";
import { EntrySheet, draftForEntry, draftForSpan, type EntryDraft } from "./EntrySheet";
import { ListCard, ListRow } from "./ListCard";
import { SegmentedControl } from "./SegmentedControl";
import { FloatingActionBar } from "./FloatingActionBar";
import { Pill } from "./Pill";

const PRESETS: RangePreset[] = ["thisWeek", "lastWeek", "month", "custom"];
const INITIAL_VISIBLE_DAYS = 30;

interface Props {
  workingHours: WorkingHours;
  /** Navigate to Projects — the first-run move when nothing exists yet. */
  onGoToProjects?: () => void;
}

interface SheetState {
  mode: "create" | "edit";
  draft: EntryDraft;
  id?: string;
}

/** One line of a day group: something that was tracked, or something that
 *  wasn't. Both are things the day is telling you. */
type Row =
  | { kind: "entry"; at: number; entry: TimeEntry }
  | { kind: "gap"; at: number; gap: Gap };

/**
 * The list, grouped by day.
 *
 * The one structural change from the old timesheet: an untracked gap is a
 * *row inside the day it belongs to*, not a badge somewhere else. A day with
 * a hole in it should read as a day with a hole in it, in the same column and
 * at the same weight as the work either side.
 */
export const TimesheetPage: React.FC<Props> = ({ workingHours, onGoToProjects }) => {
  const { entries, projects, tasks, deleteEntry, editEntry, createEntry, loadTasksForProject, addTask } = useData();
  const today = useToday();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [search, setSearch] = useState("");
  const [visibleDays, setVisibleDays] = useState(INITIAL_VISIBLE_DAYS);
  const [range, setRange] = useState<RangeState>({ preset: "thisWeek", customFrom: "", customTo: "" });

  const { from, to } = useMemo(() => resolveRange(range, today), [range, today]);
  useRangeRequest("timesheet", from, to);

  const projectById = useMemo(() => indexById(projects), [projects]);
  const taskById = useMemo(() => indexById(tasks), [tasks]);
  const nowMinutes = minutesOfDay(new Date().toISOString());

  useEffect(() => { setVisibleDays(INITIAL_VISIBLE_DAYS); }, [from, to, search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (e.date < from || e.date > to) return false;
      if (!q) return true;
      const project = projectById.get(e.projectId);
      const task = byId(taskById, e.taskId);
      return [e.description, project?.name, task?.name, e.jiraTicket].some((s) => s?.toLowerCase().includes(q));
    });
  }, [entries, from, to, search, projectById, taskById]);

  const totalMinutes = filtered.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);

  const days = useMemo(() => {
    const byDate = new Map<string, TimeEntry[]>();
    for (const entry of filtered) {
      if (!byDate.has(entry.date)) byDate.set(entry.date, []);
      byDate.get(entry.date)!.push(entry);
    }
    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, dayEntries]) => {
        // A search narrows what is *shown*, but a gap is a fact about the
        // whole day — computing it from the filtered rows would invent holes
        // wherever the search hid an entry, so a search suppresses them
        // entirely rather than reporting the wrong ones.
        const gaps: Gap[] = search.trim() === "" && date <= today
          ? findUntrackedGaps({
              entries: entries.filter((e) => e.date === date),
              date,
              nowMinutes: date === today ? nowMinutes : MINUTES_PER_DAY,
              upperBoundMin: date === today ? nowMinutes : undefined,
              workDayStartMin: workingHours.startMin,
              workDayEndMin: workingHours.endMin,
              gapMustExceedMinutes: workingHours.gapMustExceedMinutes,
            })
          : [];
        // Entries and gaps in one list, newest first. A gap collected into a
        // block at the foot of the day would read as a footnote about the day;
        // sitting between the two entries it separates, it reads as what it
        // is — the part of the afternoon nobody accounted for.
        const rows: Row[] = [
          ...dayEntries.map((entry) => ({
            kind: "entry" as const, at: minutesOfDay(entry.startTime), entry,
          })),
          ...gaps.map((gap) => ({ kind: "gap" as const, at: gap.startMin, gap })),
        ].sort((a, b) => b.at - a.at);

        return {
          date,
          rows,
          total: dayEntries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0),
        };
      });
  }, [filtered, entries, search, today, nowMinutes, workingHours]);

  const visible = days.slice(0, visibleDays);
  const hidden = days.length - visible.length;

  const subtitleFor = (entry: TimeEntry): string => {
    const project = projectById.get(entry.projectId)?.name ?? "Unassigned";
    const task = byId(taskById, entry.taskId)?.name;
    const ticket = entry.jiraTicket;
    return [project, task, ticket].filter(Boolean).join(" · ");
  };

  const lastEntry = useMemo(
    () => [...entries].sort((a, b) => b.startTime.localeCompare(a.startTime))[0],
    [entries]
  );

  const handleExport = () => exportToCSV(filtered, projects, tasks, buildExportFilename(from, to));

  return (
    <>
      <div className="page__head">
        <h1 className="page__title t-large-title">Timesheet</h1>
        <span className="t-subhead t-secondary">
          {formatMinutes(totalMinutes)} in {RANGE_LABEL[range.preset].toLowerCase()}
        </span>
      </div>

      <div className="page__toolbar">
        <SegmentedControl
          ariaLabel="Date range"
          value={range.preset}
          onChange={(preset) => setRange((r) => ({ ...r, preset }))}
          options={PRESETS.map((preset) => ({ value: preset, label: RANGE_LABEL[preset] }))}
        />
        {range.preset === "custom" && (
          <>
            <input
              className="input" type="date" aria-label="From"
              value={range.customFrom} onChange={(e) => setRange((r) => ({ ...r, customFrom: e.target.value }))}
            />
            <input
              className="input" type="date" aria-label="To"
              value={range.customTo} onChange={(e) => setRange((r) => ({ ...r, customTo: e.target.value }))}
            />
          </>
        )}
        <div className="page__toolbar-right">
          <input
            className="search"
            placeholder="Search descriptions, tasks, tickets"
            aria-label="Search descriptions, tasks and tickets"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {days.length === 0 ? (
        <div className="empty">
          <div className="empty__title t-title2">
            {projects.length === 0 ? "Time is tracked against a project" : "Nothing logged in this range"}
          </div>
          <p className="empty__body t-body">
            {projects.length === 0
              ? "Make one for the work you do most. You can rename it later, and archiving keeps its history."
              : lastEntry
                ? `Your last entry was ${friendlyDate(lastEntry.date)}. Widen the range, or log time you have already spent.`
                : "Nothing has been logged yet. Start the timer, or log time you have already spent."}
          </p>
          {projects.length === 0 ? (
            <button type="button" className="empty__action" onClick={onGoToProjects}>Create a project</button>
          ) : (
            <button
              type="button"
              className="empty__action"
              onClick={() => setSheet({ mode: "create", draft: defaultDraft(today, workingHours) })}
            >
              Log past time
            </button>
          )}
        </div>
      ) : (
        <>
          {visible.map((day) => (
            <div key={day.date} className="timesheet__group">
              <div className="timesheet__group-head">
                <span className="timesheet__group-day t-group-label">{friendlyDate(day.date)}</span>
                <span className="timesheet__group-total">{formatMinutes(day.total)}</span>
              </div>
              <ListCard>
                {day.rows.map((row) => {
                  if (row.kind === "gap") {
                    const { gap } = row;
                    return (
                      <div key={`gap-${gap.startMin}`} className="list-gap-row">
                        <span className="gap-mark" />
                        <span className="timesheet__gap-text">
                          {formatMinutes(gap.endMin - gap.startMin)} untracked · {clockAt(gap.startMin)} – {clockAt(gap.endMin)}
                        </span>
                        <Pill
                          size="tiny"
                          onClick={() => setSheet({ mode: "create", draft: draftForSpan(day.date, gap.startMin, gap.endMin) })}
                        >
                          Fill it
                        </Pill>
                      </div>
                    );
                  }
                  const { entry } = row;
                  const running = !entry.endTime;
                  return (
                    <ListRow
                      key={entry.id}
                      color={projectById.get(entry.projectId)?.color}
                      title={
                        <>
                          {entry.description || subtitleFor(entry)}
                          {running && <span className="chip" style={{ marginLeft: 10 }}>Running</span>}
                        </>
                      }
                      subtitle={entry.description ? subtitleFor(entry) : undefined}
                      value={running
                        ? formatMinutes(Math.max(0, nowMinutes - minutesOfDay(entry.startTime)))
                        : formatMinutes(entry.durationMinutes ?? 0)}
                      valueAccent={running}
                      meta={running
                        ? `from ${clockAt(minutesOfDay(entry.startTime))}`
                        : `${clockAt(minutesOfDay(entry.startTime))} – ${clockAt(minutesOfDay(entry.endTime!))}`}
                      onClick={running ? undefined : () => setSheet({ mode: "edit", draft: draftForEntry(entry), id: entry.id })}
                      ariaLabel={`Edit ${entry.description || subtitleFor(entry)}`}
                    />
                  );
                })}
              </ListCard>
            </div>
          ))}
          {hidden > 0 && (
            <button type="button" className="projects__more" onClick={() => setVisibleDays((n) => n + INITIAL_VISIBLE_DAYS)}>
              Show {hidden} more {hidden === 1 ? "day" : "days"}
            </button>
          )}
        </>
      )}

      <FloatingActionBar hint={`Export the visible range as CSV — ${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}.`}>
        <div style={{ display: "flex", gap: 12 }}>
          <Pill onClick={handleExport} disabled={filtered.length === 0}>Export CSV</Pill>
          <Pill tone="primary" onClick={() => setSheet({ mode: "create", draft: defaultDraft(today, workingHours) })}>
            Log time
          </Pill>
        </div>
      </FloatingActionBar>

      {sheet && (
        <EntrySheet
          mode={sheet.mode}
          initial={sheet.draft}
          entryId={sheet.id}
          projects={projects}
          tasks={tasks}
          dayEntries={entries.filter((e) => e.date === sheet.draft.date)}
          workingHours={workingHours}
          nowMinutes={nowMinutes}
          onSave={(data) => (sheet.id ? editEntry(sheet.id, data) : createEntry(data))}
          onDelete={sheet.id ? () => { deleteEntry(sheet.id!); setSheet(null); } : undefined}
          onClose={() => setSheet(null)}
          onLoadTasksForProject={loadTasksForProject}
          onAddTask={addTask}
          onFillGap={(startMin, endMin) =>
            setSheet({ mode: "create", draft: draftForSpan(sheet.draft.date, startMin, endMin) })}
        />
      )}
    </>
  );
};

/** A new manual entry defaults to the last full hour inside working hours —
 *  the span somebody is most often catching up on. */
function defaultDraft(today: string, workingHours: WorkingHours): EntryDraft {
  const now = minutesOfDay(new Date().toISOString());
  const end = Math.min(workingHours.endMin, Math.max(workingHours.startMin + 60, Math.floor(now / 60) * 60));
  const start = Math.max(workingHours.startMin, end - 60);
  // Before the working day has started there is no "last hour" today; offer
  // yesterday's last hour rather than a zero-length span.
  if (end <= start) return draftForSpan(addDaysStr(today, -1), workingHours.endMin - 60, workingHours.endMin);
  return draftForSpan(today, start, end);
}
