/**
 * The Outlook meeting overlay on the week calendar (#115).
 *
 * Everything about the overlay that isn't the entry modal: how loudly it's
 * drawn, which recurring subjects the user has silenced, which meetings are
 * already logged, and where each ghost block sits on the grid. The modal
 * itself, and the "Log all" queue that walks it, stay in CalendarPage —
 * they're the calendar's write path, not the overlay's.
 *
 * The preference is scoped per environment + user, like the weekly target:
 * there is no per-user Dataverse store, so localStorage keys carry the
 * scoping instead. Reading the current user here rather than in the component
 * is the point — the view layer shouldn't be reaching into a service
 * singleton that throws if the sign-in hasn't resolved.
 */
import { useCallback, useMemo, useState } from "react";
import type { OutlookEvent } from "../types";
import {
  clearMutedSubjects, markEventLogged, muteSubject,
  readLoggedEventIds, readMutedSubjects, subjectKey,
} from "../services/outlookService";
import { getCurrentUser } from "../services/userService";
import { localDateStr, minutesOfDay } from "../utils/dates";
import { MINUTES_PER_DAY, TOTAL_SLOTS } from "../utils/calendarGeometry";
import { useOutlookEvents, type OutlookStatus } from "./useOutlookEvents";

/**
 * How loudly the overlay is drawn.
 *
 * Three states rather than two: with twenty-plus meetings a week, "on" and
 * "off" are both wrong most of the time — you want the meetings there as
 * context without them dominating the page they're context *for*. "faded"
 * keeps them present and clickable at a fraction of the weight.
 */
export type OutlookMode = "on" | "faded" | "off";

const OUTLOOK_MODE_ORDER: OutlookMode[] = ["on", "faded", "off"];
const SHOW_OUTLOOK_KEY_PREFIX = "tt_show_outlook:";

function showOutlookKey(): string {
  const user = getCurrentUser();
  return `${SHOW_OUTLOOK_KEY_PREFIX}${user.environmentId}:${user.id}`;
}

export function readOutlookMode(): OutlookMode {
  try {
    const raw = localStorage.getItem(showOutlookKey());
    // "1"/"0" are the old boolean preference — migrate rather than reset it,
    // so anyone who had deliberately hidden the overlay doesn't get it back.
    if (raw === "0") return "off";
    if (raw === "1" || raw === null) return "on";
    return OUTLOOK_MODE_ORDER.includes(raw as OutlookMode) ? raw as OutlookMode : "on";
  } catch {
    return "on";
  }
}

/** A meeting placed on one day column, clamped to that day. */
export interface Ghost {
  event: OutlookEvent;
  startMin: number;
  endMin: number;
}

export interface OutlookOverlay {
  mode: OutlookMode;
  /** on -> faded -> off -> on, persisted. */
  cycleMode: () => void;
  status: OutlookStatus;
  refresh: () => void;
  /** Meetings for the week, minus muted subjects. */
  events: OutlookEvent[];
  /** Ghost blocks keyed `${date}-${slotRow}`, mirroring the entry grouping. */
  ghostsByCell: Map<string, Ghost[]>;
  /** Unlogged meetings per day, in time order — what "Log all" walks. */
  unloggedByDate: Map<string, OutlookEvent[]>;
  loggedEventIds: Set<string>;
  markLogged: (eventId: string) => void;
  /** How many meetings this week are hidden by a muted subject. */
  mutedCount: number;
  muteSubject: (subject: string) => void;
  unmuteAll: () => void;
}

export function useOutlookOverlay(from: string, to: string): OutlookOverlay {
  const [mode, setMode] = useState<OutlookMode>(readOutlookMode);
  const [loggedEventIds, setLoggedEventIds] = useState<Set<string>>(readLoggedEventIds);
  const [mutedSubjects, setMutedSubjects] = useState<Set<string>>(readMutedSubjects);

  const { events: allEvents, status, refresh } = useOutlookEvents(from, to, mode !== "off");

  // A muted subject silences the whole recurring series, this week and every
  // week after it.
  const events = useMemo(
    () => allEvents.filter((e) => !mutedSubjects.has(subjectKey(e.subject))),
    [allEvents, mutedSubjects]
  );

  // Persistence stays out of the state updater: React may replay updater
  // functions (StrictMode, concurrent renders), and side effects inside them
  // can run more than once.
  const cycleMode = useCallback(() => {
    const next = OUTLOOK_MODE_ORDER[(OUTLOOK_MODE_ORDER.indexOf(mode) + 1) % OUTLOOK_MODE_ORDER.length];
    setMode(next);
    try {
      localStorage.setItem(showOutlookKey(), next);
    } catch { /* storage unavailable — the preference just won't persist */ }
  }, [mode]);

  // Ghosts grouped by the grid slot cell their start falls in, mirroring the
  // entry grouping. Full-width blocks behind the entries, so they don't
  // participate in the entries' column layout.
  const ghostsByCell = useMemo(() => {
    const m = new Map<string, Ghost[]>();
    events.forEach((event) => {
      const date = localDateStr(new Date(event.startTime));
      const startMin = minutesOfDay(event.startTime);
      // Meetings that run past midnight are clamped to the day they start on,
      // exactly like entry blocks.
      const endMin = localDateStr(new Date(event.endTime)) > date
        ? MINUTES_PER_DAY
        : Math.max(minutesOfDay(event.endTime), startMin + 15);
      const row = Math.max(0, Math.min(Math.floor(startMin / 30), TOTAL_SLOTS - 1));
      const key = `${date}-${row}`;
      const list = m.get(key);
      const item = { event, startMin, endMin };
      if (list) list.push(item);
      else m.set(key, [item]);
    });
    return m;
  }, [events]);

  const unloggedByDate = useMemo(() => {
    const m = new Map<string, OutlookEvent[]>();
    events.forEach((event) => {
      if (loggedEventIds.has(event.id)) return;
      const date = localDateStr(new Date(event.startTime));
      const list = m.get(date);
      if (list) list.push(event);
      else m.set(date, [event]);
    });
    m.forEach((list) => list.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return m;
  }, [events, loggedEventIds]);

  const markLogged = useCallback((eventId: string) => {
    setLoggedEventIds(markEventLogged(eventId));
  }, []);

  const mute = useCallback((subject: string) => {
    setMutedSubjects(muteSubject(subject));
  }, []);

  const unmuteAll = useCallback(() => {
    setMutedSubjects(clearMutedSubjects());
  }, []);

  return {
    mode, cycleMode, status, refresh,
    events, ghostsByCell, unloggedByDate,
    loggedEventIds, markLogged,
    mutedCount: allEvents.length - events.length,
    muteSubject: mute, unmuteAll,
  };
}
