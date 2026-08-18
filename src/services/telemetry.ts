/**
 * telemetry.ts
 *
 * The one place a failure signal can leave the user's browser (issue #111).
 *
 * Before this, every signal terminated where nobody would ever see it: the
 * ErrorBoundary logged to `console.error`, partial loads warned by toast, and —
 * worst of all — the `hasForeignUserEntries()` data-isolation canary told *the
 * affected user* that they might be seeing a colleague's time entries and told
 * nobody else at all. A company-wide privacy incident could sit in one person's
 * devtools indefinitely.
 *
 * Wiring
 * ------
 * Both sinks are optional and resolved at build time. With neither set, this
 * module is console-only, which is exactly the old behaviour — so the app runs
 * unconfigured (and in `npm run dev`) without special-casing.
 *
 *   VITE_APPINSIGHTS_CONNECTION_STRING — an Application Insights connection
 *     string. Events POST to that resource's ingestion endpoint as classic
 *     Track envelopes; no SDK, so nothing extra ships in the bundle.
 *   VITE_TELEMETRY_ENDPOINT — any URL that accepts a JSON POST (a Logic App, a
 *     Power Automate HTTP trigger, a Teams webhook). Used when there is no
 *     connection string.
 *
 * Build-time config is deliberate here, unlike the Dataverse org URL, which
 * must be resolved at runtime so one artifact can be promoted across
 * environments (see dataverseService). One telemetry resource can serve Dev,
 * QA and Prod because every event carries `environmentId`; a *per-environment*
 * sink would need the same runtime treatment as the org URL.
 *
 * What is sent
 * ------------
 * Ids, counts, codes and error messages — never entry descriptions, project or
 * task names, Jira tickets or durations. A time entry's description is the one
 * field users type prose into, and prose is where the confidential detail
 * lives. Callers pass `props` explicitly for this reason: there is no
 * "serialize the object and see what sticks" path.
 */
import { getCurrentUser } from "./userService";

export type TelemetrySeverity = "warning" | "error";

export interface TelemetryEvent {
  /** Stable, greppable identifier, e.g. "error_boundary". Not free text. */
  name: string;
  severity: TelemetrySeverity;
  message: string;
  /** Scalars only, and only non-identifying ones — see the note above. */
  props?: Record<string, string | number | boolean | undefined>;
}

/** Where an event goes. Swappable so tests never touch the network. */
export type TelemetryTransport = (event: TelemetryEvent, context: Record<string, string>) => void;

// A crash inside a render loop, or a canary that trips on every refresh, must
// not turn into a request per occurrence: this app's failure modes are exactly
// the repeating kind. Identical events collapse to the first, and the session
// stops sending entirely past the cap.
const MAX_EVENTS_PER_SESSION = 25;
const sent = new Set<string>();
let eventCount = 0;

function env(key: string): string | undefined {
  // `import.meta.env` is replaced at build time; the guard keeps this callable
  // from a plain test environment where it may be absent.
  const vars = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const value = vars?.[key];
  return value && value.trim() ? value.trim() : undefined;
}

// Connection strings are `Key=value;Key=value`. Only two fields matter, and a
// malformed string yields no ingestion URL rather than a bad request.
function parseConnectionString(cs: string): { key: string; ingestion: string } | null {
  const fields = new Map<string, string>();
  for (const part of cs.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) fields.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
  }
  const key = fields.get("instrumentationkey");
  if (!key) return null;
  const base = fields.get("ingestionendpoint") ?? "https://dc.services.visualstudio.com";
  return { key, ingestion: `${base.replace(/\/+$/, "")}/v2/track` };
}

// Fire-and-forget. `keepalive` so a report sent from an unloading page still
// leaves, and the rejection is swallowed: telemetry that can break the app it
// is reporting on is worse than no telemetry.
function post(url: string, body: unknown): void {
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => { /* nothing useful to do — the console line above stands */ });
  } catch {
    /* fetch itself unavailable (very old host, or a test env without it) */
  }
}

// Application Insights' classic Track envelope. Severity levels are the SDK's
// own numbering: 2 = Warning, 3 = Error.
function appInsightsTransport(key: string, url: string): TelemetryTransport {
  return (event, context) => {
    post(url, {
      name: "Microsoft.ApplicationInsights.Message",
      time: new Date().toISOString(),
      iKey: key,
      tags: {
        "ai.cloud.role": "timeflow",
        "ai.user.authUserId": context.userId,
        "ai.operation.name": event.name,
      },
      data: {
        baseType: "MessageData",
        baseData: {
          ver: 2,
          message: `${event.name}: ${event.message}`,
          severityLevel: event.severity === "error" ? 3 : 2,
          properties: { ...context, ...stringifyProps(event.props) },
        },
      },
    });
  };
}

function webhookTransport(url: string): TelemetryTransport {
  return (event, context) => {
    post(url, {
      app: "timeflow",
      name: event.name,
      severity: event.severity,
      message: event.message,
      timestamp: new Date().toISOString(),
      ...context,
      ...stringifyProps(event.props),
    });
  };
}

function stringifyProps(props: TelemetryEvent["props"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v !== undefined) out[k] = String(v);
  }
  return out;
}

let transport: TelemetryTransport | null | undefined;

function resolveTransport(): TelemetryTransport | null {
  if (transport !== undefined) return transport;
  const cs = env("VITE_APPINSIGHTS_CONNECTION_STRING");
  const parsed = cs ? parseConnectionString(cs) : null;
  if (parsed) return (transport = appInsightsTransport(parsed.key, parsed.ingestion));
  const webhook = env("VITE_TELEMETRY_ENDPOINT");
  if (webhook) return (transport = webhookTransport(webhook));
  return (transport = null);
}

// Who and where, on every event. Wrapped because getCurrentUser() throws before
// bootstrap resolves, and a crash during bootstrap is precisely one we want
// reported — it just gets reported without the identity.
function sessionContext(): Record<string, string> {
  try {
    const user = getCurrentUser();
    return { userId: user.id, environmentId: user.environmentId };
  } catch {
    return { userId: "unresolved", environmentId: "unresolved" };
  }
}

/**
 * Report a failure signal. Never throws, never returns a promise to await:
 * call sites are error paths, and an error path that can itself fail is a
 * second bug waiting to happen.
 */
export function reportTelemetry(event: TelemetryEvent): void {
  const line = `[telemetry] ${event.name}: ${event.message}`;
  // The console line is unconditional. It's what §5 of the runbook has always
  // asked users for, and it is the only record when no sink is configured.
  if (event.severity === "error") console.error(line, event.props ?? {});
  else console.warn(line, event.props ?? {});

  const key = `${event.name}|${event.message}`;
  if (sent.has(key) || eventCount >= MAX_EVENTS_PER_SESSION) return;
  sent.add(key);
  eventCount += 1;

  try {
    resolveTransport()?.(event, sessionContext());
  } catch {
    /* as above: a broken sink must not break the caller */
  }
}

/** True when a sink is configured — lets the UI stop promising someone will see this. */
export function isTelemetryConfigured(): boolean {
  return resolveTransport() !== null;
}

/** Test hook: install a transport and clear the dedupe/cap state. */
export function __setTelemetryTransportForTests(fn: TelemetryTransport | null | undefined): void {
  transport = fn;
  sent.clear();
  eventCount = 0;
}
