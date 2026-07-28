import React, { useCallback, useMemo, useState } from "react";
import type { TimeEntry, Project, Task } from "../types";
import { formatMinutes } from "../hooks";
import { useRangeRequest } from "../contexts/DataRangeContext";
import { useToday } from "../hooks/useToday";
import {
  exportToCSV, buildExportFilename,
  RoundingRule, ROUNDING_LABELS,
} from "../services/csvExport";
import {
  Bucket,
  bucketKeysFor,
  buildChartData,
  buildMatrix,
  buildProjectBreakdown,
  buildTaskBreakdown,
  countActiveDays,
  filterEntriesForRange,
  getDaysInRange,
  pickBucket,
  resolveEffectiveRange,
  sumMinutes,
} from "../utils/reportAggregations";
import { IconDownload } from "./Icons";
import { SvgBarChart } from "./SvgBarChart";
import {
  DateRangeFilter,
  DateRangeState,
  resolveDateRange,
} from "./DateRangeFilter";

interface Props {
  entries: TimeEntry[];
  projects: Project[];
  tasks: Task[];
  rangeLoading?: boolean;
}

const REPORTS_PRESETS = ["7d", "30d", "thisMonth", "all"] as const;

// The rounding choice is a device preference, not data — persist locally.
const ROUNDING_STORAGE_KEY = "tt_export_rounding";

function readStoredRounding(): RoundingRule {
  try {
    const v = localStorage.getItem(ROUNDING_STORAGE_KEY);
    if (v && v in ROUNDING_LABELS) return v as RoundingRule;
  } catch { /* default below */ }
  return "exact";
}

export const ReportsPage: React.FC<Props> = ({ entries, projects, tasks, rangeLoading }) => {
  const today = useToday();
  const [rangeState, setRangeState] = useState<DateRangeState>({
    preset: "7d",
    customFrom: "",
    customTo: "",
  });
  const [exporting, setExporting] = useState(false);
  const [rounding, setRounding] = useState<RoundingRule>(readStoredRounding);

  // Keyed off `today` as well as the preset so a relative range ("last 7 days")
  // follows the local calendar past midnight instead of pinning the day the
  // page happened to mount.
  const { from, to } = useMemo(() => resolveDateRange(rangeState, today), [rangeState, today]);

  // Hold this range open while Reports is showing it. Released on unmount and
  // replaced when the preset changes, so "All time" stops widening every other
  // page's fetches the moment the user picks something narrower or navigates
  // away (#74).
  useRangeRequest("reports", from, to);

  const filtered = useMemo(() => filterEntriesForRange(entries, from, to), [entries, from, to]);

  // The "all" preset resolves to 1970→9999; the chart/matrix axes must never
  // enumerate that, so for "all" (and only "all" — short presets keep their
  // leading/trailing empty days) the display range is clamped to the dates
  // that actually hold data. `filtered` itself still uses from/to, and the
  // clamped bounds cover every filtered entry by construction.
  const { effFrom, effTo } = useMemo(
    () => resolveEffectiveRange(rangeState.preset, filtered, from, to, today),
    [rangeState.preset, filtered, from, to, today]
  );

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

  const totalMinutes = useMemo(() => sumMinutes(filtered), [filtered]);

  // Per-project breakdown
  const projectBreakdown = useMemo(
    () => buildProjectBreakdown(filtered, projects, totalMinutes),
    [filtered, projects, totalMinutes]
  );

  // Bar chart + matrix: daily buckets for short ranges, weekly for long ones,
  // monthly beyond that.
  const days = useMemo(() => getDaysInRange(effFrom, effTo), [effFrom, effTo]);
  const bucket: Bucket = pickBucket(days.length);

  // Ordered unique bucket keys spanning the range (including empty buckets).
  const bucketKeys = useMemo(() => bucketKeysFor(days, bucket), [days, bucket]);

  const chartData = useMemo(
    () => buildChartData(filtered, bucketKeys, bucket),
    [filtered, bucketKeys, bucket]
  );

  const maxBar = useMemo(() => Math.max(...chartData.map((d) => d.minutes), 1), [chartData]);

  // No ratio arithmetic here, deliberately (#71): `ratio` is a billing
  // account identifier, not a multiplier. A "Weighted total" KPI used to
  // compute Σ duration × ratio, so a user who followed the field's own help
  // text and entered account `2` saw their tracked hours doubled on the
  // billing dashboard. Ratio travels to the CSV export as data and is
  // never multiplied by anything.

  // Project × period matrix — the classic timesheet grid.
  const matrix = useMemo(
    () => buildMatrix(filtered, projects, bucketKeys, bucket),
    [filtered, projects, bucketKeys, bucket]
  );

  // Days that actually have logged time — the average people expect.
  const activeDays = useMemo(() => countActiveDays(filtered), [filtered]);

  // Per-task breakdown
  const taskBreakdown = useMemo(
    () => buildTaskBreakdown(filtered, tasks, projects),
    [filtered, tasks, projects]
  );

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
          loading={rangeLoading}
          info={
            rangeState.preset === "custom" && rangeState.customFrom && rangeState.customTo
              ? `${filtered.length} entries · ${formatMinutes(totalMinutes)} total`
              : undefined
          }
        />
      </div>

      {/* Export controls live in their own row, apart from the view/filter
          controls above — rounding is billing-relevant and shapes what
          leaves the app, unlike the range tabs which only affect what's
          displayed on screen. */}
      <div className="reports__export-bar">
        <span className="reports__export-label">Export</span>
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
            type="button"
            className={`export-btn btn-icon ${exporting ? "export-btn--loading" : ""}`}
            onClick={handleExport}
            disabled={filtered.length === 0 || exporting || rangeLoading}
            title={rangeLoading ? "Waiting for the full date range to load…" : "Export visible entries to CSV"}
          >
            <IconDownload /> {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
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
