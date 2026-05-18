import React, { useEffect, useMemo, useState } from "react";
import type { TimeEntry, Project, Task } from "../types";
import { formatMinutes } from "../hooks";
import { exportToCSV, buildExportFilename } from "../services/csvExport";
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
  const cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    days.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

const REPORTS_PRESETS = ["7d", "30d", "thisMonth"] as const;

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

  // Daily totals for bar chart
  const days = useMemo(() => getDaysInRange(from, to), [from, to]);
  const dailyTotals = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((e) => {
      map.set(e.date, (map.get(e.date) || 0) + (e.durationMinutes || 0));
    });
    return days.map((d) => ({ date: d, minutes: map.get(d) || 0 }));
  }, [filtered, days]);

  const maxDaily = useMemo(() => Math.max(...dailyTotals.map((d) => d.minutes), 1), [dailyTotals]);

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

  const shortDate = (d: string) => {
    const dt = new Date(d + "T00:00:00");
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
              className={`export-btn ${exporting ? "export-btn--loading" : ""}`}
              onClick={handleExport}
              disabled={filtered.length === 0 || exporting}
              title="Export visible entries to CSV"
            >
              {exporting ? "Exporting…" : "↓ Export CSV"}
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
          <div className="kpi-card__label">Daily average</div>
          <div className="kpi-card__value">{formatMinutes(Math.round(totalMinutes / Math.max(days.length, 1)))}</div>
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
        {/* Daily bar chart */}
        <div className="report-card report-card--wide">
          <h3 className="report-card__title">Daily Activity</h3>
          <div className="bar-chart">
            {dailyTotals.map(({ date, minutes }) => (
              <div key={date} className="bar-chart__col">
                <div className="bar-chart__bar-wrap">
                  <div
                    className="bar-chart__bar"
                    style={{ height: `${Math.max((minutes / maxDaily) * 100, minutes > 0 ? 4 : 0)}%` }}
                    title={formatMinutes(minutes)}
                  />
                </div>
                <div className="bar-chart__label">{shortDate(date)}</div>
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
