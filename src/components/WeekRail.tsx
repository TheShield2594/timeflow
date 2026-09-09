import React, { useState } from "react";
import { formatMinutes } from "../hooks";
import { paceSentence } from "../utils/pace";
import { Pill } from "./Pill";

const SIZE = 118;
const VIEW = 140;
const RADIUS = 58;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const DAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

/** A week has 168 of them; the input says so and the commit path agrees. */
const MAX_TARGET_HOURS = 168;

interface Props {
  /** Minutes tracked per weekday, Monday first. */
  dailyMinutes: number[];
  weekMinutes: number;
  targetHours: number;
  /** 0 = Monday … 6 = Sunday. -1 when the week being shown isn't this one. */
  todayIndex: number;
  onSetTarget: (hours: number) => void;
}

/**
 * The week, as one ring and one sentence.
 *
 * This replaces a three-card KPI strip that said the same thing three ways —
 * today, this week, and a target ring — plus a day-streak counter that
 * gamified compliance in a billing app. What's left answers the only question
 * the strip was ever asked: am I going to make it.
 */
export const WeekRail: React.FC<Props> = ({ dailyMinutes, weekMinutes, targetHours, todayIndex, onSetTarget }) => {
  const [editing, setEditing] = useState<string | null>(null);

  const targetMinutes = targetHours * 60;
  const ratio = targetMinutes > 0 ? Math.min(1, weekMinutes / targetMinutes) : 0;
  const pace = paceSentence(weekMinutes, targetHours, todayIndex < 0 ? 6 : todayIndex);
  const peak = Math.max(...dailyMinutes, 1);

  const commit = () => {
    if (editing === null) return;
    const hours = Number(editing);
    // Clamped to the bounds the input itself declares. Without this a typed
    // 1000 was accepted and stored, and the ring then reported a percentage
    // against a target the control says is invalid.
    if (Number.isFinite(hours) && hours > 0) onSetTarget(Math.min(hours, MAX_TARGET_HOURS));
    setEditing(null);
  };

  return (
    <div className="week-rail">
      <div className="t-group-label t-secondary">This week</div>

      <div className="week-rail__ring-row">
        <svg className="week-rail__ring" width={SIZE} height={SIZE} viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true">
          <circle className="week-rail__track" cx={VIEW / 2} cy={VIEW / 2} r={RADIUS} fill="none" strokeWidth={14} />
          <circle
            className="week-rail__fill"
            cx={VIEW / 2} cy={VIEW / 2} r={RADIUS}
            fill="none" strokeWidth={14} strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE * ratio} ${CIRCUMFERENCE}`}
            transform={`rotate(-90 ${VIEW / 2} ${VIEW / 2})`}
          />
        </svg>
        <div>
          <div className="t-title1">{formatMinutes(weekMinutes)}</div>
          {targetHours > 0 ? (
            <button type="button" className="week-rail__set-target" onClick={() => setEditing(String(targetHours))}>
              of {targetHours}h · {Math.round(ratio * 100)}%
            </button>
          ) : editing === null ? (
            <button type="button" className="week-rail__set-target" onClick={() => setEditing("40")}>
              Set a weekly target
            </button>
          ) : null}
        </div>
      </div>

      {editing !== null && (
        <div className="week-rail__target-edit">
          <input
            className="input input--time"
            type="number" min="1" max={MAX_TARGET_HOURS} step="0.5"
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(null);
            }}
            aria-label="Weekly target hours"
            autoFocus
          />
          <Pill size="inline" onClick={commit}>Save</Pill>
          <Pill size="inline" tone="quiet" onClick={() => setEditing(null)}>Cancel</Pill>
        </div>
      )}

      {pace && <p className="week-rail__pace t-subhead">{pace.text}</p>}

      <div className="week-rail__bars" aria-hidden="true">
        {dailyMinutes.map((minutes, i) => (
          <span
            key={i}
            className={`week-rail__bar${minutes === 0 ? " week-rail__bar--empty" : ""}${i === todayIndex ? " week-rail__bar--today" : ""}`}
            /* Today's bar is drawn at its real height and faded, because the
               day isn't over: shortening it would report less time than was
               actually tracked. */
            style={{ height: minutes === 0 ? "6%" : `${Math.max(8, (minutes / peak) * 100)}%` }}
          />
        ))}
      </div>
      <div className="week-rail__labels">
        {DAY_INITIALS.map((initial, i) => (
          <span key={i} className={i === todayIndex ? "week-rail__label--today" : undefined}>{initial}</span>
        ))}
      </div>
      <ul className="visually-hidden">
        {dailyMinutes.map((minutes, i) => (
          <li key={i}>{DAY_INITIALS[i]}: {formatMinutes(minutes)}</li>
        ))}
      </ul>
    </div>
  );
};
