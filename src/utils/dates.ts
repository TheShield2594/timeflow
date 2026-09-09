/**
 * Local-timezone date helpers.
 *
 * Never use `new Date().toISOString().split("T")[0]` for calendar dates:
 * toISOString() is UTC, so for users west of UTC "today" flips to tomorrow
 * in the evening, putting entries on the wrong day. Everything that needs a
 * YYYY-MM-DD key derives it from the *local* clock via these helpers.
 */

/** Minutes on a 24-hour clock face. Not the length of every day — see
 *  `dayLengthMinutes`. */
export const MINUTES_PER_DAY = 24 * 60;

/**
 * The locale every date in the app is formatted in.
 *
 * Day-first — "Tuesday 8 September", "31 August – 6 September" — rather than
 * the month-first ordering an "en" locale produces. It reads unambiguously
 * beside the 24-hour clock the rest of the app uses, and it is one decision
 * in one place rather than an argument object repeated in nine files.
 */
export const DATE_LOCALE = "en-GB";

export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** dateStr + n days as YYYY-MM-DD, walked on the local calendar. Use this
 *  instead of adding 24h of milliseconds, which lands an hour off on DST
 *  transition days. */
export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

export function localDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateStr(d);
}

export function friendlyDate(dateStr: string): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dateStr === localDateStr(today)) return "Today";
  if (dateStr === localDateStr(yesterday)) return "Yesterday";
  return new Date(dateStr + "T00:00:00").toLocaleDateString(DATE_LOCALE, {
    weekday: "long", day: "numeric", month: "long",
  });
}

/** Monday of the week containing the given local YYYY-MM-DD date string. */
export function weekStartStr(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDateStr(d);
}

/** "HH:MM" for <input type="time">, from an ISO timestamp, in local time. */
export function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Minutes since local midnight for an ISO timestamp.
 *
 * This is a *wall-clock* reading — where a timestamp sits on a 24-hour clock
 * face — and on a DST transition day it is not interchangeable with elapsed
 * time: a 23-hour day's clock still runs 0→1440, and a 25-hour day's runs
 * past two 01:00s. Use it for geometry (which row a block is drawn in) and
 * never subtract two of these to produce a `durationMinutes` — that is what
 * `minutesBetween` is for (#87).
 */
export function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * The instant at `minutes` past local midnight on `dateStr`.
 *
 * Minutes at or beyond a day roll onto later calendar days (1440 is the
 * following midnight), walked on the local calendar rather than by adding
 * 24h of milliseconds — an hour off across a transition.
 *
 * On a spring-forward day the requested wall clock may not exist (there is
 * no 02:30 on the day the clocks jump 02:00 → 03:00); the platform
 * normalizes those forward to the same instant as 03:30. That collapse is
 * exactly why durations must come from `minutesBetween` on the resulting
 * instants and never from subtracting the minutes-of-day that produced them.
 */
export function dateAtMinutes(dateStr: string, minutes: number): Date {
  const dayOffset = Math.floor(minutes / MINUTES_PER_DAY);
  const rest = minutes - dayOffset * MINUTES_PER_DAY;
  const base = dayOffset === 0 ? dateStr : addDaysStr(dateStr, dayOffset);
  const h = String(Math.floor(rest / 60)).padStart(2, "0");
  const m = String(rest % 60).padStart(2, "0");
  return new Date(`${base}T${h}:${m}:00`);
}

/** `dateAtMinutes` as a storable ISO timestamp. */
export function isoAtMinutes(dateStr: string, minutes: number): string {
  return dateAtMinutes(dateStr, minutes).toISOString();
}

/** Elapsed minutes between two instants — real time, so it stays honest on
 *  the days that are 23 or 25 hours long. This is the only correct source of
 *  a `durationMinutes` value. */
export function minutesBetween(start: string | Date, end: string | Date): number {
  const a = start instanceof Date ? start : new Date(start);
  const b = end instanceof Date ? end : new Date(end);
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

/** Elapsed minutes in a local calendar day: 1440 normally, 1380 or 1500 on
 *  the days the clocks move. */
export function dayLengthMinutes(dateStr: string): number {
  return minutesBetween(dateAtMinutes(dateStr, 0), dateAtMinutes(dateStr, MINUTES_PER_DAY));
}

/**
 * "HH:MM" on a 24-hour clock for a minutes-of-day offset.
 *
 * Every time in the app reads this way. A 12-hour clock spends two characters
 * on AM/PM to say something the surrounding day already says, and it makes
 * "9:05 AM" and "12:05 PM" different widths in a column of times that is
 * meant to be scanned — which is the same reason every duration in the app is
 * set in tabular figures.
 *
 * 1440 reads as 24:00 rather than 00:00: at the end of a day's last slot it
 * is the end of *this* day, not the start of the next.
 */
export function clockAt(minutes: number): string {
  const total = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
