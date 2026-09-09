import React, { useMemo, useRef, useState } from "react";
import { clockAt } from "../utils/dates";
import type { Project, TimeEntry } from "../types";
import { formatMinutes } from "../hooks";
import { findUntrackedGaps, type Gap } from "../utils/gaps";
import { axisLabels, buildDaySpans, dayWindow, type BarSpan } from "../utils/dayBar";
import { indexById } from "../utils/entityIndex";
import type { WorkingHours } from "../hooks/useWorkingHours";

/** The smallest drag worth opening a sheet for. Below this it's a mis-click
 *  on a bar that is also, deliberately, a big click target. */
const MIN_DRAG_MINUTES = 15;

interface TrackProps {
  spans: BarSpan[];
  windowStart: number;
  windowEnd: number;
  small?: boolean;
  onFillGap?: (startMin: number, endMin: number) => void;
  onDragFill?: (startMin: number, endMin: number) => void;
}

/**
 * The bar itself: one flex track whose segments are proportional to minutes.
 *
 * `flex: <minutes>` rather than a percentage width so the 2px gaps between
 * segments come out of the track's own space instead of pushing the last
 * segment off the end.
 */
export const DayBarTrack: React.FC<TrackProps> = ({
  spans, windowStart, windowEnd, small, onFillGap, onDragFill,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const span = Math.max(1, windowEnd - windowStart);

  const minutesAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return windowStart;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    // Snap to the quarter hour: the bar is ten hours wide in a few hundred
    // pixels, so an unsnapped drag produces times like 13:07 that nobody
    // meant and everybody then has to correct in the sheet.
    return windowStart + Math.round((ratio * span) / 15) * 15;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onDragFill || e.button !== 0) return;
    const at = minutesAt(e.clientX);
    setDrag({ from: at, to: at });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag({ from: drag.from, to: minutesAt(e.clientX) });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const from = Math.min(drag.from, drag.to);
    const to = Math.max(drag.from, drag.to);
    setDrag(null);
    if (to - from >= MIN_DRAG_MINUTES) onDragFill?.(from, to);
  };

  const pct = (minutes: number) => `${((minutes / span) * 100).toFixed(3)}%`;

  return (
    <div className="day-bar__drag-wrap">
      <div
        ref={trackRef}
        className={`day-bar__track${small ? " day-bar__track--sm" : ""}${onDragFill ? " day-bar--drag" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        {spans.length === 0 && <span className="day-bar__empty" />}
        {spans.map((s) => {
          const flex = { flex: `${Math.max(1, s.endMin - s.startMin)} 0 0%` } as React.CSSProperties;
          if (s.kind === "entry") {
            const style = { ...flex, "--pc": s.color } as React.CSSProperties;
            const cls = s.accent
              ? "day-bar__seg day-bar__seg--accent"
              : s.running
                ? "day-bar__seg day-bar__seg--running"
                : "day-bar__seg";
            return <span key={s.key} className={cls} style={style} title={s.label} />;
          }
          if (s.kind === "gap" && onFillGap) {
            return (
              <button
                key={s.key}
                type="button"
                className={`day-bar__seg day-bar__seg--gap${s.warn ? " day-bar__seg--gap-warn" : ""}`}
                style={flex}
                title={`${s.label} — click to fill it in`}
                aria-label={`Log the untracked time from ${clockAt(s.startMin)} to ${clockAt(s.endMin)}`}
                onClick={() => onFillGap(s.startMin, s.endMin)}
              />
            );
          }
          const cls = s.kind === "gap"
            ? `day-bar__seg day-bar__seg--gap${s.warn ? " day-bar__seg--gap-warn" : ""}`
            : "day-bar__seg day-bar__seg--idle";
          return <span key={s.key} className={cls} style={flex} title={s.label} />;
        })}
      </div>
      {drag && Math.abs(drag.to - drag.from) >= MIN_DRAG_MINUTES && (
        <span
          className="day-bar__selection"
          style={{
            left: pct(Math.min(drag.from, drag.to) - windowStart),
            width: pct(Math.abs(drag.to - drag.from)),
          }}
        />
      )}
    </div>
  );
};

interface Props {
  /** Entries already narrowed to `date`. */
  entries: TimeEntry[];
  projects: Project[];
  date: string;
  /** Minutes since local midnight, used to close out a running entry. */
  nowMinutes: number;
  workingHours: WorkingHours;
  /** Cap the gap search — pass nowMinutes for today so the rest of the day
   *  isn't offered as a hole before it has happened. */
  upperBoundMin?: number;
  runningEntryId?: string;
  accentEntryId?: string;
  warnGaps?: boolean;
  small?: boolean;
  showAxis?: boolean;
  onFillGap?: (startMin: number, endMin: number) => void;
  onDragFill?: (startMin: number, endMin: number) => void;
}

/**
 * One day as a shape, before it is a number.
 *
 * Untracked gaps are segments in the *same* track as the work, at the same
 * scale, because a hole in a timesheet is exactly as long as it is — drawing
 * it anywhere else lets it read as smaller than it is.
 */
export const DayBar: React.FC<Props> = ({
  entries, projects, date, nowMinutes, workingHours, upperBoundMin,
  runningEntryId, accentEntryId, warnGaps, small, showAxis = true,
  onFillGap, onDragFill,
}) => {
  const projectById = useMemo(() => indexById(projects), [projects]);

  const { spans, window, gaps } = useMemo(() => {
    const win = dayWindow(entries, date, nowMinutes, workingHours.startMin, workingHours.endMin);
    const found: Gap[] = findUntrackedGaps({
      entries, date, nowMinutes, upperBoundMin,
      workDayStartMin: workingHours.startMin,
      workDayEndMin: workingHours.endMin,
      gapMustExceedMinutes: workingHours.gapMustExceedMinutes,
    });
    return {
      window: win,
      gaps: found,
      spans: buildDaySpans({
        entries, projects, date, nowMinutes, window: win, gaps: found,
        runningEntryId, accentEntryId, warnGaps,
        // The length in a segment's label describes the *drawn* span, which
        // is what the reader is pointing at; totals shown beside the bar come
        // from stored durations instead.
        describeEntry: (entry, startMin, endMin) => {
          const project = projectById.get(entry.projectId);
          return `${entry.description || project?.name || "Tracked time"} · ${clockAt(startMin)}–${clockAt(endMin)} · ${formatMinutes(endMin - startMin)}`;
        },
      }),
    };
  }, [entries, projects, projectById, date, nowMinutes, workingHours, upperBoundMin, runningEntryId, accentEntryId, warnGaps]);

  const hasContent = spans.some((s) => s.kind === "entry");

  return (
    <div className="day-bar">
      <DayBarTrack
        spans={hasContent || gaps.length > 0 ? spans : []}
        windowStart={window.startMin}
        windowEnd={window.endMin}
        small={small}
        onFillGap={onFillGap}
        onDragFill={onDragFill}
      />
      {showAxis && (
        <div className="day-bar__axis" aria-hidden="true">
          {axisLabels(window).map((label, i) => <span key={i}>{label}</span>)}
        </div>
      )}
      {/* The segments are positioned spans whose only labels are pointer-only
          tooltips, so the same reading is spelled out for anyone not using a
          pointer. The gap segments need no equivalent — they're real buttons
          with their own accessible names. */}
      {hasContent && (
        <ul className="visually-hidden">
          {spans.filter((s) => s.kind === "entry").map((s) => <li key={s.key}>{s.label}</li>)}
        </ul>
      )}
    </div>
  );
};
