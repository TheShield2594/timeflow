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
 * US ordering — "Tuesday, September 8" — because that is what the people
 * using this read by default. The 2026-09 redesign shipped day-first
 * ("Tuesday 8 September") from the mocks; it was internally consistent and
 * nobody outside the mocks had asked for it (#152).
 *
 * One decision in one place rather than an argument object repeated in nine
 * files.
 */
export const DATE_LOCALE = "en-US";

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

/** Minutes-of-day, clamped to the clock face, as {hour 1-12, minute, suffix}. */
function twelveHourParts(minutes: number): { h: number; m: number; suffix: string } {
  const total = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes)));
  const h24 = Math.floor(total / 60);
  return { h: h24 % 12 === 0 ? 12 : h24 % 12, m: total % 60, suffix: h24 < 12 || h24 === 24 ? "AM" : "PM" };
}

/**
 * "5:30 PM" for a minutes-of-day offset — every time the app displays.
 *
 * The redesign shipped a 24-hour clock, on the argument that AM/PM spends two
 * characters saying what the surrounding day already says and that "9:05 AM"
 * and "12:05 PM" scan at different widths. Both true, and both lost to the
 * larger fact that "17:30" is not what the people reading this screen read
 * (#152). Times are still set in tabular figures, so the digits line up even
 * where the suffix doesn't.
 *
 * This is a *display* format and nothing else. `<input type="time">` takes
 * 24-hour "HH:MM" whatever the user's locale shows — that is `timeInputAt`.
 *
 * The 24-hour form could say 24:00 for the end of a day's last slot and
 * distinguish it from that day's 00:00; a 12-hour clock has no such notation,
 * so 0 and 1440 both read "12:00 AM" and the surrounding "to"/"–" is what
 * carries the direction.
 */
export function clockAt(minutes: number): string {
  const { h, m, suffix } = twelveHourParts(minutes);
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * `clockAt` with the ":00" dropped on the hour — "5 PM", "10:30 AM".
 *
 * For tick marks rather than readings: the calendar's hour gutter and the day
 * bar's axis, where the label names a position on a scale and the minutes are
 * always zero. Narrower than the 24-hour form it replaces, which is what keeps
 * both fitting the widths they were laid out at.
 */
export function clockAtCompact(minutes: number): string {
  const { h, m, suffix } = twelveHourParts(minutes);
  return m === 0 ? `${h} ${suffix}` : `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * "HH:MM" on a 24-hour clock, for `<input type="time">` values.
 *
 * Not a display format: the element's value is always 24-hour regardless of
 * what it renders to the user, so this must never be swapped for `clockAt`.
 *
 * A valid HTML time string runs 00:00–23:59, and a browser sanitizes anything
 * else to the empty string — so the end of the day has to be written as the
 * *next* day's 00:00 rather than 24:00, or a span ending at midnight renders
 * a blank field. That is the same instant, and it is the form EntrySheet
 * already reads as "ends next day".
 */
export function timeInputAt(minutes: number): string {
  const total = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes))) % MINUTES_PER_DAY;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// Two timestamps naming the same moment, allowing for the sub-second precision
// Dataverse drops on the round trip: it hands `ever_starttime` back at second
// precision, so string equality against the toISOString() we sent never
// matches (#193). Deliberately tight: anything looser risks matching a
// *different* session's draft, which is worse than not matching at all.
// Unparseable input is not a match.
export function sameInstant(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return Math.abs(ta - tb) < 1000;
}

export interface DaySegment {
  /** The local calendar day this piece falls on. */
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

/**
 * One span of time, cut at each local midnight it crosses.
 *
 * A row is dated by one day, and every total in the app — the week, Reports'
 * buckets, the Team rollup, the day bar's coverage — attributes a row's
 * minutes to that day. A span that crosses midnight therefore has to become
 * one row per day, or the hours after midnight are counted on the day before
 * (#185). Midnight comes off the calendar, not by adding 24h, so it lands
 * right on the days the clocks move.
 *
 * A piece that would round to zero minutes is folded into its neighbour
 * rather than filed: stopping ten seconds after midnight should not leave a
 * 0m row behind on the new day (#188). An empty or inverted span comes back
 * as a single piece on the start date, so callers never have to special-case
 * it.
 */
export function splitAtMidnights(startIso: string, endIso: string): DaySegment[] {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const cuts: number[] = [];
  let day = localDateStr(new Date(startMs));
  for (;;) {
    day = addDaysStr(day, 1);
    const midnight = new Date(`${day}T00:00:00`).getTime();
    if (midnight >= endMs) break;
    cuts.push(midnight);
  }
  // Drop any cut that would leave a piece shorter than half a minute on
  // either side — that piece would be stored as 0m.
  const HALF_MINUTE = 30_000;
  const kept: number[] = [];
  for (const cut of cuts) {
    const prev = kept.length ? kept[kept.length - 1] : startMs;
    if (cut - prev < HALF_MINUTE) continue;
    if (endMs - cut < HALF_MINUTE) continue;
    kept.push(cut);
  }
  const bounds = [startMs, ...kept, endMs];
  const pieces: DaySegment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = new Date(bounds[i]);
    const b = new Date(bounds[i + 1]);
    pieces.push({
      date: localDateStr(a),
      startTime: a.toISOString(),
      endTime: b.toISOString(),
      durationMinutes: Math.max(0, minutesBetween(a, b)),
    });
  }
  return pieces;
}
