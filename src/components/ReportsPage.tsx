import React, { useCallback, useMemo, useState } from "react";
import type { TimeEntry, Project, Task } from "../types";
import { formatDecimalHours, formatMinutes } from "../hooks";
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
  buildMatrixDisplay,
  buildProjectBreakdown,
  buildTaskBreakdown,
  countActiveDays,
  filterEntriesForRange,
  findNarrowestRangeWithData,
  getDaysInRange,
  pickBucket,
  resolveEffectiveRange,
  sumMinutes,
} from "../utils/reportAggregations";
import { HelpTip } from "./HelpTip";
import { IconChart, IconDownload } from "./Icons";
import { SvgBarChart } from "./SvgBarChart";
import {
  DateRangeFilter,
  DateRangePreset,
  DateRangeState,
  PRESET_LABEL,
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

  // What the grid actually prints. Kept apart from `matrix`, which stays in
  // exact minutes for the hover titles — the rounding lives on the display
  // side only, so nothing downstream can mistake a snapped figure for data.
  const display = useMemo(
    () => buildMatrixDisplay(matrix.rows, bucketKeys),
    [matrix.rows, bucketKeys]
  );

  // The grid's own total, which is `totalMinutes` less any time logged against
  // a project that no longer exists — those rows never make it into the
  // matrix, so its footer must not claim their hours.
  const matrixTotalMinutes = useMemo(
    () => matrix.rows.reduce((s, r) => s + r.total, 0),
    [matrix.rows]
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

  const isEmpty = filtered.length === 0;

  // What to offer instead when the chosen range is empty. Scanned over the
  // loaded entries, not refetched — the provider always keeps a 90-day
  // baseline window loaded, so the shorter presets are answered exactly and
  // "All time" is a floor that only ever understates what switching reveals.
  const suggestion = useMemo(() => {
    if (!isEmpty) return null;
    const candidates = REPORTS_PRESETS
      .filter((p) => p !== rangeState.preset)
      .map((p) => ({
        preset: p as string,
        label: PRESET_LABEL[p],
        ...resolveDateRange({ preset: p, customFrom: "", customTo: "" }, today),
      }));
    return findNarrowestRangeWithData(entries, candidates);
  }, [isEmpty, rangeState.preset, entries, today]);

  const rangeLabel =
    rangeState.preset === "custom"
      ? "this range"
      : PRESET_LABEL[rangeState.preset].toLowerCase();

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
          displayed on screen. The row is dropped rather than disabled when
          there is nothing to export: a dead button is one more thing to read
          and rule out on a page that already has nothing to say. */}
      {!isEmpty && (
      <div className="reports__export-bar">
        <span className="reports__export-label">Export</span>
        <div className="reports__export-controls">
          {/* That rounding never touches the stored entries is the most
              billing-consequential sentence on this page, and it was reachable
              only by hovering the select (#106). */}
          <HelpTip
            label="What does rounding do?"
            text="Billing-style rounding applied to the duration columns of the CSV as it's written. Your stored entries keep their exact minutes — nothing here changes what's recorded in Dataverse."
          />
          <select
            className="rounding-select"
            value={rounding}
            onChange={(e) => handleRoundingChange(e.target.value as RoundingRule)}
            aria-label="Duration rounding applied to the CSV export"
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
      )}

      {/* One empty state for the whole page. Every card below would otherwise
          restate the same fact — four 0m KPIs, an empty chart, "No data for
          this period", "No tasks logged" — so the grid is replaced rather
          than filled with zeroes, and the card-level strings are left to mean
          what they say: this card is empty while the page is not. */}
      {isEmpty ? (
        // Switching presets swaps the whole grid for this without moving
        // focus, so it has to announce itself.
        <div className="reports__empty" role="status" aria-live="polite">
          <IconChart size={40} className="reports__empty-icon" />
          <p className="reports__empty-title">Nothing tracked in {rangeLabel}.</p>
          {suggestion ? (
            <button
              type="button"
              className="reports__empty-action"
              onClick={() => setRangeState({ ...rangeState, preset: suggestion.preset as DateRangePreset })}
            >
              You logged {formatMinutes(suggestion.minutes)} in {suggestion.label.toLowerCase()}
              <span aria-hidden="true"> →</span>
            </button>
          ) : (
            <p className="reports__empty-hint">Start the timer and your report will fill in here.</p>
          )}
        </div>
      ) : (
      <>
      {/* KPI strip */}
      <div className="reports__kpis">
        <div className="kpi-card">
          <div className="kpi-card__label">Total tracked</div>
          <div className="kpi-card__value num-kpi">{formatMinutes(totalMinutes)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Avg per active day</div>
          <div className="kpi-card__value num-kpi">{formatMinutes(Math.round(totalMinutes / Math.max(activeDays, 1)))}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Sessions logged</div>
          <div className="kpi-card__value num-kpi">{filtered.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Projects active</div>
          <div className="kpi-card__value num-kpi">{projectBreakdown.length}</div>
        </div>
      </div>

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
              {/* scope= on every header and a <th> on the project column are
                  what make this a table a screen reader can navigate rather
                  than a wall of bare numbers; the exact duration goes in each
                  cell's accessible name, because `title` alone is unreachable
                  by keyboard and invisible to assistive tech (#106). TeamPage
                  is the working example this follows. */}
              <table className="matrix">
                <caption className="visually-hidden">
                  Hours per project per {bucketNoun.toLowerCase()}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="matrix__proj-col">Project</th>
                    {bucketKeys.map((k) => (
                      <th scope="col" key={k}>{shortDate(k, bucket)}</th>
                    ))}
                    <th scope="col" className="matrix__total-col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map(({ project, cells, total }, r) => (
                    <tr key={project!.id}>
                      <th scope="row" className="matrix__proj-col">
                        <span className="project-breakdown__dot" style={{ background: project!.color }} />
                        {project!.name}
                      </th>
                      {bucketKeys.map((k, c) => {
                        // "–" tracks the real minutes, not the printed ones: a
                        // couple of minutes rounds down to 0.0 on this grid,
                        // and a dash there would claim nothing was logged.
                        const mins = cells.get(k) || 0;
                        return (
                          <td
                            key={k}
                            className={mins ? "" : "matrix__zero"}
                            title={mins ? formatMinutes(mins) : undefined}
                            aria-label={mins ? formatMinutes(mins) : "No time logged"}
                          >
                            {mins ? formatDecimalHours(display.cells[r][c]) : "–"}
                          </td>
                        );
                      })}
                      <td className="matrix__total-col" title={formatMinutes(total)} aria-label={formatMinutes(total)}>
                        {formatDecimalHours(display.rowTotals[r])}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="matrix__proj-col">Total</th>
                    {matrix.colTotals.map((mins, i) => (
                      <td
                        key={bucketKeys[i]}
                        className={mins ? "" : "matrix__zero"}
                        title={mins ? formatMinutes(mins) : undefined}
                        aria-label={mins ? formatMinutes(mins) : "No time logged"}
                      >
                        {mins ? formatDecimalHours(display.colTotals[i]) : "–"}
                      </td>
                    ))}
                    <td
                      className="matrix__total-col"
                      title={formatMinutes(matrixTotalMinutes)}
                      aria-label={formatMinutes(matrixTotalMinutes)}
                    >
                      {formatDecimalHours(display.grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="matrix__hint">
              Decimal hours per project per {bucketNoun.toLowerCase()}. Every cell carries its
              exact time — as a tooltip on hover, and read out in place of the rounded figure.
            </p>
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
                <div className="task-breakdown__time num-row">{formatMinutes(minutes)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
};
