import React, { useMemo, useState } from "react";
import type { TeamContext, TeamEntry } from "../services/teamService";
import { hasNoReportRows, useTeamEntries } from "../hooks/useTeam";
import { formatMinutes } from "../hooks";
import { useData } from "../contexts/DataContext";
import { addDaysStr, localDateStr, weekStartStr } from "../utils/dates";
import { rangeLabel } from "../utils/ranges";
import { exportToCSV, ROUNDING_LABELS, type RoundingRule } from "../services/csvExport";
import { SegmentedControl } from "./SegmentedControl";
import { FloatingActionBar } from "./FloatingActionBar";
import { Pill } from "./Pill";

const PAGE_SIZE = 9;
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

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

type Scope = "direct" | "hierarchy";

interface MemberRow {
  id: string;
  name: string;
  isSelf: boolean;
  isDirect: boolean;
  dayMinutes: Map<string, number>;
  totalMinutes: number;
  missingDays: string[];
}

interface Props {
  teamContext: TeamContext;
}

/**
 * The manager view: one row per person, five bars each, sorted by hours.
 *
 * Sorted *descending* so the person with the least logged lands at the bottom
 * of the list, next to the pagination — the end of a list is where a reader
 * stops, and they are the row the page exists for.
 *
 * Bars here are the accent rather than a project colour: they encode hours per
 * person, and a person is not a project. Totals only — no descriptions, no
 * tickets. What a manager needs is whether the week is accounted for, not what
 * anybody wrote in a field.
 */
export const TeamPage: React.FC<Props> = ({ teamContext }) => {
  const { projects, tasks } = useData();
  const today = localDateStr();
  const [weekStart, setWeekStart] = useState(() => weekStartStr(today));
  const [scope, setScope] = useState<Scope>("direct");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [rounding, setRounding] = useState<RoundingRule>(readStoredRounding);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i)), [weekStart]);
  const weekEnd = weekDays[6];

  const { entries, loading, error, truncated, refresh } = useTeamEntries(weekStart, weekEnd, teamContext);

  const rows = useMemo<MemberRow[]>(() => {
    const directIds = new Set(teamContext.reports.map((m) => m.id));
    const byOwner = new Map<string, { name: string; entries: TeamEntry[] }>();
    // Reports first, so somebody with nothing logged still gets a row — that
    // silence is exactly what this page exists to show.
    teamContext.reports.forEach((m) => byOwner.set(m.id, { name: m.name, entries: [] }));
    entries.forEach((e) => {
      if (!e.ownerId) return;
      const bucket = byOwner.get(e.ownerId);
      if (bucket) bucket.entries.push(e);
      // Includes the manager themself and, at hierarchy depth > 1, indirect
      // reports — anyone whose rows the server said we may see.
      else byOwner.set(e.ownerId, { name: e.ownerName || "Unknown user", entries: [e] });
    });

    const out: MemberRow[] = [];
    byOwner.forEach(({ name, entries: memberEntries }, id) => {
      const dayMinutes = new Map<string, number>();
      memberEntries.forEach((e) => {
        // Open (running) entries carry no duration yet.
        if (!e.endTime) return;
        dayMinutes.set(e.date, (dayMinutes.get(e.date) || 0) + (e.durationMinutes || 0));
      });
      const isSelf = id === teamContext.myUserId;
      // Missing = a weekday of this week already past (or today) with nothing
      // logged. The manager's own row isn't flagged — this page is about the
      // team, and their own gaps show on their own screens.
      const missingDays = isSelf
        ? []
        : weekDays.filter((d, i) => i < 5 && d <= today && !(dayMinutes.get(d) ?? 0));
      out.push({
        id, name, isSelf,
        isDirect: directIds.has(id),
        dayMinutes,
        totalMinutes: [...dayMinutes.values()].reduce((sum, n) => sum + n, 0),
        missingDays,
      });
    });
    return out.sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [entries, teamContext, weekDays, today]);

  const directCount = rows.filter((r) => r.isDirect).length;
  const lineCount = rows.length;

  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (scope === "direct" ? r.isDirect : true))
      .filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [rows, scope, search]);

  const shown = scoped.slice(0, visible);
  const hidden = scoped.length - shown.length;
  const teamTotal = scoped.reduce((sum, r) => sum + r.totalMinutes, 0);
  const peak = Math.max(...scoped.flatMap((r) => [...r.dayMinutes.values()]), 1);
  const loggedPeople = scoped.filter((r) => r.totalMinutes > 0).length;
  const todayIndex = weekDays.indexOf(today);

  // Names but no rows: worth its own line, because the manager reading it is
  // the one person who can tell "nobody logged anything" from "I am not being
  // shown what they logged", and the admin who can fix the second needs to be
  // told which it was.
  const noReportRows = !loading && !error && hasNoReportRows(entries, teamContext, weekStart, today);

  const handleExport = () => {
    // `ownerName` (not `userDisplayName`) is the reliable per-row owner — see
    // teamService's FormattedValue-annotation fallback — so the CSV's "User"
    // column reflects who actually logged each row.
    const exportEntries = entries.map((e) => ({ ...e, userDisplayName: e.ownerName }));
    exportToCSV(exportEntries, projects, tasks, `timeflow-team-${weekStart}-to-${weekEnd}.csv`, rounding);
  };

  const setRoundingRule = (rule: RoundingRule) => {
    setRounding(rule);
    try { localStorage.setItem(TEAM_ROUNDING_STORAGE_KEY, rule); } catch { /* in-memory only */ }
  };

  return (
    <>
      <div className="page__head">
        <h1 className="page__title t-large-title">Team</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span className="t-subhead t-secondary">{rangeLabel(weekStart, weekEnd)}</span>
          <div className="calendar__nav">
            <button className="cal-nav-btn" onClick={() => setWeekStart(addDaysStr(weekStart, -7))} aria-label="Previous week">‹</button>
            <button className="cal-nav-btn cal-nav-btn--today" onClick={() => setWeekStart(weekStartStr(today))}>This week</button>
            <button className="cal-nav-btn" onClick={() => setWeekStart(addDaysStr(weekStart, 7))} aria-label="Next week">›</button>
          </div>
        </div>
      </div>

      <div className="team__headline">
        <span className="t-display">{formatMinutes(teamTotal)}</span>
        <span className="t-body t-secondary">
          logged by {loggedPeople} {loggedPeople === 1 ? "person" : "people"}
          {weekStart === weekStartStr(today) ? " so far this week" : " that week"}
        </span>
      </div>

      <div className="page__toolbar">
        <SegmentedControl
          ariaLabel="Which reports to show"
          value={scope}
          onChange={(next) => { setScope(next); setVisible(PAGE_SIZE); }}
          options={[
            { value: "direct", label: `Direct ${directCount}` },
            { value: "hierarchy", label: `Whole line ${lineCount}` },
          ]}
        />
        <div className="page__toolbar-right">
          <input
            className="search"
            placeholder="Search people"
            aria-label="Search people"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setVisible(PAGE_SIZE); }}
          />
        </div>
      </div>

      {error ? (
        <div className="empty">
          <div className="empty__title t-title2">Couldn&rsquo;t read your team&rsquo;s time</div>
          <p className="empty__body t-body">{error}</p>
          <button type="button" className="empty__action" onClick={refresh}>Try again</button>
        </div>
      ) : loading ? (
        <div className="skeleton-stack" aria-hidden="true" style={{ marginTop: 24 }}>
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 40 }} />)}
        </div>
      ) : (
        <>
          <div className="team__grid-head" style={{ marginTop: 24 }}>
            <span />
            {WEEKDAY_LABELS.map((label, i) => (
              <span key={label} className={`team__col-label${i === todayIndex ? " team__col-label--today" : ""}`}>
                {label}
              </span>
            ))}
            <span className="team__col-label team__col-label--week">Week</span>
          </div>

          {shown.map((row) => (
            <div key={row.id} className="team__row">
              <span className="team__name">
                <span className="team__name-text">{row.name}{row.isSelf ? " (you)" : ""}</span>
                {row.missingDays.length > 0 && (
                  <span className="chip chip--warn">
                    {row.missingDays.length} missing
                  </span>
                )}
              </span>
              {weekDays.slice(0, 5).map((date, i) => {
                const minutes = row.dayMinutes.get(date) ?? 0;
                const missing = row.missingDays.includes(date);
                const cls = missing
                  ? "team__bar team__bar--missing"
                  : minutes === 0
                    ? "team__bar team__bar--empty"
                    : `team__bar${date === today ? " team__bar--today" : ""}`;
                return (
                  <span key={date} className="team__bar-box">
                    <span
                      className={cls}
                      style={{ height: missing ? "40%" : minutes === 0 ? "9%" : `${Math.max(10, (minutes / peak) * 100)}%` }}
                      title={`${WEEKDAY_LABELS[i]}: ${formatMinutes(minutes)}`}
                    />
                  </span>
                );
              })}
              <span className="team__week">{formatMinutes(row.totalMinutes)}</span>
            </div>
          ))}

          {hidden > 0 && (
            <button type="button" className="team__more" onClick={() => setVisible((n) => n + PAGE_SIZE)}>
              Show {hidden} more
            </button>
          )}

          {scoped.length === 0 && (
            <div className="empty">
              <div className="empty__title t-title2">Nobody matches that</div>
              <p className="empty__body t-body">Try a shorter search, or switch to the whole line.</p>
            </div>
          )}

          <p className="team__note">
            Hierarchy security decides who appears here — the page never widens the read.
            Totals only; no descriptions, no tickets.
            {noReportRows && " Your reports' names resolved but none of their rows came back, which is either a quiet week or a read this app isn't permitted."}
            {truncated && ` ${truncated}`}
          </p>
        </>
      )}

      <FloatingActionBar
        hint={
          <label>
            Rounding ·{" "}
            <select
              className="field-row__select"
              value={rounding}
              onChange={(e) => setRoundingRule(e.target.value as RoundingRule)}
              aria-label="Rounding applied to exported durations"
            >
              {(Object.keys(ROUNDING_LABELS) as RoundingRule[]).map((rule) => (
                <option key={rule} value={rule}>{ROUNDING_LABELS[rule].toLowerCase()}</option>
              ))}
            </select>
          </label>
        }
      >
        <Pill tone="primary" onClick={handleExport} disabled={entries.length === 0}>Export CSV</Pill>
      </FloatingActionBar>
    </>
  );
};
