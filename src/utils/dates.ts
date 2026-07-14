/**
 * Local-timezone date helpers.
 *
 * Never use `new Date().toISOString().split("T")[0]` for calendar dates:
 * toISOString() is UTC, so for users west of UTC "today" flips to tomorrow
 * in the evening, putting entries on the wrong day. Everything that needs a
 * YYYY-MM-DD key derives it from the *local* clock via these helpers.
 */

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
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en", {
    weekday: "long", month: "long", day: "numeric",
  });
}

/** "HH:MM" for <input type="time">, from an ISO timestamp, in local time. */
export function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Minutes since local midnight for an ISO timestamp. */
export function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
