import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TimeEntry, Project, Task } from "../types";
import { formatMinutes } from "../hooks";
import { useDataRange } from "../contexts/DataRangeContext";
import {
  exportToCSV, buildExportFilename,
  RoundingRule, ROUNDING_LABELS,
} from "../services/csvExport";
import { localDateStr, weekStartStr } from "../utils/dates";
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

const REPORTS_PRESETS = ["7d", "30d", "thisMonth", "all"] as const;

// Past this many days, daily bars become unreadable — bucket by week instead;
// past MONTHLY_BUCKET_THRESHOLD, bucket by month.
const WEEKLY_BUCKET_THRESHOLD = 35;
const MONTHLY_BUCKET_THRESHOLD = 180;

type Bucket = "day" | "week" | "month";

// The rounding choice is a device preference, not data — persist locally.
const ROUNDING_STORAGE_KEY = "tt_export_rounding";

function readStoredRounding(): RoundingRule {
  try {
    const v = localStorage.getItem(ROUNDING_STORAGE_KEY);
    if (v && v in ROUNDING_LABELS) return v as RoundingRule;
  } catch { /* default below */ }
  return "exact";
}

interface SvgBarChartProps {
  chartData: { key: string; minutes: number; bucket: Bucket }[];
  maxBar: number;
  shortDate: (d: string, bucket: Bucket) => string;
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
        {chartData.map(({ key, minutes, bucket }, i) => {
          const barH = minutes > 0 ? Math.max((minutes / maxBar) * CHART_HEIGHT, 4) : 0;
          const x = i * slotWidth + (slotWidth - barWidth) / 2;
          const y = CHART_HEIGHT - barH;
          const label = shortDate(key, bucket);

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
  const [rounding, setRounding] = useState<RoundingRule>(readStoredRounding);

  const { from, to } = useMemo(() => resolveDateRange(rangeState), [rangeState]);

  // If the user picks a range that extends past what's cached, ask App to widen.
  useEffect(() => {
    ensureRangeLoaded(from, to);
  }, [from, to, ensureRangeLoaded]);

  const filtered = useMemo(
    () => entries.filter((e) => e.date >= from && e.date <= to && e.durationMinutes),
    [entries, from, to]
  );

  // The "all" preset resolves to 1970→9999; the chart/matrix axes must never
  // enumerate that. Clamp the *display* range to the dates that actually hold
  // data (falling back to today) — `filtered` itself still uses from/to, and
  // the clamped bounds cover every filtered entry by construction.
  const { effFrom, effTo } = useMemo(() => {
    const today = localDateStr();
    let min = "";
    let max = "";
    for (const e of filtered) {
      if (!e.date) continue;
      if (!min || e.date < min) min = e.date;
      if (!max || e.date > max) max = e.date;
    }
    return {
      effFrom: from < (min || today) ? (min || today) : from,
      effTo: to > (max > today ? max : today) ? (max > today ? max : today) : to,
    };
  }, [filtered, from, to]);

  const handleRoundingChange = (rule: RoundingRule) => {
    setRounding(rule);
    try { localStorage.setItem(ROUNDING_STORAGE_KEY, rule); } catch { /* in-memory only */ }
  };

  const handleExport = () => {
    setExporting(true);
    try {
      // effFrom/effTo keep the "all" preset's 1970→9999 sentinel out of the filename.
      exportToCSV(filtered, projects, tasks, buildExportFilename(effFrom, effTo), rounding);
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

  // Bar chart + matrix: daily buckets for short ranges, weekly for long ones,
  // monthly beyond that.
  const days = useMemo(() => getDaysInRange(effFrom, effTo), [effFrom, effTo]);
  const bucket: Bucket = days.length > MONTHLY_BUCKET_THRESHOLD ? "month"
    : days.length > WEEKLY_BUCKET_THRESHOLD ? "week" : "day";
  const bucketKeyFor = useCallback(
    (d: string) => (bucket === "month" ? d.slice(0, 7) : bucket === "week" ? weekStartStr(d) : d),
    [bucket]
  );

  // Ordered unique bucket keys spanning the range (including empty buckets).
  const bucketKeys = useMemo(() => {
    const keys: string[] = [];
    let last = "";
    for (const d of days) {
      const k = bucketKeyFor(d);
      if (k !== last) { keys.push(k); last = k; }
    }
    return keys;
  }, [days, bucketKeyFor]);

  const chartData = useMemo(() => {
    const byBucket = new Map<string, number>();
    filtered.forEach((e) => {
      const k = bucketKeyFor(e.date);
      byBucket.set(k, (byBucket.get(k) || 0) + (e.durationMinutes || 0));
    });
    return bucketKeys.map((k) => ({ key: k, minutes: byBucket.get(k) || 0, bucket }));
  }, [filtered, bucketKeys, bucketKeyFor, bucket]);

  const maxBar = useMemo(() => Math.max(...chartData.map((d) => d.minutes), 1), [chartData]);

  // Ratio-weighted total (Σ duration × ratio, missing ratio counts ×1) —
  // only meaningful, and only shown, when at least one entry carries a ratio.
  const hasRatios = useMemo(() => filtered.some((e) => e.ratio !== undefined), [filtered]);
  const weightedMinutes = useMemo(
    () => Math.round(filtered.reduce((s, e) => s + (e.durationMinutes || 0) * (e.ratio ?? 1), 0)),
    [filtered]
  );

  // Project × period matrix — the classic timesheet grid.
  const matrix = useMemo(() => {
    const byProject = new Map<string, Map<string, number>>();
    filtered.forEach((e) => {
      const k = bucketKeyFor(e.date);
      if (!byProject.has(e.projectId)) byProject.set(e.projectId, new Map());
      const row = byProject.get(e.projectId)!;
      row.set(k, (row.get(k) || 0) + (e.durationMinutes || 0));
    });
    const rows = [...byProject.entries()]
      .map(([id, cells]) => ({
        project: projects.find((p) => p.id === id),
        cells,
        total: [...cells.values()].reduce((s, m) => s + m, 0),
      }))
      .filter((r) => r.project)
      .sort((a, b) => b.total - a.total);
    const colTotals = bucketKeys.map((k) =>
      rows.reduce((s, r) => s + (r.cells.get(k) || 0), 0)
    );
    return { rows, colTotals };
  }, [filtered, projects, bucketKeys, bucketKeyFor]);

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

  const shortDate = useCallback((d: string, b: Bucket) => {
    // Month keys are "YYYY-MM"; day/week keys are full dates.
    const dt = new Date((b === "month" ? `${d}-01` : d) + "T00:00:00");
    if (b === "month") return dt.toLocaleDateString("en", { month: "short", year: "2-digit" });
    if (b === "week") return dt.toLocaleDateString("en", { month: "short", day: "numeric" });
    return dt.toLocaleDateString("en", { weekday: "short", month: "numeric", day: "numeric" });
  }, []);

  const bucketNoun = bucket === "month" ? "Month" : bucket === "week" ? "Week" : "Day";

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
            <div className="reports__export-controls">
              <select
                className="rounding-select"
                value={rounding}
                onChange={(e) => handleRoundingChange(e.target.value as RoundingRule)}
                aria-label="Duration rounding applied to the CSV export"
                title="Billing-style rounding applied to the export's duration columns (stored entries are unchanged)"
              >
                {(Object.keys(ROUNDING_LABELS) as RoundingRule[]).map((rule) => (
                  <option key={rule} value={rule}>{ROUNDING_LABELS[rule]}</option>
                ))}
              </select>
              <button
                className={`export-btn btn-icon ${exporting ? "export-btn--loading" : ""}`}
                onClick={handleExport}
                disabled={filtered.length === 0 || exporting}
                title="Export visible entries to CSV"
              >
                <IconDownload /> {exporting ? "Exporting…" : "Export CSV"}
              </button>
            </div>
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
        {hasRatios && (
          <div className="kpi-card" title="Σ duration × ratio — entries without a ratio count ×1">
            <div className="kpi-card__label">Weighted total</div>
            <div className="kpi-card__value">{formatMinutes(weightedMinutes)}</div>
          </div>
        )}
      </div>

      {filtered.length === 0 && (
        <div className="reports__empty">
          <p>No data to report. Track some time first.</p>
        </div>
      )}

      <div className="reports__grid">
        {/* Activity bar chart */}
        <div className="report-card report-card--wide">
          <h3 className="report-card__title">
            {bucket === "month" ? "Monthly Activity" : bucket === "week" ? "Weekly Activity" : "Daily Activity"}
          </h3>
          <SvgBarChart chartData={chartData} maxBar={maxBar} shortDate={shortDate} formatMinutes={formatMinutes} />
        </div>

        {/* Project × period matrix — the classic timesheet grid */}
        {matrix.rows.length > 0 && (
          <div className="report-card report-card--wide">
            <h3 className="report-card__title">Project × {bucketNoun}</h3>
            <div className="matrix-wrap">
              <table className="matrix">
                <thead>
                  <tr>
                    <th className="matrix__proj-col">Project</th>
                    {bucketKeys.map((k) => (
                      <th key={k}>{shortDate(k, bucket)}</th>
                    ))}
                    <th className="matrix__total-col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map(({ project, cells, total }) => (
                    <tr key={project!.id}>
                      <td className="matrix__proj-col">
                        <span className="project-breakdown__dot" style={{ background: project!.color }} />
                        {project!.name}
                      </td>
                      {bucketKeys.map((k) => {
                        const mins = cells.get(k) || 0;
                        return (
                          <td key={k} className={mins ? "" : "matrix__zero"} title={mins ? formatMinutes(mins) : undefined}>
                            {mins ? (mins / 60).toFixed(1) : "–"}
                          </td>
                        );
                      })}
                      <td className="matrix__total-col" title={formatMinutes(total)}>{(total / 60).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="matrix__proj-col">Total</td>
                    {matrix.colTotals.map((mins, i) => (
                      <td key={bucketKeys[i]} className={mins ? "" : "matrix__zero"} title={mins ? formatMinutes(mins) : undefined}>
                        {mins ? (mins / 60).toFixed(1) : "–"}
                      </td>
                    ))}
                    <td className="matrix__total-col" title={formatMinutes(totalMinutes)}>{(totalMinutes / 60).toFixed(1)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="matrix__hint">Hours per project per {bucketNoun.toLowerCase()}. Hover a cell for the exact time.</p>
          </div>
        )}

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
