import React, { useMemo } from "react";
import type { TimeEntry } from "../types";
import { formatMinutes } from "../hooks";
import { addDaysStr, localDateStr, weekStartStr } from "../utils/dates";

interface Props {
  entries: TimeEntry[];
  /** How many full weeks (Mon–Sun) to show, most recent on the right. */
  weeks?: number;
}

// Only every other row gets a label (Mon/Wed/Fri), same as GitHub's grid — a
// label on every row is noisier without adding information.
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Cell {
  date: string;
  minutes: number;
  level: 0 | 1 | 2 | 3 | 4;
  col: number;
  row: number;
}

/** GitHub/solidtime-style contribution grid — one cell per day, shaded by
 *  minutes logged, most recent week on the right. Purely a supplementary
 *  visualization: the same totals are already available as accessible text
 *  in the KPI strip above it, so the grid itself is decorative. */
export const ActivityHeatmap: React.FC<Props> = ({ entries, weeks = 12 }) => {
  const { cells, monthMarkers, maxMinutes } = useMemo(() => {
    const today = localDateStr();
    // Grid starts on the Monday `weeks` weeks back, so every column is a
    // complete Mon–Sun week and the grid is always exactly weeks*7 cells.
    const gridStart = addDaysStr(weekStartStr(today), -(weeks - 1) * 7);

    const minutesByDate = new Map<string, number>();
    entries.forEach((e) => {
      if (e.date < gridStart || e.date > today) return;
      minutesByDate.set(e.date, (minutesByDate.get(e.date) || 0) + (e.durationMinutes || 0));
    });

    // actualMax is 0 for an empty window (reported to the user as-is);
    // scaleMax keeps the ratio below from dividing by zero without letting
    // that fallback leak into the reported max.
    const actualMax = Math.max(...minutesByDate.values(), 0);
    const scaleMax = Math.max(actualMax, 1);
    const level = (minutes: number): Cell["level"] => {
      if (minutes <= 0) return 0;
      const ratio = minutes / scaleMax;
      if (ratio > 0.75) return 4;
      if (ratio > 0.5) return 3;
      if (ratio > 0.25) return 2;
      return 1;
    };

    const list: Cell[] = [];
    const markers: { col: number; label: string }[] = [];
    let lastMonth = -1;
    let d = gridStart;
    let dayIndex = 0;
    while (d <= today) {
      const col = Math.floor(dayIndex / 7);
      const row = dayIndex % 7; // gridStart is always a Monday, so row 0 = Monday
      const minutes = minutesByDate.get(d) || 0;
      list.push({ date: d, minutes, level: level(minutes), col, row });

      const month = new Date(d + "T00:00:00").getMonth();
      // Skip a marker that would land within 2 columns of the previous one —
      // a leading sliver of a month at the very start of the grid otherwise
      // prints its label crammed against the next month's ("ApMay").
      const prevCol = markers.length > 0 ? markers[markers.length - 1].col : -Infinity;
      if (row === 0 && month !== lastMonth && col - prevCol >= 3) {
        markers.push({ col, label: MONTH_LABELS[month] });
        lastMonth = month;
      }
      d = addDaysStr(d, 1);
      dayIndex += 1;
    }

    return { cells: list, monthMarkers: markers, maxMinutes: actualMax };
  }, [entries, weeks]);

  return (
    <div className="activity-heatmap-wrap">
      <div className="activity-heatmap">
        <div className="activity-heatmap__rowlabels" aria-hidden="true">
          <span className="activity-heatmap__rowlabel activity-heatmap__rowlabel--spacer" />
          {DAY_LABELS.map((label, i) => (
            <span key={i} className="activity-heatmap__rowlabel">{label}</span>
          ))}
        </div>
        <div className="activity-heatmap__main">
          <div className="activity-heatmap__months" style={{ ["--ah-cols" as string]: weeks }} aria-hidden="true">
            {monthMarkers.map(({ col, label }) => (
              <span key={col} className="activity-heatmap__month" style={{ gridColumn: col + 1 }}>
                {label}
              </span>
            ))}
          </div>
          <div className="activity-heatmap__grid" style={{ ["--ah-cols" as string]: weeks }} aria-hidden="true">
            {cells.map((c) => (
              <div
                key={c.date}
                className={`activity-heatmap__cell activity-heatmap__cell--${c.level}`}
                style={{ gridColumn: c.col + 1, gridRow: c.row + 1 }}
                title={`${new Date(c.date + "T00:00:00").toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })} — ${c.minutes > 0 ? formatMinutes(c.minutes) : "no time logged"}`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="activity-heatmap__legend" aria-hidden="true">
        <span>Less</span>
        {([0, 1, 2, 3, 4] as const).map((lvl) => (
          <span key={lvl} className={`activity-heatmap__cell activity-heatmap__cell--${lvl}`} />
        ))}
        <span>More</span>
      </div>
      {/* The grid above is aria-hidden decoration; this is the accessible
          summary of the same data (totals are also in the KPI strip). */}
      <p className="sr-only">
        {maxMinutes > 0
          ? `Activity over the last ${weeks} weeks — busiest day totaled ${formatMinutes(maxMinutes)}.`
          : `No activity logged in the last ${weeks} weeks.`}
      </p>
    </div>
  );
};
