import { useCallback, useEffect, useRef, useState } from "react";
import type { OutlookEvent } from "../types";
import * as outlook from "../services/outlookService";

export type OutlookStatus = "loading" | "ready" | "unavailable" | "error";

/**
 * Outlook meetings for a local date range (inclusive YYYY-MM-DD bounds).
 * `enabled: false` skips fetching entirely (overlay hidden) and reports
 * "ready" with no events. "unavailable" means the connector isn't set up —
 * re-probed on each range change / remount, so it heals on its own once the
 * admin adds the data source.
 */
export function useOutlookEvents(from: string, to: string, enabled: boolean): {
  events: OutlookEvent[];
  status: OutlookStatus;
  refresh: () => void;
} {
  const [events, setEvents] = useState<OutlookEvent[]>([]);
  const [status, setStatus] = useState<OutlookStatus>("loading");
  const seqRef = useRef(0);

  const load = useCallback(async (fromDate: string, toDate: string) => {
    const seq = ++seqRef.current;
    setStatus("loading");
    try {
      const data = await outlook.getCalendarEvents(fromDate, toDate);
      if (seq !== seqRef.current) return;
      setEvents(data);
      setStatus("ready");
    } catch (err) {
      if (seq !== seqRef.current) return;
      setEvents([]);
      if (err instanceof outlook.OutlookNotConnectedError) {
        setStatus("unavailable");
      } else {
        console.error("Could not load Outlook events:", err);
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled || !from || !to) return;
    load(from, to);
  }, [enabled, from, to, load]);

  const refresh = useCallback(() => {
    if (enabled && from && to) load(from, to);
  }, [enabled, from, to, load]);

  return { events: enabled ? events : [], status: enabled ? status : "ready", refresh };
}
