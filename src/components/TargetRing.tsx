import React, { useState } from "react";
import { formatMinutes } from "../hooks";
import { IconCheck, IconPencil, IconX } from "./Icons";

const SIZE = 78;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface Props {
  weekMinutes: number;
  targetHours: number;
  onSetTarget: (hours: number) => void;
}

/** Weekly target as a ring, sat next to the today strip on Overview — the
 *  progress meter used to live only on the Calendar header, which is not
 *  where anyone lands. */
export const TargetRing: React.FC<Props> = ({ weekMinutes, targetHours, onSetTarget }) => {
  const [editing, setEditing] = useState<string | null>(null);

  const commit = () => {
    if (editing === null) return;
    const hours = Number(editing);
    if (Number.isFinite(hours) && hours > 0) onSetTarget(hours);
    setEditing(null);
  };

  if (editing !== null) {
    return (
      <div className="target-ring target-ring--editing">
        <label className="target-ring__label" htmlFor="target-ring-input">Weekly target</label>
        <div className="week-target-editor">
          <input
            id="target-ring-input"
            className="week-target-editor__input"
            type="number"
            min="1"
            max="168"
            step="0.5"
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(null);
            }}
            aria-label="Weekly target hours"
            autoFocus
          />
          <button className="week-target-editor__ok" onClick={commit} aria-label="Save weekly target">
            <IconCheck size={14} />
          </button>
          <button className="week-target-editor__cancel" onClick={() => setEditing(null)} aria-label="Cancel">
            <IconX size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (targetHours <= 0) {
    return (
      <div className="target-ring">
        <button className="week-target-set" onClick={() => setEditing("40")}>
          Set a weekly target
        </button>
      </div>
    );
  }

  const targetMinutes = targetHours * 60;
  const ratio = Math.min(1, weekMinutes / targetMinutes);
  const met = weekMinutes >= targetMinutes;

  return (
    <div className="target-ring">
      <div className="target-ring__dial">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <circle
            className="target-ring__track"
            cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
            fill="none" strokeWidth={STROKE}
          />
          <circle
            className={`target-ring__fill${met ? " target-ring__fill--met" : ""}`}
            cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
            fill="none" strokeWidth={STROKE} strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE * ratio} ${CIRCUMFERENCE}`}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </svg>
        <span className="target-ring__pct">{Math.round(ratio * 100)}%</span>
      </div>
      <div className="target-ring__meta">
        <span className="target-ring__label">Weekly target</span>
        <span className="target-ring__value">
          {formatMinutes(weekMinutes)} / {targetHours}h
        </span>
      </div>
      <button
        className="target-ring__edit"
        onClick={() => setEditing(String(targetHours))}
        aria-label="Edit weekly target"
        title="Edit weekly target"
      >
        <IconPencil size={13} />
      </button>
    </div>
  );
};
