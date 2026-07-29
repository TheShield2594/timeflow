/**
 * outlookService.ts
 *
 * Reads the signed-in user's Outlook calendar through the Office 365 Outlook
 * connector (`shared_office365`), the same connector-gateway path the
 * Dataverse service uses — Code Apps cannot call Microsoft Graph directly.
 *
 * The connector is OPTIONAL: until an admin runs
 *   pac code add-data-source -a shared_office365 -c <connectionId>
 * (see "Brandon To Do.md"), every read rejects with OutlookNotConnectedError
 * and the calendar page shows a "not connected" hint instead of meetings.
 * Once the data source exists, `pac` regenerates
 * .power/schemas/appschemas/dataSourcesInfo with an `office365` entry, which
 * takes precedence over the fallback operation schemas defined below.
 *
 * Outside the Power Apps host (Vite dev / tests) this serves deterministic
 * mock meetings so the overlay and log-from-meeting flow are demoable.
 *
 * The Power SDK is loaded lazily inside the host-only branch: importing
 * @microsoft/power-apps at module scope would drag its transitive
 * dependencies into every unit test that renders the calendar.
 */
import type { OutlookEvent } from "../types";
import { getCurrentUser, isPowerAppsHost } from "./userService";

export class OutlookNotConnectedError extends Error {
  constructor(detail?: string) {
    super(detail ?? "The Office 365 Outlook connector is not set up for this app.");
    this.name = "OutlookNotConnectedError";
  }
}

// ---------------------------------------------------------------------------
// Connector plumbing (Power Apps host only)
// ---------------------------------------------------------------------------
const OUTLOOK_SOURCE = "office365";

// Fallback operation schemas for the two Office 365 Outlook operations this
// service calls, in the same shape pac writes into dataSourcesInfo. Used only
// while the regenerated schema has no `office365` entry yet — the connection
// itself is still required, so calls made before setup fail fast (and are
// surfaced as OutlookNotConnectedError).
const OUTLOOK_FALLBACK_SOURCE = {
  tableId: "",
  version: "",
  primaryKey: "",
  dataSourceType: "Connector",
  apis: {
    CalendarGetTables_V2: {
      path: "/{connectionId}/datasets/calendars/v2/tables",
      method: "GET",
      parameters: [
        { name: "connectionId", in: "path", required: true, type: "string" },
      ],
      responseInfo: { "200": { type: "object" }, default: { type: "void" } },
    },
    GetEventsCalendarViewV3: {
      path: "/{connectionId}/datasets/calendars/v3/tables/{table}/calendarview",
      method: "GET",
      parameters: [
        { name: "connectionId", in: "path", required: true, type: "string" },
        { name: "table", in: "path", required: true, type: "string" },
        { name: "startDateTimeUtc", in: "query", required: true, type: "string" },
        { name: "endDateTimeUtc", in: "query", required: true, type: "string" },
      ],
      responseInfo: { "200": { type: "object" }, default: { type: "void" } },
    },
  },
} as const;

// Minimal structural view of the SDK client — full SDK types stay out of the
// static module graph (see the lazy-import note in the header).
interface PowerClient {
  executeAsync<TIn, TOut>(request: {
    connectorOperation: { tableName: string; operationName: string; parameters?: TIn };
  }): Promise<{ success: boolean; data: TOut; error?: unknown }>;
}

let clientPromise: Promise<PowerClient> | null = null;

function outlookClient(): Promise<PowerClient> {
  clientPromise ??= (async () => {
    const [{ getClient }, { dataSourcesInfo }] = await Promise.all([
      import("@microsoft/power-apps/data"),
      import("../../.power/schemas/appschemas/dataSourcesInfo"),
    ]);
    const sources = (dataSourcesInfo as Record<string, unknown>)[OUTLOOK_SOURCE]
      ? dataSourcesInfo
      : { ...dataSourcesInfo, [OUTLOOK_SOURCE]: OUTLOOK_FALLBACK_SOURCE };
    return (getClient as unknown as (info: unknown) => PowerClient)(sources);
  })().catch((err) => {
    // Never cache a rejected bootstrap: the next call (week nav, the UI's
    // Retry button) must be able to try the import/getClient again instead
    // of replaying this rejection for the rest of the session.
    clientPromise = null;
    throw err;
  });
  return clientPromise;
}

/** Test hook: clear the memoized SDK client and default-calendar id. */
export function resetOutlookCache(): void {
  clientPromise = null;
  cachedCalendarId = null;
}

async function callOutlook<TIn, TOut>(operationName: string, parameters: TIn): Promise<TOut> {
  const client = await outlookClient();
  const result = await client.executeAsync<TIn, TOut>({
    connectorOperation: { tableName: OUTLOOK_SOURCE, operationName, parameters },
  });
  if (!result.success) {
    const err = result.error;
    const msg = err instanceof Error ? err.message
      : typeof err === "string" ? err
      : JSON.stringify(err ?? {});
    // The gateway reports "no such connection / data source" errors the same
    // way as any other failure; the caller decides which ones mean "not set
    // up yet" (see getCalendarEvents).
    throw new Error(`${operationName} failed: ${msg}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Response mapping — defensive across connector versions and casings
// ---------------------------------------------------------------------------
type Raw = Record<string, unknown>;

// List responses arrive as { value: [...] }; depending on the SDK version each
// item may additionally be wrapped as { dynamicProperties: {...} } like
// Dataverse rows are.
function unwrapItems(data: unknown): Raw[] {
  if (!data || typeof data !== "object") return [];
  const value = (data as Raw).value;
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") return {};
    const dyn = (item as Raw).dynamicProperties;
    return dyn && typeof dyn === "object" ? (dyn as Raw) : (item as Raw);
  });
}

function pick(r: Raw, ...keys: string[]): unknown {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return r[k];
  }
  return undefined;
}

function pickStr(r: Raw, ...keys: string[]): string | undefined {
  const v = pick(r, ...keys);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// The connector's plain start/end fields are UTC wall-clock strings with no
// offset marker ("2026-07-28T14:00:00.0000000"); the *WithTimeZone variants
// carry a real offset. new Date() would read the offset-less form as LOCAL
// time and shift every meeting, so bare timestamps are pinned to UTC first.
export function toIsoUtc(value: string): string | null {
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const ms = Date.parse(hasOffset ? value : `${value}Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * One connector row → OutlookEvent, or null for rows the overlay can't use:
 * cancelled meetings and all-day events (an all-day row has no time span to
 * lay out on the hour grid, and its wall-clock dates would render as a
 * misleading midnight-to-midnight block).
 */
export function mapConnectorEvent(r: Raw): OutlookEvent | null {
  if (pick(r, "isCancelled", "IsCancelled") === true) return null;
  if (pick(r, "isAllDay", "IsAllDay") === true) return null;
  const id = pickStr(r, "id", "Id", "iCalUId", "ICalUId");
  const rawStart = pickStr(r, "startWithTimeZone", "StartWithTimeZone", "start", "Start");
  const rawEnd = pickStr(r, "endWithTimeZone", "EndWithTimeZone", "end", "End");
  if (!id || !rawStart || !rawEnd) return null;
  const startTime = toIsoUtc(rawStart);
  const endTime = toIsoUtc(rawEnd);
  if (!startTime || !endTime || endTime <= startTime) return null;
  return {
    id,
    subject: pickStr(r, "subject", "Subject") ?? "(No subject)",
    startTime,
    endTime,
  };
}

// ---------------------------------------------------------------------------
// Default calendar resolution
// ---------------------------------------------------------------------------
let cachedCalendarId: string | null = null;

async function getDefaultCalendarId(): Promise<string> {
  if (cachedCalendarId) return cachedCalendarId;
  const data = await callOutlook<Record<string, never>, unknown>("CalendarGetTables_V2", {});
  const tables = unwrapItems(data);
  // Prefer the mailbox's primary calendar; older tenants name it "Calendar",
  // localized tenants don't, so fall back to the first calendar returned.
  const primary =
    tables.find((t) => pickStr(t, "displayName", "DisplayName") === "Calendar") ?? tables[0];
  const id = primary ? pickStr(primary, "name", "Name", "id", "Id") : undefined;
  if (!id) throw new OutlookNotConnectedError("No Outlook calendars were returned for this account.");
  cachedCalendarId = id;
  return id;
}

// ---------------------------------------------------------------------------
// Mock meetings (Vite dev / tests)
// ---------------------------------------------------------------------------
// Deterministic per-date pseudo-random meetings so the overlay is demoable
// without Microsoft 365 and tests can assert against stable data.
function dateHash(dateStr: string): number {
  let h = 0;
  for (const ch of dateStr) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return h;
}

function mockIso(dateStr: string, hour: number, minute: number): string {
  return new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`).toISOString();
}

export function mockEventsForDate(dateStr: string): OutlookEvent[] {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  if (day === 0 || day === 6) return []; // weekends stay clear
  const h = dateHash(dateStr);
  const events: OutlookEvent[] = [
    { id: `mock-${dateStr}-standup`, subject: "Team standup", startTime: mockIso(dateStr, 9, 0), endTime: mockIso(dateStr, 9, 15) },
  ];
  if (h % 3 === 0) {
    events.push({ id: `mock-${dateStr}-sync`, subject: "Project sync", startTime: mockIso(dateStr, 11, 0), endTime: mockIso(dateStr, 12, 0) });
  }
  if (h % 2 === 0) {
    events.push({ id: `mock-${dateStr}-oneonone`, subject: "1:1 with manager", startTime: mockIso(dateStr, 14, 0), endTime: mockIso(dateStr, 14, 30) });
  }
  return events;
}

function mockEventsForRange(fromDate: string, toDate: string): OutlookEvent[] {
  const events: OutlookEvent[] = [];
  const cursor = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);
  // Bounded to a year so a malformed range can't spin forever.
  for (let i = 0; cursor <= end && i < 366; i++) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    events.push(...mockEventsForDate(`${y}-${m}-${d}`));
    cursor.setDate(cursor.getDate() + 1);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Meetings from the user's default Outlook calendar overlapping the local
 * date range (YYYY-MM-DD, inclusive). Rejects with OutlookNotConnectedError
 * when the connector isn't wired up yet.
 */
export async function getCalendarEvents(fromDate: string, toDate: string): Promise<OutlookEvent[]> {
  if (!isPowerAppsHost()) {
    return mockEventsForRange(fromDate, toDate);
  }
  let calendarId: string;
  try {
    calendarId = await getDefaultCalendarId();
  } catch (err) {
    // Failing to even list calendars is the signature of a missing
    // connection/data source (or missing consent) — every configured tenant
    // returns at least the default calendar. Report it as "not connected"
    // so the UI shows the setup hint instead of a scary error.
    if (err instanceof OutlookNotConnectedError) throw err;
    throw new OutlookNotConnectedError(err instanceof Error ? err.message : undefined);
  }
  // Local-midnight bounds, widened to the exclusive end of the last day.
  const startUtc = new Date(`${fromDate}T00:00:00`).toISOString();
  const endUtc = new Date(`${toDate}T00:00:00`);
  endUtc.setDate(endUtc.getDate() + 1);
  const data = await callOutlook<
    { table: string; startDateTimeUtc: string; endDateTimeUtc: string },
    unknown
  >("GetEventsCalendarViewV3", {
    table: calendarId,
    startDateTimeUtc: startUtc,
    endDateTimeUtc: endUtc.toISOString(),
  });
  return unwrapItems(data)
    .map(mapConnectorEvent)
    .filter((e): e is OutlookEvent => e !== null)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

// ---------------------------------------------------------------------------
// "Already logged" tracking
// ---------------------------------------------------------------------------
// There is no Dataverse column tying a time entry back to the Outlook event
// it was logged from, so the link lives in localStorage per environment +
// user — the same scoping the timer and weekly target use. Per-device only:
// logging a meeting on one machine won't tick it off on another. Good enough
// for a visual "done" hint; the entries themselves are the real record.
const LOGGED_KEY_PREFIX = "tt_outlook_logged:";
const LOGGED_MAX = 800;

function loggedKey(): string {
  const user = getCurrentUser();
  return `${LOGGED_KEY_PREFIX}${user.environmentId}:${user.id}`;
}

export function readLoggedEventIds(): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(loggedKey()) || "[]");
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function markEventLogged(eventId: string): Set<string> {
  const ids = readLoggedEventIds();
  ids.delete(eventId); // re-add at the end so pruning drops the oldest first
  ids.add(eventId);
  const arr = [...ids].slice(-LOGGED_MAX);
  try {
    localStorage.setItem(loggedKey(), JSON.stringify(arr));
  } catch { /* storage unavailable — the hint just won't persist */ }
  return new Set(arr);
}
