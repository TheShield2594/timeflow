import React, { useMemo, useState } from "react";
import type { Project, Task } from "../types";
import type { TeamContext, TeamEntry } from "../services/teamService";
import { useTeamEntries } from "../hooks/useTeam";
import { formatMinutes } from "../hooks";
import { addDaysStr, localDateStr, weekStartStr } from "../utils/dates";
import {
  exportToCSV, RoundingRule, ROUNDING_LABELS,
} from "../services/csvExport";
import { IconChevronLeft, IconChevronRight, IconDownload } from "./Icons";
import { RangeSpinner } from "./RangeSpinner";

interface Props {
  teamContext: TeamContext;
  projects: Project[];
  tasks: Task[];
}

// The rounding choice is a device preference, not data — persisted separately
// from the personal Reports export so a manager can pick different rounding
// for what they send about their team.
const TEAM_ROUNDING_STORAGE_KEY = "tt_team_export_rounding";

function readStoredRounding(): RoundingRule {
  try {
    const v = localStorage.getItem(TEAM_ROUNDING_STORAGE_KEY);
    if (v && v in ROUNDING_LABELS) return v as RoundingRule;
  } catch { /* default below */ }
  return "exact";
}

interface MemberRow {
  id: string;
  name: string;
  isSelf: boolean;
  dayMinutes: Map<string, number>;
  totalMinutes: number;
  missingDays: string[];
}

/**
 * Manager view (issue #61): the signed-in user's direct reports' week —
 * per-member day/week totals, missing-weekday flags, and a team project
 * rollup. Only rendered when the user has direct reports; the data read is
 * scoped server-side by Dataverse hierarchy security (see teamService).
 */
export const TeamPage: React.FC<Props> = ({ teamContext, projects, tasks }) => {
  const today = localDateStr();
  const [weekStart, setWeekStart] = useState(() => weekStartStr(today));
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i)),
    [weekStart]
  );
  const weekEnd = weekDays[6];
  const [rounding, setRounding] = useState<RoundingRule>(readStoredRounding);
  const [exporting, setExporting] = useState(false);

  const handleRoundingChange = (rule: RoundingRule) => {
    setRounding(rule);
    try { localStorage.setItem(TEAM_ROUNDING_STORAGE_KEY, rule); } catch { /* in-memory only */ }
  };

  const { entries, loading, error, refresh } = useTeamEntries(weekStart, weekEnd);

  // Exports exactly what the table shows for the visible week (every member
  // row, including the manager's own) so a manager can hand this straight to
  // whoever needs the team's time instead of exporting it themselves.
  const handleExport = () => {
    setExporting(true);
    try {
      // `ownerName` (not `userDisplayName`) is the reliable per-row owner —
      // see teamService's FormattedValue-annotation fallback — so the CSV's
      // "User" column reflects who actually logged each row.
      const exportEntries = entries.map((e) => ({ ...e, userDisplayName: e.ownerName }));
      exportToCSV(exportEntries, projects, tasks, `timeflow-team-${weekStart}-to-${weekEnd}.csv`, rounding);
    } finally {
      setTimeout(() => setExporting(false), 800);
    }
  };

  const memberRows = useMemo<MemberRow[]>(() => {
    const byOwner = new Map<string, { name: string; entries: TeamEntry[] }>();
    // Reports first so members with nothing logged still get a row (that
    // silence is exactly what a manager needs to see).
    teamContext.reports.forEach((m) => byOwner.set(m.id, { name: m.name, entries: [] }));
    entries.forEach((e) => {
      if (!e.ownerId) return;
      const bucket = byOwner.get(e.ownerId);
      if (bucket) {
        bucket.entries.push(e);
      } else {
        // Includes the manager themself and (at hierarchy depth > 1) indirect
        // reports — anyone whose rows the server said we may see.
        byOwner.set(e.ownerId, { name: e.ownerName || "Unknown user", entries: [e] });
      }
    });

    const rows: MemberRow[] = [];
    byOwner.forEach(({ name, entries: memberEntries }, id) => {
      const dayMinutes = new Map<string, number>();
      memberEntries.forEach((e) => {
        // Open (running) entries carry no duration yet.
        if (!e.endTime) return;
        dayMinutes.set(e.date, (dayMinutes.get(e.date) || 0) + (e.durationMinutes || 0));
      });
      const isSelf = id === teamContext.myUserId;
      // Missing = a weekday of this week that's already past (or today) with
      // nothing logged. The manager's own row isn't flagged — this page is
      // about the team, and their own gaps show on their personal pages.
      const missingDays = isSelf ? [] : weekDays.filter((d, i) => i < 5 && d <= today && !(dayMinutes.get(d) ?? 0));
      rows.push({
        id,
        name,
        isSelf,
        dayMinutes,
        totalMinutes: [...dayMinutes.values()].reduce((s, n) => s + n, 0),
        missingDays,
      });
    });
    // Self last; reports alphabetically.
    return rows.sort((a, b) =>
      a.isSelf !== b.isSelf ? (a.isSelf ? 1 : -1) : a.name.localeCompare(b.name)
    );
  }, [entries, teamContext, weekDays, today]);

  const teamTotal = useMemo(
    () => memberRows.reduce((s, r) => s + r.totalMinutes, 0),
    [memberRows]
  );

  // Team-wide project rollup for the visible week, largest first.
  const projectRollup = useMemo(() => {
    const byProject = new Map<string, number>();
    entries.forEach((e) => {
      if (!e.endTime) return;
      byProject.set(e.projectId, (byProject.get(e.projectId) || 0) + (e.durationMinutes || 0));
    });
    return [...byProject.entries()]
      .map(([projectId, minutes]) => {
        const project = projects.find((p) => p.id === projectId);
        return {
          projectId,
          minutes,
          name: project?.name || "Unassigned",
          color: project?.color || "#9aaa94",
        };
      })
      .filter((p) => p.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes);
  }, [entries, projects]);

  // Bar widths scale against the rollup's own sum, not teamTotal: the two
  // can differ (rollup counts entries whose owner id didn't resolve), and a
  // mismatch would push a bar past 100% — or to NaN if teamTotal were 0.
  const rollupTotal = useMemo(
    () => projectRollup.reduce((s, p) => s + p.minutes, 0),
    [projectRollup]
  );

  const fmtDay = (ds: string) =>
    new Date(`${ds}T00:00:00`).toLocaleDateString("en", { month: "short", day: "numeric" });
  const weekLabel = `${fmtDay(weekStart)} – ${fmtDay(weekEnd)}`;
  const missingTotal = memberRows.reduce((s, r) => s + r.missingDays.length, 0);

  return (
    <div className="team">
      <div className="team__header">
        <div className="team__title-group">
          <h2 className="team__title">Team</h2>
          <span className="team__week-total">{formatMinutes(teamTotal)} this week</span>
          {missingTotal > 0 && (
            <span className="team__missing-badge" title="Weekdays so far this week with nothing logged">
              {missingTotal} missing {missingTotal === 1 ? "day" : "days"}
            </span>
          )}
          {loading && <RangeSpinner label="Loading team entries…" />}
        </div>
        <div className="team__nav">
          <button className="cal-nav-btn" onClick={() => setWeekStart(addDaysStr(weekStart, -7))} aria-label="Previous week">
            <IconChevronLeft />
          </button>
          <button className="cal-nav-btn cal-nav-btn--today" onClick={() => setWeekStart(weekStartStr(today))}>
            This week
          </button>
          <button className="cal-nav-btn" onClick={() => setWeekStart(addDaysStr(weekStart, 7))} aria-label="Next week">
            <IconChevronRight />
          </button>
        </div>
      </div>
      <p className="team__scope-note">
        {weekLabel}. You see your own time and your direct reports&rsquo; (set via the
        Manager field in Dataverse; entries stay private to everyone else).
      </p>

      <div className="team__export-bar">
        <span className="team__export-label">Export</span>
        <div className="team__export-controls">
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
            disabled={entries.length === 0 || exporting || loading}
            title={loading ? "Waiting for this week's entries to load…" : "Export the team's week to CSV"}
          >
            <IconDownload /> {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="team__error" role="alert">
          Could not load team entries: {error}{" "}
          <button className="btn-sm btn-ghost" onClick={refresh}>Retry</button>
        </div>
      ) : (
        <>
          <div className="team__table-wrap">
            <table className="team__table">
              <thead>
                <tr>
                  <th scope="col" className="team__member-col">Member</th>
                  {weekDays.map((d) => (
                    <th scope="col" key={d} className={d === today ? "team__day--today" : ""}>
                      {new Date(`${d}T00:00:00`).toLocaleDateString("en", { weekday: "short" })}
                      <span className="team__day-num">{Number(d.slice(-2))}</span>
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {memberRows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" className="team__member-col">
                      <span className="team__member-name">
                        {row.name}
                        {row.isSelf && <span className="team__you-badge">you</span>}
                      </span>
                      {row.missingDays.length > 0 && (
                        <span className="team__member-missing">
                          {row.missingDays.length} missing {row.missingDays.length === 1 ? "day" : "days"}
                        </span>
                      )}
                    </th>
                    {weekDays.map((d) => {
                      const minutes = row.dayMinutes.get(d) ?? 0;
                      const missing = row.missingDays.includes(d);
                      return (
                        <td key={d} className={`team__cell ${missing ? "team__cell--missing" : ""} ${d === today ? "team__day--today" : ""}`}>
                          {minutes > 0 ? formatMinutes(minutes) : missing ? "—" : ""}
                        </td>
                      );
                    })}
                    <td className="team__cell team__cell--total">{row.totalMinutes > 0 ? formatMinutes(row.totalMinutes) : "—"}</td>
                  </tr>
                ))}
                {memberRows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={9} className="team__empty">No team entries this week.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {projectRollup.length > 0 && (
            <div className="team__rollup">
              <h3 className="team__rollup-title">Projects this week</h3>
              <ul className="team__rollup-list">
                {projectRollup.map((p) => (
                  <li key={p.projectId || "unassigned"} className="team__rollup-item">
                    <span className="team__rollup-dot" style={{ background: p.color }} />
                    <span className="team__rollup-name">{p.name}</span>
                    <span className="team__rollup-bar-track">
                      <span
                        className="team__rollup-bar"
                        style={{ width: `${Math.min(100, Math.max(2, Math.round((p.minutes / (rollupTotal || 1)) * 100)))}%`, background: p.color }}
                      />
                    </span>
                    <span className="team__rollup-minutes">{formatMinutes(p.minutes)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
};
