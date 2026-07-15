import React, { useEffect, useMemo } from "react";
import type { TimeEntry, Project, Task } from "../types";
import { formatMinutes } from "../hooks";
import { useDataRange } from "../contexts/DataRangeContext";
import { useWeeklyTarget } from "../hooks/useWeeklyTarget";
import { addDaysStr, localDateStr, weekStartStr } from "../utils/dates";
import { EntryRow } from "./EntryRow";
import { ActivityHeatmap } from "./ActivityHeatmap";
import { SvgBarChart } from "./SvgBarChart";
import { IconClock, IconFlame, IconPlus } from "./Icons";

interface Props {
  entries: TimeEntry[];
  projects: Project[];
  tasks: Task[];
  timerBusy?: boolean;
  onContinue?: (entry: TimeEntry) => void;
  onGoToProjects?: () => void;
}

const HEATMAP_WEEKS = 12;
const RECENT_COUNT = 5;

export const OverviewPage: React.FC<Props> = ({ entries, projects, tasks, timerBusy, onContinue, onGoToProjects }) => {
  const { ensureRangeLoaded } = useDataRange();
  const { targetHours } = useWeeklyTarget();
  const today = localDateStr();

  // The heatmap looks back HEATMAP_WEEKS weeks — make sure that window is
  // actually loaded rather than assuming it fits inside whatever range
  // another page last requested.
  useEffect(() => {
    const heatmapStart = addDaysStr(weekStartStr(today), -(HEATMAP_WEEKS - 1) * 7);
    ensureRangeLoaded(heatmapStart, today);
  }, [ensureRangeLoaded, today]);

  const minutesByDate = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((e) => map.set(e.date, (map.get(e.date) || 0) + (e.durationMinutes || 0)));
    return map;
  }, [entries]);

  const todayMinutes = minutesByDate.get(today) || 0;

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

  const weekChartData = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const d = addDaysStr(today, -(6 - i));
      return { key: d, minutes: minutesByDate.get(d) || 0, bucket: "day" as const };
    }),
    [minutesByDate, today]
  );
  const weekChartMax = Math.max(...weekChartData.map((d) => d.minutes), 1);
  const shortDate = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en", { weekday: "short", month: "numeric", day: "numeric" });

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

      <div className="reports__kpis">
        <div className="kpi-card">
          <div className="kpi-card__label">Today</div>
          <div className="kpi-card__value">{formatMinutes(todayMinutes)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">This week</div>
          <div className="kpi-card__value">
            {formatMinutes(weekMinutes)}
            {targetHours > 0 && <span className="kpi-card__target"> / {targetHours}h</span>}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Day streak</div>
          <div className="kpi-card__value">
            {streakDays > 0
              ? <><IconFlame size={17} className="kpi-card__flame" />{streakDays}</>
              : "—"}
          </div>
        </div>
      </div>

      <div className="reports__grid">
        <div className="report-card report-card--wide">
          <h3 className="report-card__title">Last 7 Days</h3>
          <SvgBarChart
            chartData={weekChartData}
            maxBar={weekChartMax}
            shortDate={(d) => shortDate(d)}
            formatMinutes={formatMinutes}
          />
        </div>

        <div className="report-card report-card--wide">
          <h3 className="report-card__title">Activity</h3>
          <ActivityHeatmap entries={entries} weeks={HEATMAP_WEEKS} />
        </div>

        <div className="report-card report-card--wide">
          <h3 className="report-card__title">Recent</h3>
          {recentEntries.length === 0 ? (
            <p className="report-card__empty">No entries yet.</p>
          ) : (
            <div className="timesheet__entries">
              {recentEntries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  project={projects.find((p) => p.id === entry.projectId)}
                  task={tasks.find((t) => t.id === entry.taskId)}
                  timerBusy={timerBusy}
                  onContinue={onContinue}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
