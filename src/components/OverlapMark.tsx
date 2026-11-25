import React from "react";
import { formatMinutes } from "../hooks/formatters";

/**
 * The quiet mark beside a day total that counts some time twice (#206).
 *
 * A total sums durations, so two entries over the same hour add two hours to
 * it — legal, and sometimes true, but never something to leave unsaid on the
 * number people bill from. This says by how much the total overstates the
 * time that passed, in the warning colour, and nothing more: the entries
 * themselves are where the user decides what to do about it.
 */
export const OverlapMark: React.FC<{ minutes: number; className?: string }> = ({ minutes, className }) => {
  if (minutes <= 0) return null;
  const amount = formatMinutes(minutes);
  return (
    <span
      className={`overlap-mark${className ? ` ${className}` : ""}`}
      title={`${amount} of this total is entries overlapping each other, counted twice`}
    >
      <span className="visually-hidden">, including </span>
      {amount} overlap
    </span>
  );
};
