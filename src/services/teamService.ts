/**
 * teamService.ts
 *
 * Data layer for the manager Team page (issue #61). Built on Dataverse
 * **Hierarchy security (Manager hierarchy)** rather than a custom security
 * role: when the environment has hierarchy security enabled with
 * `ever_timeentries` included, a manager can read their reports' rows, and
 * FetchXML's `eq-useroruserhierarchy` operator resolves server-side to
 * "the calling user and everyone under them in the manager hierarchy".
 *
 * That keeps the app's isolation story intact:
 *  - The personal pages still read with `eq-userid` (only your own rows) and
 *    `hasForeignUserEntries()` stays armed for them, untouched.
 *  - The Team page's cross-user read is scoped BY THE SERVER to the rows
 *    hierarchy security grants — a non-manager gets exactly their own rows
 *    back, never an error and never someone else's data.
 *
 * Manager detection: the app asks Dataverse "does anyone list me as their
 * manager?" (systemuser.parentsystemuserid). Requires org-level Read on the
 * User table, which baseline roles typically grant; if the probe fails the
 * Team page simply stays hidden. Admin setup steps live in "Brandon To Do.md".
 *
 * Local dev: the Team page is hidden unless `tt_mock_team` is set in
 * localStorage (`localStorage.setItem("tt_mock_team", "1")`), which serves
 * two fake reports with deterministic entries for UI work.
 */
import type { TimeEntry } from "../types";
import { getCurrentUser, isPowerAppsHost, getDataverseOrgUrl } from "./userService";
import { MicrosoftDataverseService } from "../generated";
import { escapeXmlAttr, mapEntry } from "./dataverseService";

const ENTRIES_SET = "ever_timeentrieses";
const USERS_SET = "systemusers";

const ACCEPT = "application/json";

export interface TeamMember {
  /** systemuser id (also `ownerid` on their time entries). */
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Shared SDK helpers (mirrors dataverseService's list plumbing for the two
// small reads this service adds; the entry read reuses mapEntry so Team rows
// and personal rows stay shaped identically).
// ---------------------------------------------------------------------------
type Raw = Record<string, unknown>;

interface DynItem { dynamicProperties?: Raw }
interface ListEnvelope { value?: DynItem[] }

function unwrapRow(x: unknown): Raw {
  if (!x || typeof x !== "object") return {};
  const obj = x as Raw;
  const dyn = obj.dynamicProperties;
  if (dyn && typeof dyn === "object") return dyn as Raw;
  return obj;
}

function str(r: Raw, key: string): string | undefined {
  const v = r[key];
  return typeof v === "string" ? v : undefined;
}

async function listRecords(entitySet: string, opts: { filter?: string; select?: string; fetchXml?: string; orderby?: string }): Promise<Raw[]> {
  const result = await MicrosoftDataverseService.ListRecordsWithOrganization(
    getDataverseOrgUrl(),
    entitySet,
    undefined, // prefer
    ACCEPT,
    undefined, // x-ms-odata-metadata-full
    undefined, // MSCRM.IncludeMipSensitivityLabel
    opts.select,
    opts.fetchXml ? undefined : opts.filter,
    opts.fetchXml ? undefined : opts.orderby,
    undefined, // $expand
    opts.fetchXml,
    undefined, // $top
    undefined, // $skiptoken
  );
  if (!result.success) {
    const err = result.error;
    if (err instanceof Error) throw err;
    throw new Error(`List ${entitySet} failed: ${typeof err === "string" ? err : JSON.stringify(err ?? {})}`);
  }
  const env = result.data as unknown as ListEnvelope;
  return (env?.value ?? []).map(unwrapRow);
}

// ---------------------------------------------------------------------------
// Local mock (Vite dev only) — opt-in so a fresh dev workspace stays personal
// ---------------------------------------------------------------------------
const MOCK_TEAM_KEY = "tt_mock_team";

function mockTeamEnabled(): boolean {
  try {
    return localStorage.getItem(MOCK_TEAM_KEY) !== null;
  } catch {
    return false;
  }
}

const MOCK_REPORTS: TeamMember[] = [
  { id: "mock-report-avery", name: "Avery Example" },
  { id: "mock-report-jordan", name: "Jordan Sample" },
];

function mockIso(dateStr: string, hour: number, minute = 0): string {
  return new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`).toISOString();
}

function dateHash(dateStr: string, salt: string): number {
  let h = 0;
  for (const ch of dateStr + salt) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return h;
}

// Deterministic weekday entries per report: everyone "works" a morning block;
// Jordan skips days hashing to 0 mod 4 so the missing-day flag has something
// to flag.
function mockEntriesForRange(fromDate: string, toDate: string): TimeEntry[] {
  const out: TimeEntry[] = [];
  const cursor = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);
  for (let i = 0; cursor <= end && i < 366; i++) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    const ds = `${y}-${m}-${d}`;
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      for (const member of MOCK_REPORTS) {
        const h = dateHash(ds, member.id);
        if (member.id === "mock-report-jordan" && h % 4 === 0) continue;
        const minutes = 300 + (h % 5) * 45;
        out.push({
          id: `mock-team-${member.id}-${ds}`,
          projectId: "",
          description: "Mock team entry",
          startTime: mockIso(ds, 9),
          endTime: mockIso(ds, 9 + Math.floor(minutes / 60), minutes % 60),
          durationMinutes: minutes,
          date: ds,
          userId: member.id,
          userDisplayName: member.name,
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Manager probe
// ---------------------------------------------------------------------------
export interface TeamContext {
  /** The signed-in user's systemuser id (owner id on their entries), when
   *  resolvable — used to label their own rows on the Team page. */
  myUserId: string | null;
  /** Direct reports (users whose Manager is the signed-in user). */
  reports: TeamMember[];
}

const NO_TEAM: TeamContext = { myUserId: null, reports: [] };

let cachedContext: TeamContext | null = null;

/**
 * Who reports to the signed-in user. `reports` is [] when there are none or
 * the probe isn't possible. Never throws: any failure (no User-table read
 * privilege, throttling on bootstrap) means the Team page stays hidden this
 * session rather than the app breaking.
 */
export async function getTeamContext(): Promise<TeamContext> {
  if (cachedContext) return cachedContext;
  if (!isPowerAppsHost()) {
    const user = getCurrentUser();
    return (cachedContext = mockTeamEnabled()
      ? { myUserId: user.id, reports: MOCK_REPORTS }
      : NO_TEAM);
  }
  try {
    const user = getCurrentUser();
    // Resolve my systemuser id from my Entra object id, then list users whose
    // Manager (parentsystemuserid) is that id. Disabled accounts excluded.
    const me = await listRecords(USERS_SET, {
      select: "systemuserid,fullname",
      filter: `azureactivedirectoryobjectid eq ${user.id}`,
    });
    const myId = me.length ? str(me[0], "systemuserid") : undefined;
    if (!myId) return (cachedContext = NO_TEAM);
    const rows = await listRecords(USERS_SET, {
      select: "systemuserid,fullname,isdisabled",
      filter: `_parentsystemuserid_value eq ${myId} and isdisabled eq false`,
      orderby: "fullname asc",
    });
    const reports = rows
      .map((r) => ({ id: str(r, "systemuserid") ?? "", name: str(r, "fullname") ?? "Unknown user" }))
      .filter((m) => m.id);
    cachedContext = { myUserId: myId, reports };
    return cachedContext;
  } catch (err) {
    console.warn("Could not check for direct reports; hiding the Team page.", err);
    return NO_TEAM;
  }
}

// ---------------------------------------------------------------------------
// Team entries
// ---------------------------------------------------------------------------
/** A time entry plus who owns it, for grouping on the Team page. */
export interface TeamEntry extends TimeEntry {
  ownerId: string;
  ownerName: string;
}

/**
 * Time entries in the date range for the signed-in user AND their reports.
 * The scope is enforced server-side: `eq-useroruserhierarchy` resolves to
 * the calling user's manager-hierarchy subtree, and hierarchy security
 * decides which of those rows the caller may actually read.
 */
export async function getTeamTimeEntries(from: string, to: string): Promise<TeamEntry[]> {
  if (!isPowerAppsHost()) {
    if (!mockTeamEnabled()) return [];
    // Dev keeps the manager's own entries out of the mock — the page's
    // interesting content is the reports.
    return mockEntriesForRange(from, to).map((e) => ({
      ...e,
      ownerId: e.userId,
      ownerName: e.userDisplayName,
    }));
  }
  const fetchXml =
    '<fetch>' +
      '<entity name="ever_timeentries">' +
        '<all-attributes />' +
        '<filter>' +
          `<condition attribute="ever_date" operator="ge" value="${escapeXmlAttr(from)}" />` +
          `<condition attribute="ever_date" operator="le" value="${escapeXmlAttr(to)}" />` +
          '<condition attribute="ownerid" operator="eq-useroruserhierarchy" />' +
        '</filter>' +
        '<order attribute="ever_starttime" descending="true" />' +
      '</entity>' +
    '</fetch>';
  const rows = await listRecords(ENTRIES_SET, { fetchXml });
  return rows.map((r) => {
    const entry = mapEntry(r);
    const ownerId = str(r, "_ownerid_value") ?? "";
    const ownerName =
      // The Web API surfaces lookup display names as an OData annotation;
      // keep every fallback mapEntry already knows about behind it.
      str(r, "_ownerid_value@OData.Community.Display.V1.FormattedValue") ??
      entry.userDisplayName ??
      "";
    return { ...entry, ownerId, ownerName };
  });
}

/** Test hook: clear the memoized reports probe. */
export function resetTeamCache(): void {
  cachedContext = null;
}
