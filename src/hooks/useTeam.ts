import { useCallback, useEffect, useRef, useState } from "react";
import * as team from "../services/teamService";
import type { TeamContext, TeamEntry } from "../services/teamService";
import { getCurrentUser } from "../services/userService";
import { reportTelemetry } from "../services/telemetry";

// Same "warn once per session, scoped per environment + user" shape as the
// personal-path key in useTimeEntries.
function teamIsolationWarningKey(environmentId: string, userId: string): string {
  return `tt_team_isolation_warned:${environmentId}:${userId}`;
}

/**
 * Owner ids in a Team read that aren't the signed-in user or one of their
 * direct reports.
 *
 * `hasForeignUserEntries()` covers the personal read path; this is its Team
 * equivalent, which had no check at all (#91). It deliberately does not block:
 * unlike the personal path, an unexpected owner here has a **benign and
 * expected** cause — `eq-useroruserhierarchy` resolves to the caller's whole
 * manager-hierarchy subtree, so a manager of managers legitimately sees rows
 * owned by indirect reports, who are not in `reports` (that probe returns
 * direct reports only). TeamPage already renders those rows.
 *
 * What it catches is the other cause: `ever_timeentries` left Organization-
 * owned, where this read returns the entire company. The counts in the report
 * are what separate the two — a couple of unexpected owners under a manager who
 * has managers reporting to them is the hierarchy; a large fraction of the
 * result set is a misconfiguration.
 */
export function findUnexpectedOwners(entries: TeamEntry[], ctx: TeamContext): string[] {
  const expected = new Set(ctx.reports.map((r) => r.id));
  if (ctx.myUserId) expected.add(ctx.myUserId);
  const unexpected = new Set<string>();
  for (const e of entries) {
    if (e.ownerId && !expected.has(e.ownerId)) unexpected.add(e.ownerId);
  }
  return [...unexpected];
}

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

/**
 * Team time entries for a date range, refetched when the range changes.
 *
 * `teamContext` is only used to arm the isolation assertion below — the read
 * itself is scoped server-side and doesn't depend on it.
 */
export function useTeamEntries(from: string, to: string, teamContext?: TeamContext | null): {
  entries: TeamEntry[];
  loading: boolean;
  error: string | null;
  /** Set when the read stopped early: what's on screen is not the whole week. */
  truncated: string | null;
  refresh: () => void;
} {
  const [entries, setEntries] = useState<TeamEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState<string | null>(null);
  const seqRef = useRef(0);

  // Read through a ref so a new context object doesn't re-trigger the fetch.
  const contextRef = useRef(teamContext);
  useEffect(() => { contextRef.current = teamContext; }, [teamContext]);

  const load = useCallback(async (fromDate: string, toDate: string) => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    setTruncated(null);
    try {
      const { items: data, truncated: partial } = await team.getTeamTimeEntries(fromDate, toDate);
      if (seq !== seqRef.current) return;
      setEntries(data);
      // The Team read used to be a single un-paged page that would have
      // truncated at 5,000 rows with no warning at all. It shares the
      // personal reads' paging now, so it also shares their honesty about
      // stopping early (#115).
      setTruncated(partial?.message ?? null);
      try {
        const ctx = contextRef.current;
        // No context means the probe hasn't resolved: every owner would look
        // unexpected, so there is nothing to assert against yet.
        if (ctx) {
          const currentUser = getCurrentUser();
          const warningKey = teamIsolationWarningKey(currentUser.environmentId, currentUser.id);
          const unexpected = findUnexpectedOwners(data, ctx);
          if (unexpected.length && !sessionStorage.getItem(warningKey)) {
            sessionStorage.setItem(warningKey, "1");
            // "warning", not "error", and no toast: see findUnexpectedOwners —
            // indirect reports trip this legitimately, and a P0-shaped alarm
            // that cries wolf for every two-level manager is one people learn
            // to scroll past.
            reportTelemetry({
              name: "data_isolation_team",
              severity: "warning",
              message:
                "getTeamTimeEntries() returned rows owned by someone who is neither the caller nor a " +
                "direct report. Expected at hierarchy depth > 1 (indirect reports); otherwise check that " +
                "ever_timeentries is User-owned and hierarchy security is scoped as documented",
              props: {
                unexpectedOwners: unexpected.length,
                directReports: ctx.reports.length,
                rowsReturned: data.length,
                unexpectedRows: data.filter((e) => unexpected.includes(e.ownerId)).length,
              },
            });
          }
        }
      } catch {
        // Never let the assertion (e.g. sessionStorage unavailable, or an
        // unresolved user) affect the load that already succeeded.
      }
    } catch (err) {
      if (seq !== seqRef.current) return;
      setEntries([]);
      setTruncated(null);
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

  return { entries, loading, error, truncated, refresh };
}
