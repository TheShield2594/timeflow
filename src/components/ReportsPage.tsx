import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TimeEntry, Project, Task } from "../types";
import { formatMinutes } from "../hooks";
import { useDataRange } from "../contexts/DataRangeContext";
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

interface SvgBarChartProps {
  chartData: { key: string; minutes: number; weekly: boolean }[];
  maxBar: number;
  shortDate: (d: string, weekly: boolean) => string;
  formatMinutes: (m: number) => string;
}

const BAR_COLOR = "var(--ev-green)";
const BAR_COLOR_ZERO = "var(--border)";
const CHART_HEIGHT = 120; // px, chart plot area
const LABEL_HEIGHT = 28;  // px, reserved below bars for labels
const BAR_GAP_RATIO = 0.25; // fraction of slot width used for gap between bars
// Caps how wide each bar's slot can grow — without this, a handful of bars
// (e.g. a 7-day range) would stretch edge-to-edge into fat blocks.
const MAX_SLOT_PX = 90;

const SvgBarChart: React.FC<SvgBarChartProps> = ({ chartData, maxBar, shortDate, formatMinutes }) => {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  // Measured in real pixels so the viewBox can match 1:1 — using a fixed
  // viewBox width with preserveAspectRatio="none" stretched bars AND text
  // non-uniformly whenever the container's actual width differed from it,
  // which is what made every range's day labels look horizontally smeared.
  const [containerWidth, setContainerWidth] = useState(600);
  const rafRef = useRef<number | null>(null);

  // useLayoutEffect (not useEffect) so the first measurement lands before
  // paint — otherwise the chart would flash at the 600px fallback first.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.getBoundingClientRect().width || 600);
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      // Coalesce rapid-fire resize notifications (e.g. a window drag) to one
      // update per frame instead of re-rendering on every callback.
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setContainerWidth(entry.contentRect.width));
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const totalHeight = CHART_HEIGHT + LABEL_HEIGHT;
  const n = chartData.length;
  const totalWidth = n > 0 ? Math.min(containerWidth, n * MAX_SLOT_PX) : containerWidth;
  const slotWidth = n > 0 ? totalWidth / n : totalWidth;
  const barWidth = Math.max(slotWidth * (1 - BAR_GAP_RATIO), 2);

  return (
    <div ref={containerRef} className="svg-bar-chart" style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        width={totalWidth}
        height={totalHeight}
        style={{ display: "block", margin: "0 auto", overflow: "visible" }}
        aria-label="Activity bar chart"
        role="img"
        onMouseLeave={() => setTooltip(null)}
      >
        {chartData.map(({ key, minutes, weekly }, i) => {
          const barH = minutes > 0 ? Math.max((minutes / maxBar) * CHART_HEIGHT, 4) : 0;
          const x = i * slotWidth + (slotWidth - barWidth) / 2;
          const y = CHART_HEIGHT - barH;
          const label = shortDate(key, weekly);

          return (
            <g key={key}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                fill={barH > 0 ? BAR_COLOR : BAR_COLOR_ZERO}
                opacity={barH > 0 ? 1 : 0.12}
                rx={2}

                onMouseEnter={() => {
                  const svgEl = svgRef.current;
                  if (!svgEl) return;
                  const rect = svgEl.getBoundingClientRect();
                  const svgScaleX = rect.width / totalWidth;
                  const svgScaleY = rect.height / totalHeight;
                  setTooltip({
                    x: (x + barWidth / 2) * svgScaleX,
                    y: y * svgScaleY,
                    label: minutes > 0 ? formatMinutes(minutes) : "No time logged",
                  });
                }}
                onMouseLeave={() => setTooltip(null)}
              />
              <text
                x={i * slotWidth + slotWidth / 2}
                y={CHART_HEIGHT + LABEL_HEIGHT - 6}
                textAnchor="middle"
                fontSize={n > 30 ? 7 : n > 14 ? 8 : 9}
                fill="var(--text-muted)"
                style={{ userSelect: "none" }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      {tooltip && (
        <div
          className="svg-bar-chart__tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          role="tooltip"
        >
          {tooltip.label}
        </div>
      )}
    </div>
  );
};

export const ReportsPage: React.FC<Props> = ({ entries, projects, tasks }) => {
  const { ensureRangeLoaded } = useDataRange();
  const [rangeState, setRangeState] = useState<DateRangeState>({
    preset: "7d",
    customFrom: "",
    customTo: "",
  });
  const [exporting, setExporting] = useState(false);

  const { from, to } = useMemo(() => resolveDateRange(rangeState), [rangeState]);

  // If the user picks a range that extends past what's cached, ask App to widen.
  useEffect(() => {
    ensureRangeLoaded(from, to);
  }, [from, to, ensureRangeLoaded]);

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

  const shortDate = useCallback((d: string, weekly: boolean) => {
    const dt = new Date(d + "T00:00:00");
    if (weekly) return dt.toLocaleDateString("en", { month: "short", day: "numeric" });
    return dt.toLocaleDateString("en", { weekday: "short", month: "numeric", day: "numeric" });
  }, []);

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

      {filtered.length === 0 && (
        <div className="reports__empty">
          <p>No data to report. Track some time first.</p>
        </div>
      )}

      <div className="reports__grid">
        {/* Activity bar chart */}
        <div className="report-card report-card--wide">
          <h3 className="report-card__title">{useWeekly ? "Weekly Activity" : "Daily Activity"}</h3>
          <SvgBarChart chartData={chartData} maxBar={maxBar} shortDate={shortDate} formatMinutes={formatMinutes} />
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
