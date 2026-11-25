import React from "react";
import type { TimerState } from "../types";
import { formatElapsed } from "../hooks/formatters";
import { useElapsed } from "../hooks/useElapsed";
import { DEFAULT_PROJECT_COLOR } from "../utils/colors";

interface Props {
  timer: TimerState;
  /** The running session's project colour, if the project is loaded. */
  projectColor?: string;
}

/**
 * The running timer, as seen from every other page (#203).
 *
 * Off the Timer page nothing used to say a session was open, and a forgotten
 * one was caught only by the 12-hour auto-stop. This sits inside the sidebar's
 * Timer item: the project's dot — it is that project's time accruing, so the
 * project's colour is the honest colour for it — and the elapsed clock.
 *
 * It is its own component so the 1 Hz tick re-renders this span and nothing
 * else; the shell above it must not tick (#95).
 *
 * A stop whose save failed is the more urgent state, so it replaces the clock
 * with "Not saved" in the warning colour rather than freezing the digits: the
 * frozen digits look like a running timer that has stalled.
 */
export const TimerNavStatus: React.FC<Props> = ({ timer, projectColor }) => {
  const elapsed = useElapsed(timer.startTime, timer.isRunning);
  if (timer.pendingStopAt) {
    return <span className="sidebar__timer sidebar__timer--warn">Not saved</span>;
  }
  if (!timer.isRunning || !timer.startTime) return null;
  return (
    <span className="sidebar__timer">
      <span className="dot dot--sm" style={{ "--pc": projectColor || DEFAULT_PROJECT_COLOR } as React.CSSProperties} />
      {/* The digits change every second, so they stay out of the button's
          accessible name: a name that changes underneath a screen reader is
          re-read on every focus. "running" is the fact worth announcing. The
          comma is what separates it from the label: name computation trims
          each piece's whitespace, so a leading space reads "Timerrunning". */}
      <span className="visually-hidden">, running</span>
      <span aria-hidden="true">{formatElapsed(elapsed)}</span>
    </span>
  );
};
