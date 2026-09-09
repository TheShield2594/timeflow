import React from "react";
import { formatMinutes } from "../hooks";
import { minutesBetween, minutesOfDay, clockAt } from "../utils/dates";
import type { BarSpan } from "../utils/dayBar";
import { DayBarTrack } from "./DayBar";
import { Sheet } from "./Sheet";

interface Props {
  /** Epoch ms of the last input the tab saw. */
  lastActiveAt: number;
  /** ISO instant the running session began. */
  startTime: string;
  onTrim: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}

/**
 * Three outcomes, three rows, and a bar that shows what each one does before
 * it is made.
 *
 * The old modal described the choice in prose and offered the same three
 * buttons in a row, which made "Discard" — the one that throws away tracked
 * time — the same weight as the other two and one slip away from them.
 */
export const IdleSheet: React.FC<Props> = ({ lastActiveAt, startTime, onTrim, onKeep, onDiscard }) => {
  const lastIso = new Date(lastActiveAt).toISOString();
  const nowIso = new Date().toISOString();
  const keptMinutes = Math.max(0, minutesBetween(startTime, lastIso));
  const idleMinutes = Math.max(0, minutesBetween(lastIso, nowIso));
  const totalMinutes = keptMinutes + idleMinutes;

  /**
   * The bar is built from minutes *elapsed since the session started*, not
   * from clock-face positions.
   *
   * `minutesOfDay` answers "where on a 24-hour dial", which stops increasing
   * at midnight: a session that began 23:30, went quiet at 23:40 and is now
   * 00:15 gives 1410, 1420 and 15, so the idle span collapses to zero width
   * and the bar claims the whole session was tracked — contradicting the
   * sentence directly above it, which is instant-based and correct. This
   * prompt fires *because* nothing has happened for a long time, so crossing
   * midnight is a normal case here rather than an edge one.
   */
  const workedEnd = keptMinutes;
  const idleEnd = keptMinutes + idleMinutes;

  const startMin = minutesOfDay(startTime);
  const lastMin = minutesOfDay(lastIso);
  const nowMin = minutesOfDay(nowIso);

  // A synthetic bar: one session split at the moment the input stopped, not
  // the shape of a whole day. The labels still read in clock time, which is
  // what the user recognises.
  const spans: BarSpan[] = [
    {
      key: "worked", startMin: 0, endMin: workedEnd, kind: "entry", accent: true,
      label: `Tracked ${clockAt(startMin)} to ${clockAt(lastMin)}`,
    },
    {
      key: "idle", startMin: workedEnd, endMin: idleEnd, kind: "gap", warn: true,
      label: `No input ${clockAt(lastMin)} to ${clockAt(nowMin)}`,
    },
  ];

  return (
    <Sheet label="The timer kept running while you were away" onClose={onKeep} narrow>
      <h2 className="t-title1">You stopped moving at {clockAt(lastMin)}</h2>
      <p className="sheet__meta t-body t-prose">
        The timer kept running for {formatMinutes(idleMinutes)} after that. Only you know whether that was work.
      </p>

      <div className="sheet__section">
        <DayBarTrack spans={spans} windowStart={0} windowEnd={Math.max(1, idleEnd)} small />
        <div className="span-legend">
          <span>{clockAt(startMin)} started</span>
          <span>{clockAt(lastMin)} last activity</span>
          <span>{clockAt(nowMin)} now</span>
        </div>
      </div>

      <div className="choice-list">
        <button type="button" className="choice choice--primary" onClick={onTrim}>
          Trim to {clockAt(lastMin)}
          <span className="choice__aside">keeps {formatMinutes(keptMinutes)}</span>
        </button>
        <button type="button" className="choice choice--tint" onClick={onKeep}>
          Keep all of it
          <span className="choice__aside">{formatMinutes(totalMinutes)}</span>
        </button>
        <button type="button" className="choice choice--danger" onClick={onDiscard}>
          Discard the entry
        </button>
      </div>
    </Sheet>
  );
};
