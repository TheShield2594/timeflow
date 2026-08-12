import React, { useMemo } from "react";
import type { TimeEntry, Project } from "../types";
import { formatMinutes } from "../hooks";
import { minutesOfDay } from "../utils/dates";
import { WORK_DAY_START_MIN, WORK_DAY_END_MIN, findUntrackedGaps } from "../utils/gaps";

interface Block {
  start: number;
  end: number;
  color: string;
  label: string;
}

interface Props {
  /** Entries already filtered to today. */
  entries: TimeEntry[];
  projects: Project[];
  /** Today, as local YYYY-MM-DD. */
  date: string;
  /** Minutes since midnight, used to close out a still-running entry. */
  nowMinutes: number;
  /** Called with the gap's start/end minutes-of-day when a gap is clicked. */
  onLogGap: (startMinutes: number, endMinutes: number) => void;
}

export function formatClock(minutes: number): string {
  const total = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Today at a glance: logged blocks laid out on a clock, with every untracked
 *  gap between them offered as a one-click "log this" target. The landing
 *  screen's one actionable element — the rest of Overview reports history. */
export const TodayStrip: React.FC<Props> = ({ entries, projects, date, nowMinutes, onLogGap }) => {
  const { blocks, gaps, windowStart, windowEnd, trackedMinutes } = useMemo(() => {
    // Clock-face positions for drawing, clipped to the day. The length in
    // each label describes the *drawn* span, which is what the reader is
    // looking at; the "tracked" total below comes from stored durations, the
    // only elapsed-time figure here (#87).
    const raw: Block[] = entries
      .map((e) => {
        const start = Math.max(0, Math.min(24 * 60, minutesOfDay(e.startTime)));
        // A running entry ends "now"; one that ran past midnight is clipped to
        // the end of the day rather than wrapping round to a negative width.
        const rawEnd = e.endTime ? minutesOfDay(e.endTime) : nowMinutes;
        const end = rawEnd <= start ? 24 * 60 : Math.min(24 * 60, rawEnd);
        const project = projects.find((p) => p.id === e.projectId);
        return {
          start,
          end,
          color: project?.color || "#6366f1",
          label: `${project?.name || "Untracked project"} · ${formatClock(start)}–${formatClock(end)} · ${formatMinutes(end - start)}`,
        };
      })
      .sort((a, b) => a.start - b.start);

    // Same detector the Calendar draws its gap slots from, capped at now so
    // the rest of today isn't offered before it has happened.
    const foundGaps = findUntrackedGaps({ entries, date, nowMinutes, upperBoundMin: nowMinutes });

    // The strip always spans at least the working day, and stretches to fit
    // anything logged outside it.
    const earliest = raw.length > 0 ? Math.min(...raw.map((b) => b.start)) : WORK_DAY_START_MIN;
    const latest = raw.length > 0 ? Math.max(...raw.map((b) => b.end)) : WORK_DAY_END_MIN;
    const start = Math.min(WORK_DAY_START_MIN, Math.floor(earliest / 60) * 60);
    const end = Math.max(WORK_DAY_END_MIN, Math.ceil(latest / 60) * 60);

    return {
      blocks: raw,
      gaps: foundGaps,
      windowStart: start,
      windowEnd: end,
      trackedMinutes: entries.reduce((s, e) => s + (e.durationMinutes || 0), 0),
    };
  }, [entries, projects, date, nowMinutes]);

  const span = Math.max(1, windowEnd - windowStart);
  const pct = (minutes: number) => `${((minutes / span) * 100).toFixed(3)}%`;
  const offset = (minutes: number) => pct(minutes - windowStart);
  const midpoint = windowStart + Math.round(span / 2);

  return (
    <div className="today-strip">
      <div className="today-strip__summary">
        <span className="today-strip__summary-label">Today</span>
        <span className="today-strip__summary-sep" aria-hidden="true">·</span>
        <span className="num-card today-strip__tracked">{formatMinutes(trackedMinutes)}</span>
        <span className="today-strip__summary-label">tracked</span>
        {gaps.length > 0 && (
          <>
            <span className="today-strip__summary-sep" aria-hidden="true">·</span>
            <span className="today-strip__summary-label">
              {gaps.length} {gaps.length === 1 ? "gap" : "gaps"}
            </span>
          </>
        )}
      </div>

      <div className="today-strip__track">
        {blocks.map((b, i) => (
          <div
            key={`block-${i}`}
            className="today-strip__block"
            style={{ left: offset(b.start), width: pct(b.end - b.start), background: b.color }}
            title={b.label}
          />
        ))}
        {gaps.map((g) => (
          <button
            key={`gap-${g.startMin}`}
            type="button"
            className="today-strip__gap"
            style={{ left: offset(g.startMin), width: pct(g.endMin - g.startMin) }}
            onClick={() => onLogGap(g.startMin, g.endMin)}
            title={`${formatMinutes(g.endMin - g.startMin)} untracked between ${formatClock(g.startMin)} and ${formatClock(g.endMin)} — click to fill it in`}
            aria-label={`Log the untracked ${formatMinutes(g.endMin - g.startMin)} from ${formatClock(g.startMin)} to ${formatClock(g.endMin)}`}
          >
            <span className="today-strip__gap-label">+ {formatMinutes(g.endMin - g.startMin)}</span>
          </button>
        ))}
      </div>

      <div className="today-strip__axis" aria-hidden="true">
        <span>{formatClock(windowStart)}</span>
        <span>{formatClock(midpoint)}</span>
        <span>{formatClock(windowEnd)}</span>
      </div>

      {/* The blocks are positioned divs whose only labels are mouse-only
          tooltips, so the same reading is spelled out here (the gaps need no
          equivalent — they're real buttons with their own labels). */}
      {blocks.length > 0 && (
        <ul className="sr-only">
          {blocks.map((b, i) => (
            <li key={`sr-${i}`}>{b.label}</li>
          ))}
        </ul>
      )}

      {blocks.length === 0 && (
        <p className="today-strip__empty">Nothing logged today yet — start the timer above.</p>
      )}
    </div>
  );
};
