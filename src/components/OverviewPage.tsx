import React, { useCallback, useMemo, useState } from "react";
import type { NewTimeEntry, Project, Task, TimeEntry } from "../types";
import { formatMinutes } from "../hooks";
import { useRangeRequest } from "../contexts/DataRangeContext";
import { useToday } from "../hooks/useToday";
import { useWeeklyTarget } from "../hooks/useWeeklyTarget";
import { addDaysStr, weekStartStr } from "../utils/dates";
import { byId, indexById } from "../utils/entityIndex";
import { EntryRow } from "./EntryRow";
import { ActivityHeatmap } from "./ActivityHeatmap";
import { TodayStrip } from "./TodayStrip";
import { TargetRing } from "./TargetRing";
import { EntryModal, EntryDraft, EntrySaveData } from "./EntryModal";
import { IconClock, IconFlame, IconPlay, IconPlus } from "./Icons";

interface Props {
  entries: TimeEntry[];
  projects: Project[];
  tasks: Task[];
  timerBusy?: boolean;
  onContinue?: (entry: TimeEntry) => void;
  onCreate?: (data: NewTimeEntry) => Promise<TimeEntry>;
  onLoadTasksForProject?: (projectId: string) => void;
  onGoToProjects?: () => void;
}

const HEATMAP_WEEKS = 12;
const RECENT_COUNT = 5;
const QUICK_START_COUNT = 3;

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export const OverviewPage: React.FC<Props> = ({
  entries, projects, tasks, timerBusy, onContinue, onCreate, onLoadTasksForProject, onGoToProjects,
}) => {
  const { targetHours, setTargetHours } = useWeeklyTarget();
  const today = useToday();
  const [gapDraft, setGapDraft] = useState<EntryDraft | null>(null);

  const projectById = useMemo(() => indexById(projects), [projects]);
  const taskById = useMemo(() => indexById(tasks), [tasks]);

  // The heatmap looks back HEATMAP_WEEKS weeks — make sure that window is
  // actually loaded rather than assuming it fits inside whatever range
  // another page last requested.
  const heatmapStart = useMemo(
    () => addDaysStr(weekStartStr(today), -(HEATMAP_WEEKS - 1) * 7),
    [today]
  );
  useRangeRequest("overview", heatmapStart, today);

  const minutesByDate = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((e) => map.set(e.date, (map.get(e.date) || 0) + (e.durationMinutes || 0)));
    return map;
  }, [entries]);

  const todayMinutes = minutesByDate.get(today) || 0;
  const todayEntries = useMemo(() => entries.filter((e) => e.date === today), [entries, today]);
  // One read of the clock per render, so a running block's end can't land on
  // a different minute than the axis it's drawn against.
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Most recent day on or before today that carries time. "0m today" next to a
  // populated heatmap reads as though the page failed to load its own data —
  // naming the last day with time on it says the same thing without the
  // ambiguity. Future-dated entries are skipped: they aren't "last logged".
  const lastLoggedDate = useMemo(() => {
    if (todayMinutes > 0) return null;
    let latest: string | null = null;
    minutesByDate.forEach((minutes, date) => {
      if (minutes > 0 && date <= today && (latest === null || date > latest)) latest = date;
    });
    return latest;
  }, [minutesByDate, today, todayMinutes]);

  const weekStart = useMemo(() => weekStartStr(today), [today]);
  const weekEnd = useMemo(() => addDaysStr(weekStart, 6), [weekStart]);
  const weekMinutes = useMemo(
    () => entries.reduce(
      (s, e) => (e.date >= weekStart && e.date <= weekEnd ? s + (e.durationMinutes || 0) : s),
      0
    ),
    [entries, weekStart, weekEnd]
  );

  // Consecutive days with logged time, walking back from today — today
  // itself doesn't break the streak while it's still in progress.
  const streakDays = useMemo(() => {
    let cursor = todayMinutes > 0 ? today : addDaysStr(today, -1);
    let streak = 0;
    while ((minutesByDate.get(cursor) || 0) > 0) {
      streak += 1;
      cursor = addDaysStr(cursor, -1);
    }
    return streak;
  }, [minutesByDate, today, todayMinutes]);

  const recentEntries = useMemo(
    () => [...entries].sort((a, b) => b.startTime.localeCompare(a.startTime)).slice(0, RECENT_COUNT),
    [entries]
  );

  // Quick starts: the most recent distinct piece of work, so the common case
  // ("same thing as yesterday") is one click instead of three pickers.
  const quickStarts = useMemo(() => {
    const seen = new Set<string>();
    const picks: TimeEntry[] = [];
    for (const entry of [...entries].sort((a, b) => b.startTime.localeCompare(a.startTime))) {
      if (!entry.endTime) continue;
      const project = projectById.get(entry.projectId);
      if (!project?.isActive) continue;
      const key = `${entry.projectId}|${entry.taskId ?? ""}|${entry.description ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push(entry);
      if (picks.length === QUICK_START_COUNT) break;
    }
    return picks;
  }, [entries, projectById]);

  const handleLogGap = useCallback((startMinutes: number, endMinutes: number) => {
    setGapDraft({
      date: today,
      startTime: hhmm(startMinutes),
      endTime: hhmm(endMinutes),
      description: "",
      // Prefill the project only when there's no ambiguity to resolve.
      projectId: projects.filter((p) => p.isActive).length === 1
        ? projects.find((p) => p.isActive)!.id
        : "",
      taskId: "",
      jiraTicket: "",
      ratio: "",
    });
  }, [today, projects]);

  const handleSaveGap = useCallback(async (data: EntrySaveData) => {
    if (!onCreate) return;
    await onCreate(data);
  }, [onCreate]);

  if (entries.length === 0) {
    return (
      <div className="overview">
        <div className="reports__header">
          <h2 className="overview__title">Overview</h2>
        </div>
        <div className="timesheet__empty">
          <IconClock size={44} className="timesheet__empty-icon" />
          <p>
            {projects.length === 0
              ? "Welcome! Create your first project, then track time against it."
              : "No time logged yet. Start the timer to see your week here."}
          </p>
          {projects.length === 0 && onGoToProjects && (
            <button type="button" className="btn-primary btn-icon" onClick={onGoToProjects}>
              <IconPlus /> Create a project
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="overview">
      <div className="reports__header">
        <h2 className="overview__title">Overview</h2>
      </div>

      <div className="overview__today">
        <TodayStrip
          entries={todayEntries}
          projects={projects}
          date={today}
          nowMinutes={nowMinutes}
          onLogGap={handleLogGap}
        />
        <TargetRing weekMinutes={weekMinutes} targetHours={targetHours} onSetTarget={setTargetHours} />
      </div>

      <div className="reports__kpis">
        <div className="kpi-card">
          <div className="kpi-card__label">Today</div>
          <div className="kpi-card__value num-kpi">{todayMinutes > 0 ? formatMinutes(todayMinutes) : "—"}</div>
          {lastLoggedDate && (
            <div className="kpi-card__note">
              Last logged {new Date(lastLoggedDate + "T00:00:00").toLocaleDateString("en", {
                weekday: "short", month: "short", day: "numeric",
              })}
            </div>
          )}
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">This week</div>
          <div className="kpi-card__value num-kpi">
            {formatMinutes(weekMinutes)}
            {targetHours > 0 && <span className="kpi-card__target"> / {targetHours}h</span>}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Day streak</div>
          <div className="kpi-card__value num-kpi">
            {streakDays > 0
              ? <><IconFlame size={17} className="kpi-card__flame" />{streakDays}</>
              : "—"}
          </div>
        </div>
      </div>

      <div className="reports__grid">
        <div className="report-card report-card--wide">
          <h3 className="report-card__title">Pick up where you left off</h3>
          {quickStarts.length === 0 ? (
            <p className="report-card__empty">Nothing to resume — every recent entry’s project is archived.</p>
          ) : (
            <div className="quick-starts">
              {quickStarts.map((entry) => {
                const project = projectById.get(entry.projectId);
                const task = byId(taskById, entry.taskId);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className="quick-start"
                    style={{ "--pc": project?.color } as React.CSSProperties}
                    onClick={() => onContinue?.(entry)}
                    disabled={timerBusy || !onContinue}
                    title={timerBusy ? "Timer already running" : "Start the timer on this work"}
                  >
                    <span className="quick-start__dot" aria-hidden="true" />
                    <span className="quick-start__text">
                      <span className="quick-start__desc">
                        {entry.description || task?.name || project?.name || "Untitled"}
                      </span>
                      <span className="quick-start__meta">
                        {project?.name}{task ? ` ▸ ${task.name}` : ""}
                      </span>
                    </span>
                    <IconPlay size={12} className="quick-start__icon" />
                  </button>
                );
              })}
            </div>
          )}
          {recentEntries.length > 0 && (
            <div className="timesheet__entries quick-starts__recent">
              {recentEntries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  project={projectById.get(entry.projectId)}
                  task={byId(taskById, entry.taskId)}
                  timerBusy={timerBusy}
                  onContinue={onContinue}
                />
              ))}
            </div>
          )}
        </div>

        <div className="report-card report-card--wide">
          <h3 className="report-card__title">Activity</h3>
          <ActivityHeatmap entries={entries} weeks={HEATMAP_WEEKS} />
        </div>
      </div>

      {gapDraft && onCreate && (
        <EntryModal
          title="Log untracked time"
          initial={gapDraft}
          projects={projects}
          tasks={tasks}
          onSave={handleSaveGap}
          onClose={() => setGapDraft(null)}
          onLoadTasksForProject={onLoadTasksForProject}
        />
      )}
    </div>
  );
};
