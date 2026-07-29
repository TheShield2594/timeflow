import { useCallback, useEffect, useRef, useState } from "react";
import * as team from "../services/teamService";
import type { TeamContext, TeamEntry } from "../services/teamService";

/**
 * One-shot probe for "does anyone report to me". Resolves from a module-level
 * cache in teamService after the first call, so mounting this in App costs a
 * single pair of lightweight systemuser reads per session.
 */
export function useTeamContext(): { teamContext: TeamContext | null } {
  const [teamContext, setTeamContext] = useState<TeamContext | null>(null);

  useEffect(() => {
    let alive = true;
    team.getTeamContext()
      .then((ctx) => { if (alive) setTeamContext(ctx); })
      // getTeamContext is documented never to reject; guard anyway so a
      // regression there surfaces as "no team" rather than an unhandled
      // rejection at bootstrap.
      .catch(() => { if (alive) setTeamContext({ myUserId: null, reports: [] }); });
    return () => { alive = false; };
  }, []);

  return { teamContext };
}

/** Team time entries for a date range, refetched when the range changes. */
export function useTeamEntries(from: string, to: string): {
  entries: TeamEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [entries, setEntries] = useState<TeamEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(async (fromDate: string, toDate: string) => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await team.getTeamTimeEntries(fromDate, toDate);
      if (seq !== seqRef.current) return;
      setEntries(data);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setEntries([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!from || !to) return;
    load(from, to);
  }, [from, to, load]);

  const refresh = useCallback(() => {
    if (from && to) load(from, to);
  }, [from, to, load]);

  return { entries, loading, error, refresh };
}
