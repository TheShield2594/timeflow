import React, { useMemo, useState } from "react";
import { DATE_LOCALE } from "../utils/dates";
import { formatMinutes } from "../hooks";
import { useData } from "../contexts/DataContext";
import { useRangeRequest } from "../contexts/DataRangeContext";
import { useToday } from "../hooks/useToday";
import {
  bucketKeysFor, buildChartData, buildProjectBreakdown, buildTaskBreakdown,
  countActiveDays, filterEntriesForRange, findNarrowestRangeWithData,
  getDaysInRange, pickBucket, sumMinutes, type Bucket,
} from "../utils/reportAggregations";
import { previousPeriod, RANGE_LABEL, rangeLabel, resolveRange, type RangePreset, type RangeState } from "../utils/ranges";
import { DEFAULT_PROJECT_COLOR } from "../utils/colors";
import { buildExportFilename, exportToCSV, ROUNDING_LABELS, type RoundingRule } from "../services/csvExport";
import { ListCard, ListRow } from "./ListCard";
import { SegmentedControl } from "./SegmentedControl";
import { FloatingActionBar } from "./FloatingActionBar";
import { Pill } from "./Pill";

const PRESETS: RangePreset[] = ["thisWeek", "lastWeek", "month", "quarter"];

// The rounding choice is a device preference, not data — persist locally.
const ROUNDING_STORAGE_KEY = "tt_export_rounding";

function readStoredRounding(): RoundingRule {
  try {
    const v = localStorage.getItem(ROUNDING_STORAGE_KEY);
    if (v && v in ROUNDING_LABELS) return v as RoundingRule;
  } catch { /* default below */ }
  return "exact";
}

function shortLabel(key: string, bucket: Bucket): string {
  const date = new Date((bucket === "month" ? `${key}-01` : key) + "T00:00:00");
  if (bucket === "month") return date.toLocaleDateString(DATE_LOCALE, { month: "short" });
  if (bucket === "week") return date.toLocaleDateString(DATE_LOCALE, { day: "numeric", month: "short" });
  return date.toLocaleDateString(DATE_LOCALE, { weekday: "short" });
}

/**
 * One headline, one shape, two rankings.
 *
 * It opens on **last** week rather than this one. A report on an unfinished
 * week is a chart of a half-day: every Monday it would say the team collapsed,
 * and by Friday it would say they recovered. The week you can actually draw a
 * conclusion from is the one that has ended.
 */
export const ReportsPage: React.FC = () => {
  const { entries, projects, tasks } = useData();
  const today = useToday();
  const [range, setRange] = useState<RangeState>({ preset: "lastWeek", customFrom: "", customTo: "" });
  const [rounding, setRounding] = useState<RoundingRule>(readStoredRounding);

  const { from, to } = useMemo(() => resolveRange(range, today), [range, today]);
  const prior = useMemo(() => previousPeriod(from, to), [from, to]);
  // Both spans are held open: the delta is a claim about the earlier one, so
  // it has to be loaded, not guessed from whatever happens to be in memory.
  useRangeRequest("reports", prior.from, to);

  const filtered = useMemo(() => filterEntriesForRange(entries, from, to), [entries, from, to]);
  const priorFiltered = useMemo(
    () => filterEntriesForRange(entries, prior.from, prior.to),
    [entries, prior]
  );

  const totalMinutes = sumMinutes(filtered);
  const priorMinutes = sumMinutes(priorFiltered);
  const delta = totalMinutes - priorMinutes;

  const days = useMemo(() => getDaysInRange(from, to), [from, to]);
  const bucket: Bucket = pickBucket(days.length);
  const bucketKeys = useMemo(() => bucketKeysFor(days, bucket), [days, bucket]);
  const chart = useMemo(() => buildChartData(filtered, bucketKeys, bucket), [filtered, bucketKeys, bucket]);

  const maxBar = Math.max(...chart.map((p) => p.minutes), 1);
  // Averaged over the buckets that have anything in them, not over the whole
  // range: a week with two days off averages over five days, because that is
  // the number a person means when they ask what their days look like.
  const workedBuckets = chart.filter((p) => p.minutes > 0);
  const average = workedBuckets.length > 0 ? totalMinutes / workedBuckets.length : 0;

  const projectRows = useMemo(
    () => buildProjectBreakdown(filtered, projects, totalMinutes).slice(0, 6),
    [filtered, projects, totalMinutes]
  );
  const taskRows = useMemo(
    () => buildTaskBreakdown(filtered, tasks, projects, 6),
    [filtered, tasks, projects]
  );

  const handleRounding = (rule: RoundingRule) => {
    setRounding(rule);
    try { localStorage.setItem(ROUNDING_STORAGE_KEY, rule); } catch { /* preference only */ }
  };

  const isEmpty = filtered.length === 0;
  const trackedDays = countActiveDays(filtered);

  /**
   * The narrowest other period that does hold something.
   *
   * An empty report is a dead end unless it can say where the time went
   * instead — and "widen the range" is advice the page is in a position to
   * take on the reader's behalf.
   */
  const recovery = useMemo(() => {
    if (!isEmpty) return null;
    const candidates = PRESETS
      .filter((preset) => preset !== range.preset)
      .map((preset) => ({ preset, label: RANGE_LABEL[preset], ...resolveRange({ preset, customFrom: "", customTo: "" }, today) }));
    return findNarrowestRangeWithData(entries, candidates);
  }, [isEmpty, entries, range.preset, today]);

  return (
    <>
      <div className="page__head">
        <h1 className="page__title t-large-title">Reports</h1>
      </div>

      <div className="page__toolbar">
        <SegmentedControl
          ariaLabel="Report period"
          value={range.preset}
          onChange={(preset) => setRange((r) => ({ ...r, preset }))}
          options={PRESETS.map((preset) => ({ value: preset, label: RANGE_LABEL[preset] }))}
        />
      </div>

      <div className="t-group-label t-secondary" style={{ marginTop: 28 }}>{rangeLabel(from, to)}</div>

      {isEmpty || trackedDays < 3 ? (
        <div className="empty">
          <div className="empty__title t-title2">
            {isEmpty ? "Nothing tracked in this period" : `${3 - trackedDays === 1 ? "One more day" : "Two more days"} and this becomes useful`}
          </div>
          <p className="empty__body t-body">
            {isEmpty
              ? "A report can only show what was tracked. Pick a wider period, or log the time you have already spent."
              : `A week needs three tracked days before its shape means anything. You have ${trackedDays === 1 ? "one" : trackedDays}.`}
          </p>
          {recovery && (
            <button
              type="button"
              className="empty__action"
              onClick={() => setRange((r) => ({ ...r, preset: recovery.preset as RangePreset }))}
            >
              You logged {formatMinutes(recovery.minutes)} in {recovery.label.toLowerCase()}
            </button>
          )}
          {!isEmpty && (
            <div className="reports__headline">
              <span className="reports__total t-display">{formatMinutes(totalMinutes)}</span>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="reports__headline">
            <span className="reports__total t-display">{formatMinutes(totalMinutes)}</span>
            <span className="reports__delta">
              {delta === 0
                ? "level with the period before"
                : `${delta > 0 ? "+" : "−"}${formatMinutes(Math.abs(delta))} on the period before`}
            </span>
          </div>

          {/* The average line lives inside the *same* box the bar percentages
              scale against. Put it in a wrapper that also holds the label row
              and every `bottom:` resolves against a taller box than the bars
              do — which is how an average line ends up drawn through the
              wrong bar. */}
          <div className="reports__bars-box">
            <div
              className="reports__bars"
              style={{ gridTemplateColumns: `repeat(${chart.length}, minmax(0, 1fr))` }}
            >
              {chart.map((point) => (
                <span
                  key={point.key}
                  className={`reports__bar${point.minutes === 0 ? " reports__bar--empty" : ""}`}
                  style={{ height: point.minutes === 0 ? "2%" : `${(point.minutes / maxBar) * 100}%` }}
                />
              ))}
            </div>
            {average > 0 && (
              <>
                <div className="reports__avg-line" style={{ bottom: `${(average / maxBar) * 100}%` }} />
                <div className="reports__avg-label" style={{ bottom: `calc(${(average / maxBar) * 100}% + 4px)` }}>
                  avg {formatMinutes(Math.round(average))}
                </div>
              </>
            )}
          </div>
          <div
            className="reports__bar-labels"
            style={{ gridTemplateColumns: `repeat(${chart.length}, minmax(0, 1fr))` }}
          >
            {chart.map((point) => (
              <div key={point.key} className="reports__bar-label">
                <div className="reports__bar-day">{shortLabel(point.key, bucket)}</div>
                <div className="reports__bar-value">{point.minutes > 0 ? formatMinutes(point.minutes) : "—"}</div>
              </div>
            ))}
          </div>

          <div className="page__rule" style={{ marginTop: 32 }} />

          <div className="reports__split">
            <div>
              <h2 className="t-title2">Where it went</h2>
              <div className="prop-list">
                {projectRows.map((row) => (
                  <div key={row.project.id} className="prop-row">
                    <span className="prop-row__name">{row.project.name}</span>
                    {/* The percentages come allocated, not rounded row by row:
                        they are read as one stack and added up by eye, so
                        three equal projects have to read 34/33/33 (#113). */}
                    <span className="prop-row__value">{formatMinutes(row.minutes)} · {row.percent}%</span>
                    <span className="prop-row__track">
                      <span
                        className="prop-row__fill"
                        style={{
                          width: `${(row.minutes / Math.max(1, totalMinutes)) * 100}%`,
                          "--pc": row.project.color || DEFAULT_PROJECT_COLOR,
                        } as React.CSSProperties}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="t-title2" style={{ marginBottom: 12 }}>Top tasks</h2>
              <ListCard>
                {taskRows.map((row) => (
                  <ListRow
                    key={row.task.id}
                    color={row.project?.color}
                    title={row.task.name}
                    subtitle={row.project?.name}
                    value={formatMinutes(row.minutes)}
                  />
                ))}
              </ListCard>
            </div>
          </div>
        </>
      )}

      <FloatingActionBar
        hint={
          <label>
            Rounding ·{" "}
            <select
              className="field-row__select"
              value={rounding}
              onChange={(e) => handleRounding(e.target.value as RoundingRule)}
              aria-label="Rounding applied to exported durations"
            >
              {(Object.keys(ROUNDING_LABELS) as RoundingRule[]).map((rule) => (
                <option key={rule} value={rule}>{ROUNDING_LABELS[rule].toLowerCase()}</option>
              ))}
            </select>
          </label>
        }
      >
        <Pill
          tone="primary"
          onClick={() => exportToCSV(filtered, projects, tasks, buildExportFilename(from, to), rounding)}
          disabled={isEmpty}
        >
          Export CSV
        </Pill>
      </FloatingActionBar>
    </>
  );
};
