/**
 * The one sentence the week rail says out loud.
 *
 * The ring already reports the number; a percentage is not advice. What a
 * person actually wants to know on a Tuesday afternoon is whether they can
 * stop worrying about it, and the honest answer depends on how much of the
 * week is left — which is why this is arithmetic rather than a label.
 *
 * Deliberately not a streak, a score or a nudge: this is a billing app, and
 * the target is a plan, not a rule somebody is being marked against.
 */
import { formatMinutes } from "../hooks/formatters";

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Working days assumed to carry the weekly target — Monday to Friday. */
const WORKING_DAYS = 5;

export interface Pace {
  text: string;
  /** True once the target is met, so the rail can stop giving advice. */
  met: boolean;
}

/**
 * @param weekMinutes  Tracked so far this week.
 * @param targetHours  The user's weekly target; 0 when unset.
 * @param dayIndex     0 = Monday … 6 = Sunday, for the day being viewed.
 */
export function paceSentence(weekMinutes: number, targetHours: number, dayIndex: number): Pace | null {
  if (targetHours <= 0) return null;
  const target = targetHours * 60;
  if (weekMinutes >= target) {
    const over = weekMinutes - target;
    return {
      met: true,
      text: over > 0
        ? `Target met, ${formatMinutes(over)} past it.`
        : "Target met.",
    };
  }

  const remaining = target - weekMinutes;
  // Weekend days count as a full week elapsed: by Saturday the plan was for
  // all of it to be done.
  const elapsed = Math.min(WORKING_DAYS, dayIndex + 1);
  const expected = (target * elapsed) / WORKING_DAYS;
  const daysLeft = WORKING_DAYS - elapsed;

  if (weekMinutes >= expected) {
    if (daysLeft <= 0) return { met: false, text: `On pace. ${formatMinutes(remaining)} left this week.` };
    if (daysLeft === 1) return { met: false, text: `On pace. ${formatMinutes(remaining)} left on Friday.` };
    return {
      met: false,
      text: `On pace. ${formatMinutes(remaining)} left across ${WEEKDAY_NAMES[dayIndex + 1]} to Friday.`,
    };
  }
  return {
    met: false,
    text: `Behind pace for a ${WEEKDAY_NAMES[dayIndex]}. ${formatMinutes(remaining)} left this week.`,
  };
}
