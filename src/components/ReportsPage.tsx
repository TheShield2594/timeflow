import React, { useEffect, useMemo, useState } from "react";
import type { TimeEntry, Project, Task } from "../types";
import { formatMinutes } from "../hooks";
import { exportToCSV, buildExportFilename } from "../services/csvExport";
import { localDateStr } from "../utils/dates";
import { IconDownload } from "./Icons";
import {
  DateRangeFilter,
  DateRangeState,
  resolveDateRange,
} from "./DateRangeFilter";

interface Props {
  entries: TimeEntry[];
  projects: Project[];
  tasks: Task[];
  onEnsureRangeLoaded?: (from: string, to: string) => void;
}

function getDaysInRange(from: string, to: string): string[] {
  const days: string[] = [];
  const cur = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (cur <= end) {
    days.push(localDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/** Monday of the week containing the given local date string. */
function weekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDateStr(d);
}

const REPORTS_PRESETS = ["7d", "30d", "thisMonth"] as const;

// Past this many days, daily bars become unreadable — bucket by week instead.
const WEEKLY_BUCKET_THRESHOLD = 35;

export const ReportsPage: React.FC<Props> = ({ entries, projects, tasks, onEnsureRangeLoaded }) => {
  const [rangeState, setRangeState] = useState<DateRangeState>({
    preset: "7d",
    customFrom: "",
    customTo: "",
  });
  const [exporting, setExporting] = useState(false);

  const { from, to } = useMemo(() => resolveDateRange(rangeState), [rangeState]);

  // If the user picks a range that extends past what's cached, ask App to widen.
  useEffect(() => {
    onEnsureRangeLoaded?.(from, to);
  }, [from, to, onEnsureRangeLoaded]);

  const filtered = useMemo(
    () => entries.filter((e) => e.date >= from && e.date <= to && e.durationMinutes),
    [entries, from, to]
  );

  const handleExport = () => {
    setExporting(true);
    try {
      exportToCSV(filtered, projects, tasks, buildExportFilename(from, to));
    } finally {
      setTimeout(() => setExporting(false), 800);
    }
  };

  const totalMinutes = useMemo(() => filtered.reduce((s, e) => s + (e.durationMinutes || 0), 0), [filtered]);

  // Per-project breakdown
  const projectBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((e) => {
      map.set(e.projectId, (map.get(e.projectId) || 0) + (e.durationMinutes || 0));
    });
    return [...map.entries()]
      .map(([id, mins]) => ({
        project: projects.find((p) => p.id === id),
        minutes: mins,
        percent: totalMinutes > 0 ? Math.round((mins / totalMinutes) * 100) : 0,
      }))
      .filter((r) => r.project)
      .sort((a, b) => b.minutes - a.minutes);
  }, [filtered, projects, totalMinutes]);

  // Bar chart: daily bars for short ranges, weekly buckets for long ones.
  const days = useMemo(() => getDaysInRange(from, to), [from, to]);
  const useWeekly = days.length > WEEKLY_BUCKET_THRESHOLD;

  const chartData = useMemo(() => {
    const byDate = new Map<string, number>();
    filtered.forEach((e) => {
      byDate.set(e.date, (byDate.get(e.date) || 0) + (e.durationMinutes || 0));
    });
    if (!useWeekly) {
      return days.map((d) => ({ key: d, minutes: byDate.get(d) || 0, weekly: false }));
    }
    const byWeek = new Map<string, number>();
    days.forEach((d) => {
      const wk = weekStart(d);
      byWeek.set(wk, (byWeek.get(wk) || 0) + (byDate.get(d) || 0));
    });
    return [...byWeek.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([wk, minutes]) => ({ key: wk, minutes, weekly: true }));
  }, [filtered, days, useWeekly]);

  const maxBar = useMemo(() => Math.max(...chartData.map((d) => d.minutes), 1), [chartData]);

  // Days that actually have logged time — the average people expect.
  const activeDays = useMemo(() => {
    const set = new Set<string>();
    filtered.forEach((e) => set.add(e.date));
    return set.size;
  }, [filtered]);

  // Per-task breakdown
  const taskBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filtered.filter((e) => e.taskId).forEach((e) => {
      map.set(e.taskId!, (map.get(e.taskId!) || 0) + (e.durationMinutes || 0));
    });
    return [...map.entries()]
      .map(([id, mins]) => ({
        task: tasks.find((t) => t.id === id),
        project: projects.find((p) => p.id === tasks.find((t) => t.id === id)?.projectId),
        minutes: mins,
      }))
      .filter((r) => r.task)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 8);
  }, [filtered, tasks, projects]);

  const shortDate = (d: string, weekly: boolean) => {
    const dt = new Date(d + "T00:00:00");
    if (weekly) return dt.toLocaleDateString("en", { month: "short", day: "numeric" });
    return dt.toLocaleDateString("en", { weekday: "short", month: "numeric", day: "numeric" });
  };

  return (
    <div className="reports">
      <div className="reports__header">
        <h2 className="reports__title">Reports</h2>
        <DateRangeFilter
          presets={[...REPORTS_PRESETS]}
          value={rangeState}
          onChange={setRangeState}
          info={
            rangeState.preset === "custom" && rangeState.customFrom && rangeState.customTo
              ? `${filtered.length} entries · ${formatMinutes(totalMinutes)} total`
              : undefined
          }
          rightSlot={
            <button
              className={`export-btn btn-icon ${exporting ? "export-btn--loading" : ""}`}
              onClick={handleExport}
              disabled={filtered.length === 0 || exporting}
              title="Export visible entries to CSV"
            >
              <IconDownload /> {exporting ? "Exporting…" : "Export CSV"}
            </button>
          }
        />
      </div>

      {/* KPI strip */}
      <div className="reports__kpis">
        <div className="kpi-card">
          <div className="kpi-card__label">Total tracked</div>
          <div className="kpi-card__value">{formatMinutes(totalMinutes)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Avg per active day</div>
          <div className="kpi-card__value">{formatMinutes(Math.round(totalMinutes / Math.max(activeDays, 1)))}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Sessions logged</div>
          <div className="kpi-card__value">{filtered.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Projects active</div>
          <div className="kpi-card__value">{projectBreakdown.length}</div>
        </div>
      </div>

      <div className="reports__grid">
        {/* Activity bar chart */}
        <div className="report-card report-card--wide">
          <h3 className="report-card__title">{useWeekly ? "Weekly Activity" : "Daily Activity"}</h3>
          <div className="bar-chart">
            {chartData.map(({ key, minutes, weekly }) => (
              <div key={key} className="bar-chart__col">
                <div className="bar-chart__bar-wrap">
                  <div
                    className="bar-chart__bar"
                    style={{ height: `${Math.max((minutes / maxBar) * 100, minutes > 0 ? 4 : 0)}%` }}
                    title={formatMinutes(minutes)}
                  />
                </div>
                <div className="bar-chart__label">{shortDate(key, weekly)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Project breakdown */}
        <div className="report-card">
          <h3 className="report-card__title">By Project</h3>
          {projectBreakdown.length === 0 && (
            <p className="report-card__empty">No data for this period.</p>
          )}
          <div className="project-breakdown">
            {projectBreakdown.map(({ project, minutes, percent }) => (
              <div key={project!.id} className="project-breakdown__row">
                <div className="project-breakdown__meta">
                  <span className="project-breakdown__dot" style={{ background: project!.color }} />
                  <span className="project-breakdown__name">{project!.name}</span>
                  <span className="project-breakdown__time">{formatMinutes(minutes)}</span>
                  <span className="project-breakdown__pct">{percent}%</span>
                </div>
                <div className="project-breakdown__track">
                  <div
                    className="project-breakdown__fill"
                    style={{ width: `${percent}%`, background: project!.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Task breakdown */}
        <div className="report-card">
          <h3 className="report-card__title">Top Tasks</h3>
          {taskBreakdown.length === 0 && (
            <p className="report-card__empty">No tasks logged.</p>
          )}
          <div className="task-breakdown">
            {taskBreakdown.map(({ task, project, minutes }) => (
              <div key={task!.id} className="task-breakdown__row">
                <div className="task-breakdown__dot" style={{ background: project?.color || "#6366f1" }} />
                <div className="task-breakdown__info">
                  <div className="task-breakdown__name">{task!.name}</div>
                  <div className="task-breakdown__project">{project?.name}</div>
                </div>
                <div className="task-breakdown__time">{formatMinutes(minutes)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
